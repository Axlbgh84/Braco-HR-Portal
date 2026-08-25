const db = require('../config/db');
const { withTransaction } = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const notifications = require('./notifications.service');

const LOAN_CAP = 1000;

async function getEmployeeByUserId(userId) {
  const { rows } = await db.query('select * from employees where user_id = $1', [userId]);
  return rows[0];
}

/** Outstanding balance = approved+disbursed loans minus what's already been deducted. */
async function getOutstandingBalance(employeeId) {
  const { rows } = await db.query(
    `select coalesce(sum(lr.amount), 0) as principal,
            coalesce(sum(case when rp.status = 'deducted' then rp.amount else 0 end), 0) as repaid
     from loan_requests lr
     left join loan_repayments rp on rp.loan_request_id = lr.id
     where lr.employee_id = $1 and lr.status in ('approved','disbursed')`,
    [employeeId]
  );
  return Number(rows[0].principal) - Number(rows[0].repaid);
}

async function submitLoanRequest(req, { employeeId, amount, purpose, months }) {
  const { rows: empRows } = await db.query('select * from employees where id = $1', [employeeId]);
  const employee = empRows[0];
  if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');

  if (amount <= 0 || amount > LOAN_CAP) {
    throw new ApiError(422, 'INVALID_AMOUNT', `Loan amount must be between $1 and $${LOAN_CAP}.`);
  }
  const outstanding = await getOutstandingBalance(employeeId);
  if (outstanding + amount > LOAN_CAP) {
    throw new ApiError(422, 'CAP_EXCEEDED', `This would put your outstanding balance over the $${LOAN_CAP} cap (currently $${outstanding}).`);
  }

  const monthlyDeduction = Math.round((amount / months) * 100) / 100;
  const initialStatus = employee.manager_id ? 'pending_manager' : 'pending_hr';

  const { rows } = await db.query(
    `insert into loan_requests (employee_id, amount, purpose, months, monthly_deduction, status)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [employeeId, amount, purpose, months, monthlyDeduction, initialStatus]
  );
  const loan = rows[0];

  if (initialStatus === 'pending_manager') {
    const mgr = await db.query('select user_id from employees where id = $1', [employee.manager_id]);
    await notifications.notify(mgr.rows[0]?.user_id, 'loan', 'A loan request is waiting for your review.');
  } else {
    await notifications.notifyRole('hr', 'loan', 'A loan request needs HR review.');
  }

  await recordAudit(req, { action: 'loan.submitted', entityType: 'loan_request', entityId: loan.id });
  return loan;
}

async function decide(req, { loanId, decision, comment }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select lo.*, e.manager_id, e.user_id as employee_user_id
       from loan_requests lo join employees e on e.id = lo.employee_id
       where lo.id = $1 for update`,
      [loanId]
    );
    const loan = rows[0];
    if (!loan) throw new ApiError(404, 'NOT_FOUND', 'Loan request not found.');
    if (!['pending_manager', 'pending_hr', 'pending_finance'].includes(loan.status)) {
      throw new ApiError(409, 'ALREADY_DECIDED', 'This request has already been decided.');
    }

    const actingEmployee = await getEmployeeByUserId(req.user.id);
    if (actingEmployee && actingEmployee.id === loan.employee_id) {
      throw new ApiError(403, 'SELF_APPROVAL_BLOCKED', 'You cannot approve or reject your own loan.');
    }

    const stepMap = { pending_manager: 'manager', pending_hr: 'hr', pending_finance: 'finance' };
    const step = stepMap[loan.status];
    const requiredPermission = { manager: 'loans.approve.manager', hr: 'loans.approve.hr', finance: 'loans.approve.finance' }[step];
    if (!req.user.permissions.includes(requiredPermission)) {
      throw new ApiError(403, 'WRONG_STAGE', `This request is awaiting ${step} review, not yours to action.`);
    }

    await client.query(
      `insert into loan_approvals (loan_request_id, step, approver_id, decision, comment) values ($1,$2,$3,$4,$5)`,
      [loanId, step, req.user.id, decision, comment || null]
    );

    let newStatus;
    if (decision === 'rejected') newStatus = 'rejected';
    else if (step === 'manager') newStatus = 'pending_hr';
    else if (step === 'hr') newStatus = 'pending_finance';
    else newStatus = 'approved';

    const { rows: updated } = await client.query(
      `update loan_requests set status = $1, decided_at = case when $1 in ('approved','rejected') then now() else decided_at end
       where id = $2 returning *`,
      [newStatus, loanId]
    );

    await recordAudit(req, {
      action: decision === 'rejected' ? 'loan.rejected' : 'loan.approved',
      entityType: 'loan_request', entityId: loanId, detail: { step, comment }
    });

    if (newStatus === 'pending_hr') await notifications.notifyRole('hr', 'loan', 'A loan request needs HR review.');
    else if (newStatus === 'pending_finance') await notifications.notifyRole('finance', 'loan', 'A loan request needs Finance review.');
    else if (newStatus === 'approved') await notifications.notify(loan.employee_user_id, 'loan', `Your loan request for $${loan.amount} was approved and is ready for disbursement.`);
    else if (newStatus === 'rejected') await notifications.notify(loan.employee_user_id, 'loan', `Your loan request for $${loan.amount} was denied.`);

    return updated[0];
  });
}

