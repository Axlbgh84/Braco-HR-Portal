const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const db = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const { mergeTemplate, wrapDocumentHtml, buildContractTerm } = require('../utils/templateMerge');

const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

const DEFAULT_TEMPLATE = `This Employment Agreement ("Agreement") is entered into between Braco Group of Companies, on behalf of {{company}}, and {{name}} ("Employee").

1. POSITION
The Employee is engaged as {{role}} in the {{department}} department of {{company}}.

2. TERM
This is a {{term}}.

3. RESPONSIBILITIES
{{responsibilities}}

4. REMUNERATION
{{remuneration}}

5. VACATION
The Employee is entitled to {{vacationDays}} vacation days per year, in accordance with company policy.

6. CONFIDENTIALITY
The Employee agrees to keep confidential all proprietary and business information belonging to {{company}}.

7. TERMINATION
Either party may terminate this Agreement in accordance with applicable local labor law and company policy.

8. GOVERNING LAW
This Agreement is governed by the laws applicable in the jurisdiction where {{company}} operates.

Signed and dated: {{date}}`;

async function getTemplate(companyId) {
  const { rows } = await db.query(
    `select body_template, 1 as priority from contract_templates where company_id = $1
     union all
     select body_template, 2 as priority from contract_templates where company_id is null
     order by priority
     limit 1`,
    [companyId || null]
  );
  return rows[0]?.body_template || DEFAULT_TEMPLATE;
}

async function updateTemplate(req, { companyId, bodyTemplate }) {
  // No unique constraint on the nullable company_id column (Postgres treats every
  // NULL as distinct, so a naive ON CONFLICT can't enforce "one global template"),
  // so this does an explicit check-then-write instead of relying on ON CONFLICT.
  return db.withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      companyId ? `select id from contract_templates where company_id = $1` : `select id from contract_templates where company_id is null`,
      companyId ? [companyId] : []
    );
    const result = existing[0]
      ? await client.query(
          `update contract_templates set body_template = $1, updated_by = $2, updated_at = now() where id = $3 returning *`,
          [bodyTemplate, req.user.id, existing[0].id]
        )
      : await client.query(
          `insert into contract_templates (company_id, body_template, updated_by) values ($1,$2,$3) returning *`,
          [companyId || null, bodyTemplate, req.user.id]
        );
    return result.rows[0];
  }).then(async (row) => {
    await recordAudit(req, { action: 'contract_template.updated', entityType: 'contract_template', entityId: row.id });
    return row;
  });
}

async function generate(req, employeeId) {
  const { rows } = await db.query(
    `select e.*, u.display_name, c.name as company_name, d.name as department_name
     from employees e join users u on u.id = e.user_id join companies c on c.id = e.company_id
     left join departments d on d.id = e.department_id where e.id = $1`,
    [employeeId]
  );
  const employee = rows[0];
  if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');

  const template = await getTemplate(employee.company_id);
  const tokens = {
    name: employee.display_name,
    role: employee.job_title,
    department: employee.department_name || 'General',
    company: employee.company_name,
    term: buildContractTerm(employee),
    vacationDays: employee.vacation_allotment_days,
    responsibilities: employee.responsibilities || '[responsibilities to be confirmed by HR]',
    remuneration: employee.remuneration || '[remuneration to be confirmed by HR]',
    date: new Date().toLocaleDateString()
  };
  const body = mergeTemplate(template, tokens);
  const html = wrapDocumentHtml(`Employment Contract — ${employee.display_name}`, body);

  const storageKey = `employee/${employeeId}/${uuidv4()}-contract.html`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(env.supabaseStorageBucket)
    .upload(storageKey, Buffer.from(html, 'utf-8'), { contentType: 'text/html' });
  if (uploadError) throw uploadError;

  const { rows: docRows } = await db.query(
    `insert into documents (owner_type, owner_id, document_type, label, storage_key, mime_type, uploaded_by)
     values ('employee', $1, 'contract', $2, $3, 'text/html', $4) returning *`,
    [employeeId, `Employment Contract — generated ${new Date().toLocaleDateString()}`, storageKey, req.user.id]
  );

  await recordAudit(req, { action: 'contract.generated', entityType: 'document', entityId: docRows[0].id, detail: { employeeId } });
  return { document: docRows[0], bodyText: body };
}

async function getLatest(employeeId) {
  const { rows } = await db.query(
    `select * from documents where owner_type = 'employee' and owner_id = $1 and document_type = 'contract'
     order by uploaded_at desc limit 1`,
    [employeeId]
  );
  return rows[0] || null;
}

async function amend(req, documentId, newBody) {
  const { rows } = await db.query('select * from documents where id = $1', [documentId]);
  const doc = rows[0];
  if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Contract document not found.');

  const { rows: empRows } = await db.query(
    `select u.display_name from employees e join users u on u.id = e.user_id where e.id = $1`, [doc.owner_id]
  );
  const html = wrapDocumentHtml(`Employment Contract — ${empRows[0]?.display_name || ''}`, newBody);

  const { error: uploadError } = await supabaseAdmin.storage
    .from(env.supabaseStorageBucket)
    .upload(doc.storage_key, Buffer.from(html, 'utf-8'), { contentType: 'text/html', upsert: true });
  if (uploadError) throw uploadError;

  const { rows: updated } = await db.query(
    `update documents set label = $1, amended_at = now() where id = $2 returning *`,
    [`Employment Contract — amended ${new Date().toLocaleDateString()}`, documentId]
  );
  await recordAudit(req, { action: 'contract.amended', entityType: 'document', entityId: documentId });
  return updated[0];
}

module.exports = { getTemplate, updateTemplate, generate, getLatest, amend };
