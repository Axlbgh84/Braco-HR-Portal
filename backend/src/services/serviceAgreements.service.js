const { v4: uuidv4 } = require('uuid');
const { createClient } = require('@supabase/supabase-js');
const db = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const { mergeTemplate, wrapDocumentHtml } = require('../utils/templateMerge');

const supabaseAdmin = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

const DEFAULT_TEMPLATE = `This Service Agreement ("Agreement") is entered into between {{company}} ("Client") and {{vendorName}} ("Service Provider").

1. SCOPE OF SERVICES
{{serviceDescription}}

2. TERM
Effective {{startDate}} through {{endDate}}.

3. FEES
{{fee}}, payable according to terms confirmed separately in writing.

4. CONTACT
Primary contact: {{contactName}}.

5. CONFIDENTIALITY
Each party agrees to keep confidential any proprietary information disclosed under this Agreement.

6. TERMINATION
Either party may terminate this Agreement with written notice.

7. GOVERNING LAW
This Agreement is governed by the laws applicable in the jurisdiction where {{company}} operates.

Signed and dated: {{date}}`;

async function create(req, input) {
  const { rows } = await db.query(
    `insert into service_agreements (company_id, vendor_name, service_description, contact_name, contact_email, contact_phone, fee, start_date, end_date, notes, created_by, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft') returning *`,
    [input.companyId, input.vendorName, input.serviceDescription, input.contactName, input.contactEmail,
     input.contactPhone, input.fee, input.startDate || null, input.endDate || null, input.notes || null, req.user.id]
  );
  await recordAudit(req, { action: 'agreement.created', entityType: 'service_agreement', entityId: rows[0].id });
  return rows[0];
}

async function list() {
  const { rows } = await db.query(
    `select sa.*, c.name as company_name from service_agreements sa join companies c on c.id = sa.company_id order by sa.status, sa.vendor_name`
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query('select * from service_agreements where id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Service agreement not found.');
  return rows[0];
}

async function update(req, id, input) {
  const { rows } = await db.query(
    `update service_agreements set
       vendor_name = coalesce($1, vendor_name), service_description = coalesce($2, service_description),
       contact_name = coalesce($3, contact_name), contact_email = coalesce($4, contact_email),
       contact_phone = coalesce($5, contact_phone), fee = coalesce($6, fee),
       start_date = coalesce($7, start_date), end_date = $8, notes = coalesce($9, notes),
       status = coalesce($10, status), updated_at = now()
     where id = $11 returning *`,
    [input.vendorName, input.serviceDescription, input.contactName, input.contactEmail, input.contactPhone,
     input.fee, input.startDate, input.endDate || null, input.notes, input.status, id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Service agreement not found.');
  await recordAudit(req, { action: 'agreement.updated', entityType: 'service_agreement', entityId: id, detail: { status: input.status } });
  return rows[0];
}

async function remove(req, id) {
  const { rows } = await db.query('delete from service_agreements where id = $1 returning *', [id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Service agreement not found.');
  await recordAudit(req, { action: 'agreement.removed', entityType: 'service_agreement', entityId: id });
  return rows[0];
}

async function getTemplate() {
  const { rows } = await db.query('select body_template from service_agreement_templates limit 1');
  return rows[0]?.body_template || DEFAULT_TEMPLATE;
}

async function updateTemplate(req, bodyTemplate) {
  return db.withTransaction(async (client) => {
    const { rows: existing } = await client.query('select id from service_agreement_templates limit 1');
    const result = existing[0]
      ? await client.query(`update service_agreement_templates set body_template = $1, updated_by = $2, updated_at = now() where id = $3 returning *`, [bodyTemplate, req.user.id, existing[0].id])
      : await client.query(`insert into service_agreement_templates (body_template, updated_by) values ($1,$2) returning *`, [bodyTemplate, req.user.id]);
    return result.rows[0];
  }).then(async (row) => {
    await recordAudit(req, { action: 'agreement_template.updated', entityType: 'service_agreement_template', entityId: row.id });
    return row;
  });
}

async function generate(req, id) {
  const { rows } = await db.query(
    `select sa.*, c.name as company_name from service_agreements sa join companies c on c.id = sa.company_id where sa.id = $1`,
    [id]
  );
  const agreement = rows[0];
  if (!agreement) throw new ApiError(404, 'NOT_FOUND', 'Service agreement not found.');

  const template = await getTemplate();
  const fmt = (d) => (d ? new Date(d).toLocaleDateString() : '[date to be confirmed]');
  const tokens = {
    company: agreement.company_name,
    vendorName: agreement.vendor_name,
    serviceDescription: agreement.service_description || '[service description to be confirmed]',
    startDate: fmt(agreement.start_date),
    endDate: fmt(agreement.end_date),
    fee: agreement.fee || '[fee to be confirmed]',
    contactName: agreement.contact_name || '[contact to be confirmed]',
    date: new Date().toLocaleDateString()
  };
  const body = mergeTemplate(template, tokens);
  const html = wrapDocumentHtml(`Service Agreement — ${agreement.vendor_name}`, body);

  const storageKey = `service_agreement/${id}/${uuidv4()}-agreement.html`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(env.supabaseStorageBucket)
    .upload(storageKey, Buffer.from(html, 'utf-8'), { contentType: 'text/html' });
  if (uploadError) throw uploadError;

  const { rows: docRows } = await db.query(
    `insert into documents (owner_type, owner_id, document_type, label, storage_key, mime_type, uploaded_by)
     values ('service_agreement', $1, 'agreement', $2, $3, 'text/html', $4) returning *`,
    [id, `Service Agreement — generated ${new Date().toLocaleDateString()}`, storageKey, req.user.id]
  );
  await recordAudit(req, { action: 'agreement.generated', entityType: 'document', entityId: docRows[0].id, detail: { agreementId: id } });
  return docRows[0];
}

module.exports = { create, list, getById, update, remove, getTemplate, updateTemplate, generate };