async function disburse(req, loanId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(`select * from loan_requests where id = $1 and status = 'approved' for update`, [loanId]);
    const loan = rows[0];
    if (!loan) throw new ApiError(409, 'NOT_APPROVED', 'Only an approved loan can be disbursed.');

    await client.query(`update loan_requests set status = 'disbursed', disbursed_at = now(), disbursed_by = $1 where id = $2`, [req.user.id, loanId]);

    // Generate the monthly repayment schedule.
    const schedule = [];
    for (let i = 0; i < loan.months; i++) {
      const dueDate = new Date();
      dueDate.setMonth(dueDate.getMonth() + i + 1);
      schedule.push([loanId, i + 1, dueDate.toISOString().slice(0, 10), loan.monthly_deduction]);
    }
    for (const row of schedule) {
      await client.query(
        `insert into loan_repayments (loan_request_id, period_index, due_date, amount) values ($1,$2,$3,$4)`,
        row
      );
    }

    const empRows = await client.query('select user_id from employees where id = $1', [loan.employee_id]);
    await notifications.notify(empRows.rows[0]?.user_id, 'loan', `Your approved loan of $${loan.amount} has been disbursed.`);
    await recordAudit(req, { action: 'loan.disbursed', entityType: 'loan_request', entityId: loanId });

    return { ...loan, status: 'disbursed' };
  });
}

async function updateRepayment(req, loanId, periodIndex, status) {
  const { rows } = await db.query(
    `update loan_repayments set status = $1, updated_at = now()
     where loan_request_id = $2 and period_index = $3 returning *`,
    [status, loanId, periodIndex]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'Repayment period not found.');
  await recordAudit(req, { action: 'loan.repayment_updated', entityType: 'loan_request', entityId: loanId, detail: { periodIndex, status } });
  return rows[0];
}

async function list(req, filters) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (req.user.permissions.includes('employees.read.all') || req.user.permissions.includes('loans.approve.finance')) {
    // HR/admin/finance see everything, subject to explicit filters below.
  } else if (req.user.permissions.includes('loans.approve.manager')) {
    clauses.push(`(e.user_id = $${i} or e.manager_id = (select id from employees where user_id = $${i}))`);
    params.push(req.user.id); i++;
  } else {
    clauses.push(`e.user_id = $${i}`);
    params.push(req.user.id); i++;
  }
  if (filters.status) { clauses.push(`lo.status = $${i}`); params.push(filters.status); i++; }

  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const { rows } = await db.query(
    `select lo.*, u.display_name as employee_name
     from loan_requests lo join employees e on e.id = lo.employee_id join users u on u.id = e.user_id
     ${where} order by lo.submitted_at desc limit 200`,
    params
  );
  return rows;
}

module.exports = { submitLoanRequest, decide, disburse, updateRepayment, list, getOutstandingBalance };
