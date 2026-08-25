const db = require('../config/db');
const { withTransaction } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const notifications = require('./notifications.service');

async function getFreelancerByUserId(userId) {
  const { rows } = await db.query('select * from freelancers where user_id = $1', [userId]);
  return rows[0];
}

async function submit(req, { freelancerId, period, description, amount, documentId }) {
  const { rows: flRows } = await db.query('select * from freelancers where id = $1', [freelancerId]);
  const freelancer = flRows[0];
  if (!freelancer) throw new ApiError(404, 'NOT_FOUND', 'Freelancer not found.');
  if (!freelancer.supervisor_id) {
    throw new ApiError(422, 'NO_SUPERVISOR', 'No supervisor is assigned yet — ask HR to set one before submitting work.');
  }
  if (amount <= 0) throw new ApiError(422, 'INVALID_AMOUNT', 'Enter an amount greater than zero.');

  const { rows } = await db.query(
    `insert into work_submissions (freelancer_id, period, description, amount, document_id, status)
     values ($1,$2,$3,$4,$5,'pending_supervisor') returning *`,
    [freelancerId, period, description || null, amount, documentId || null]
  );

  const sup = await db.query('select user_id from employees where id = $1', [freelancer.supervisor_id]);
  await notifications.notify(sup.rows[0]?.user_id, 'freelance_work', `${freelancer.project} — work submitted for ${period}, awaiting your review.`);
  await recordAudit(req, { action: 'work.submitted', entityType: 'work_submission', entityId: rows[0].id });
  return rows[0];
}

async function decide(req, { workId, decision }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select ws.*, f.supervisor_id, f.user_id as freelancer_user_id, f.project
       from work_submissions ws join freelancers f on f.id = ws.freelancer_id
       where ws.id = $1 for update`,
      [workId]
    );
    const work = rows[0];
    if (!work) throw new ApiError(404, 'NOT_FOUND', 'Work submission not found.');
    if (work.status !== 'pending_supervisor') throw new ApiError(409, 'ALREADY_DECIDED', 'This submission has already been decided.');

    // Must be the SPECIFIC assigned supervisor, not just any supervisor.
    const { rows: supRows } = await client.query('select user_id from employees where id = $1', [work.supervisor_id]);
    if (supRows[0]?.user_id !== req.user.id) {
      throw new ApiError(403, 'WRONG_SUPERVISOR', 'Only this freelancer\'s assigned supervisor can review this.');
    }

    const newStatus = decision === 'approved' ? 'approved_pending_submit' : 'rejected';
    const { rows: updated } = await client.query(
      `update work_submissions set status = $1, decided_at = now(), decided_by = $2 where id = $3 returning *`,
      [newStatus, req.user.id, workId]
    );

    await recordAudit(req, { action: `work.${decision}`, entityType: 'work_submission', entityId: workId });
    if (newStatus === 'approved_pending_submit') {
      await notifications.notify(work.freelancer_user_id, 'freelance_work', `Your work for ${work.period} was approved — submit it to Finance to generate an invoice.`);
    } else {
      await notifications.notify(work.freelancer_user_id, 'freelance_work', `Your work for ${work.period} was rejected.`);
    }
    return updated[0];
  });
}

async function submitToFinance(req, workId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select ws.*, f.user_id as freelancer_user_id, f.project
       from work_submissions ws join freelancers f on f.id = ws.freelancer_id
       where ws.id = $1 for update`,
      [workId]
    );
    const work = rows[0];
    if (!work) throw new ApiError(404, 'NOT_FOUND', 'Work submission not found.');
    if (work.freelancer_user_id !== req.user.id) throw new ApiError(403, 'FORBIDDEN', 'Not your submission.');
    if (work.status !== 'approved_pending_submit') throw new ApiError(409, 'WRONG_STATE', 'This submission is not ready to send to Finance.');

    const invoiceNumber = `INV-${workId.slice(-6).toUpperCase()}`;
    const { rows: updated } = await client.query(
      `update work_submissions set status = 'submitted_to_finance', invoice_number = $1, invoiced_at = now() where id = $2 returning *`,
      [invoiceNumber, workId]
    );

    await notifications.notifyRole('finance', 'invoice', `Invoice ${invoiceNumber} from ${work.project} ($${work.amount}) is ready to pay.`);
    await recordAudit(req, { action: 'work.invoiced', entityType: 'work_submission', entityId: workId, detail: { invoiceNumber } });
    return updated[0];
  });
}

async function markPaid(req, workId) {
  const { rows } = await db.query(
    `update work_submissions set status = 'paid', paid_at = now(), paid_by = $1
     where id = $2 and status = 'submitted_to_finance' returning *`,
    [req.user.id, workId]
  );
  if (!rows[0]) throw new ApiError(409, 'NOT_READY', 'This invoice is not awaiting payment.');
  await recordAudit(req, { action: 'work.paid', entityType: 'work_submission', entityId: workId });
  return rows[0];
}

async function list(req) {
  const freelancer = await getFreelancerByUserId(req.user.id);
  let where, params;
  if (freelancer) {
    where = 'ws.freelancer_id = $1'; params = [freelancer.id];
  } else if (req.user.permissions.includes('work.pay')) {
    where = '1=1'; params = []; // finance sees all
  } else {
    where = 'f.supervisor_id = (select id from employees where user_id = $1)'; params = [req.user.id]; // supervisor sees assigned
  }
  const { rows } = await db.query(
    `select ws.*, f.project as freelancer_project from work_submissions ws join freelancers f on f.id = ws.freelancer_id
     where ${where} order by ws.submitted_at desc limit 200`,
    params
  );
  return rows;
}

module.exports = { submit, decide, submitToFinance, markPaid, list };
