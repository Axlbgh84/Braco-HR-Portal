const db = require('../config/db');
const env = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const notifications = require('./notifications.service');

async function create(req, input) {
  const { rows } = await db.query(
    `insert into freelancers (company_id, project, rate, supervisor_id, start_date, end_date, notes, email, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'pending') returning *`,
    [input.companyId, input.project, input.rate, input.supervisorId || null, input.startDate || null, input.endDate || null, input.notes || null, input.email]
  );
  await recordAudit(req, { action: 'freelancer.created', entityType: 'freelancer', entityId: rows[0].id });
  return rows[0];
}

async function list() {
  const { rows } = await db.query(
    `select f.*, c.name as company_name, u.display_name as supervisor_name
     from freelancers f
     join companies c on c.id = f.company_id
     left join employees e on e.id = f.supervisor_id
     left join users u on u.id = e.user_id
     order by f.status, f.created_at desc`
  );
  return rows;
}

async function getById(id) {
  const { rows } = await db.query('select * from freelancers where id = $1', [id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  return rows[0];
}

async function update(req, id, input) {
  const { rows } = await db.query(
    `update freelancers set company_id = coalesce($1, company_id), project = coalesce($2, project),
            rate = coalesce($3, rate), supervisor_id = $4, start_date = coalesce($5, start_date),
            end_date = $6, notes = coalesce($7, notes), updated_at = now()
     where id = $8 returning *`,
    [input.companyId, input.project, input.rate, input.supervisorId || null, input.startDate, input.endDate || null, input.notes, id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  await recordAudit(req, { action: 'freelancer.updated', entityType: 'freelancer', entityId: id });
  return rows[0];
}

/** Only Finance can move a freelancer to active — this is the one place that permission matters most. */
async function approve(req, id) {
  const { rows } = await db.query(
    `update freelancers set status = 'active', approved_by = $1, approved_at = now() where id = $2 returning *`,
    [req.user.id, id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  await recordAudit(req, { action: 'freelancer.approved', entityType: 'freelancer', entityId: id });
  if (rows[0].user_id) await notifications.notify(rows[0].user_id, 'freelancer', 'You have been approved as an active freelancer.');
  return rows[0];
}

async function deactivate(req, id) {
  const { rows } = await db.query(`update freelancers set status = 'inactive' where id = $1 returning *`, [id]);
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  await recordAudit(req, { action: 'freelancer.deactivated', entityType: 'freelancer', entityId: id });
  return rows[0];
}

async function upsertContact(req, id, { email, phone }) {
  const { rows } = await db.query(
    `update freelancers set email = coalesce($1, email), phone = coalesce($2, phone), updated_at = now() where id = $3 returning *`,
    [email, phone, id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  return rows[0];
}

async function upsertBanking(req, id, { bankType, bankName, accountHolderName, accountNumber, routingSwiftIban }) {
  const { rows } = await db.query(
    `insert into freelancer_banking_details (freelancer_id, bank_type, bank_name, account_holder_name, account_number_enc, routing_swift_iban, updated_by)
     values ($1,$2,$3,$4, pgp_sym_encrypt($5, $6), $7, $8)
     on conflict (freelancer_id) do update set
       bank_type = $2, bank_name = $3, account_holder_name = $4,
       account_number_enc = pgp_sym_encrypt($5, $6), routing_swift_iban = $7,
       updated_by = $8, updated_at = now()
     returning freelancer_id, bank_type, bank_name, account_holder_name, routing_swift_iban, updated_at`,
    [id, bankType, bankName, accountHolderName, accountNumber, env.bankingEncryptionKey, routingSwiftIban, req.user.id]
  );
  await recordAudit(req, { action: 'freelancer.banking_updated', entityType: 'freelancer', entityId: id });
  return rows[0];
}

module.exports = { create, list, getById, update, approve, deactivate, upsertContact, upsertBanking };
