const db = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');

async function list(filters) {
  const clauses = ['1=1'];
  const params = [];
  let i = 1;
  if (filters.companyId) { clauses.push(`e.company_id = $${i}`); params.push(filters.companyId); i++; }
  if (filters.departmentId) { clauses.push(`e.department_id = $${i}`); params.push(filters.departmentId); i++; }
  if (filters.active !== undefined) { clauses.push(`e.active = $${i}`); params.push(filters.active); i++; }

  const { rows } = await db.query(
    `select e.*, u.display_name, u.email, c.name as company_name, d.name as department_name
     from employees e
     join users u on u.id = e.user_id
     join companies c on c.id = e.company_id
     left join departments d on d.id = e.department_id
     where ${clauses.join(' and ')}
     order by u.display_name`,
    params
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(
    `select e.*, u.display_name, u.email, c.name as company_name, d.name as department_name
     from employees e
     join users u on u.id = e.user_id
     join companies c on c.id = e.company_id
     left join departments d on d.id = e.department_id
     where e.id = $1`,
    [id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
  return rows[0];
}

async function create(req, input) {
  const { rows } = await db.query(
    `insert into employees (user_id, company_id, department_id, manager_id, job_title,
                             contract_type, contract_start_date, contract_end_date, vacation_allotment_days)
     values ($1,$2,$3,$4,$5,$6,$7,$8, coalesce($9, 15))
     returning *`,
    [input.userId, input.companyId, input.departmentId || null, input.managerId || null, input.jobTitle,
     input.contractType || null, input.contractStartDate || null, input.contractEndDate || null, input.vacationAllotmentDays]
  );
  await recordAudit(req, { action: 'employee.created', entityType: 'employee', entityId: rows[0].id });
  return rows[0];
}

async function setActive(req, id, active) {
  const { rows } = await db.query('update employees set active = $1 where id = $2 returning *', [active, id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
  await recordAudit(req, { action: active ? 'employee.reactivated' : 'employee.deactivated', entityType: 'employee', entityId: id });
  return rows[0];
}

/** Everything required for an employee's profile to be considered complete. */
async function getOnboardingChecklist(id) {
  const employee = await getById(id);
  const { rows: contactRows } = await db.query(
    'select * from emergency_contacts where employee_id = $1 and name is not null and phone is not null', [id]
  );
  const { rows: bankingRows } = await db.query(
    'select * from employee_banking_details where employee_id = $1 and bank_type is not null and account_number_enc is not null', [id]
  );
  const { rows: docRows } = await db.query(
    `select document_type from documents where owner_type = 'employee' and owner_id = $1 and document_type in ('headshot','id_passport')`,
    [id]
  );
  const docTypes = docRows.map((r) => r.document_type);

  const items = [
    { label: 'Email verified', done: employee.email_verified },
    { label: 'Emergency contact', done: contactRows.length > 0 },
    { label: 'Banking details', done: bankingRows.length > 0 },
    { label: 'Profile photo', done: docTypes.includes('headshot') },
    { label: 'Passport / ID', done: docTypes.includes('id_passport') },
    { label: 'Contract type', done: !!employee.contract_type }
  ];
  const missing = items.filter((i) => !i.done).map((i) => i.label);
  return { items, missing, complete: missing.length === 0 };
}

async function upsertEmergencyContact(req, employeeId, { name, relationship, phone }) {
  const { rows } = await db.query(
    `insert into emergency_contacts (employee_id, name, relationship, phone)
     values ($1,$2,$3,$4)
     on conflict (employee_id) do update set name = $2, relationship = $3, phone = $4, updated_at = now()
     returning *`,
    [employeeId, name, relationship, phone]
  );
  await recordAudit(req, { action: 'employee.emergency_contact_updated', entityType: 'employee', entityId: employeeId });
  return rows[0];
}

/**
 * Banking details are encrypted at rest with pgcrypto. `getBankingMasked` returns
 * only the last 4 digits by default — a separate, audit-logged "reveal" step would
 * be required for the full number in a real UI, mirroring the masked-by-default
 * pattern already in the prototype's frontend.
 */
async function upsertBanking(req, employeeId, { bankType, bankName, accountHolderName, accountNumber, routingSwiftIban }) {
  const { rows } = await db.query(
    `insert into employee_banking_details (employee_id, bank_type, bank_name, account_holder_name, account_number_enc, routing_swift_iban, updated_by)
     values ($1,$2,$3,$4, pgp_sym_encrypt($5, $6), $7, $8)
     on conflict (employee_id) do update set
       bank_type = $2, bank_name = $3, account_holder_name = $4,
       account_number_enc = pgp_sym_encrypt($5, $6), routing_swift_iban = $7,
       updated_by = $8, updated_at = now()
     returning employee_id, bank_type, bank_name, account_holder_name, routing_swift_iban, updated_at`,
    [employeeId, bankType, bankName, accountHolderName, accountNumber, env.bankingEncryptionKey, routingSwiftIban, req.user.id]
  );
  await recordAudit(req, { action: 'employee.banking_updated', entityType: 'employee', entityId: employeeId });
  return rows[0]; // never returns the encrypted column or plaintext number
}

async function getBankingMasked(employeeId) {
  const { rows } = await db.query(
    `select bank_type, bank_name, account_holder_name, routing_swift_iban,
            right(pgp_sym_decrypt(account_number_enc, $2), 4) as last4
     from employee_banking_details where employee_id = $1`,
    [employeeId, env.bankingEncryptionKey]
  );
  return rows[0] || null;
}

async function setContractTerms(req, employeeId, { responsibilities, remuneration }) {
  const { rows } = await db.query(
    `update employees set responsibilities = $1, remuneration = $2 where id = $3 returning *`,
    [responsibilities, remuneration, employeeId]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
  await recordAudit(req, { action: 'employee.contract_terms_updated', entityType: 'employee', entityId: employeeId });
  return rows[0];
}

/** Company-wide directory — deliberately excludes banking, emergency contact, documents. */
async function getDirectory() {
  const { rows } = await db.query(
    `select e.id, u.display_name, e.job_title, d.name as department_name, c.name as company_name
     from employees e
     join users u on u.id = e.user_id
     join companies c on c.id = e.company_id
     left join departments d on d.id = e.department_id
     where e.active = true
     order by u.display_name`
  );
  return rows;
}

async function getDepartmentAllocation() {
  const { rows } = await db.query(
    `select d.name as department_name, c.name as company_name, count(*) as headcount
     from employees e
     join departments d on d.id = e.department_id
     join companies c on c.id = e.company_id
     where e.active = true
     group by d.name, c.name
     order by d.name`
  );
  return rows;
}

async function getContractProgress(id) {
  const employee = await getById(id);
  if (employee.contract_type !== 'temporary' || !employee.contract_start_date || !employee.contract_end_date) {
    return null;
  }
  const start = new Date(employee.contract_start_date).getTime();
  const end = new Date(employee.contract_end_date).getTime();
  const now = Date.now();
  const percent = Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
  const daysLeft = Math.ceil((end - now) / 86400000);
  return { percent, daysLeft, urgency: daysLeft < 0 ? 'over' : daysLeft <= 14 ? 'soon' : daysLeft <= 30 ? 'upcoming' : 'ok' };
}

module.exports = {
  list, getById, create, setActive, getOnboardingChecklist, upsertEmergencyContact,
  upsertBanking, getBankingMasked, setContractTerms, getDirectory, getDepartmentAllocation, getContractProgress
};
