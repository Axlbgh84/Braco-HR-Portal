const db = require('../config/db');
const { withTransaction } = require('../config/db');
const { countWeekdays } = require('../utils/dates');
const { ApiError } = require('../middleware/errorHandler');
const { recordAudit } = require('../middleware/auditLog');
const notifications = require('./notifications.service');

const VACATION_LEAVE_TYPES = ['annual_vacation', 'personal_leave', 'unpaid_leave', 'bereavement', 'parental', 'other'];

async function getEmployeeByUserId(userId) {
  const { rows } = await db.query('select * from employees where user_id = $1', [userId]);
  return rows[0];
}

/** Vacation days used this calendar year, computed from approved leave — never stored redundantly. */
async function getLeaveBalance(employeeId) {
  const { rows: empRows } = await db.query('select vacation_allotment_days from employees where id = $1', [employeeId]);
  if (!empRows[0]) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');

  const { rows: usedRows } = await db.query(
    `select coalesce(sum(days_requested), 0) as used
     from leave_requests
     where employee_id = $1
       and status = 'approved'
       and leave_type = any($2)
       and date_part('year', start_date) = date_part('year', current_date)`,
    [employeeId, VACATION_LEAVE_TYPES]
  );

  const allotted = Number(empRows[0].vacation_allotment_days);
  const used = Number(usedRows[0].used);
  return { allotted, used, remaining: Math.max(0, allotted - used) };
}

async function submitLeaveRequest(req, { employeeId, leaveType, startDate, endDate, reason }) {
  const { rows: empRows } = await db.query('select * from employees where id = $1', [employeeId]);
  const employee = empRows[0];
  if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');

  const daysRequested = countWeekdays(startDate, endDate);
  if (daysRequested <= 0) throw new ApiError(422, 'INVALID_RANGE', 'End date must be on or after the start date, and include at least one weekday.');

  if (VACATION_LEAVE_TYPES.includes(leaveType)) {
    const balance = await getLeaveBalance(employeeId);
    if (daysRequested > balance.remaining) {
      throw new ApiError(422, 'INSUFFICIENT_BALANCE', `Only ${balance.remaining} day(s) remaining this year.`);
    }
  }

  // If the employee has no manager (or is submitting for themselves as the person
  // who'd normally approve), skip straight to HR review rather than creating a
  // request that can never be actioned.
  const initialStatus = employee.manager_id ? 'pending_manager' : 'pending_hr';

  const { rows } = await db.query(
    `insert into leave_requests (employee_id, leave_type, start_date, end_date, days_requested, reason, status,
                                  cert_required)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [employeeId, leaveType, startDate, endDate, daysRequested, reason || null, initialStatus, leaveType === 'sick' && daysRequested > 2]
  );

  const leaveRequest = rows[0];

  const approverUserId = initialStatus === 'pending_manager'
    ? (await db.query('select user_id from employees where id = $1', [employee.manager_id])).rows[0]?.user_id
    : null; // HR notified via broadcast, not a single user — see notifications.service

  if (approverUserId) {
    await notifications.notify(approverUserId, 'leave', `${employee.job_title} — a leave request is waiting for your review.`);
  } else {
    await notifications.notifyRole('hr', 'leave', `A leave request needs HR review.`);
  }

  await recordAudit(req, { action: 'leave.submitted', entityType: 'leave_request', entityId: leaveRequest.id });
  return leaveRequest;
}

async function decide(req, { leaveRequestId, decision, comment }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `select lr.*, e.manager_id, e.user_id as employee_user_id
       from leave_requests lr join employees e on e.id = lr.employee_id
       where lr.id = $1 for update`,
      [leaveRequestId]
    );
    const leaveRequest = rows[0];
    if (!leaveRequest) throw new ApiError(404, 'NOT_FOUND', 'Leave request not found.');
    if (!['pending_manager', 'pending_hr'].includes(leaveRequest.status)) {
      throw new ApiError(409, 'ALREADY_DECIDED', 'This request has already been decided.');
    }

    const actingEmployee = await getEmployeeByUserId(req.user.id);
    if (actingEmployee && actingEmployee.id === leaveRequest.employee_id) {
      throw new ApiError(403, 'SELF_APPROVAL_BLOCKED', 'You cannot approve or reject your own request.');
    }

    const step = leaveRequest.status === 'pending_manager' ? 'manager' : 'hr';
    // Permission check is also enforced at the route level (requirePermission), this
    // re-check ensures the caller's permission actually matches the CURRENT stage,
    // not just "approves leave in general".
    const requiredPermission = step === 'manager' ? 'leave.approve.manager' : 'leave.approve.hr';
    if (!req.user.permissions.includes(requiredPermission)) {
      throw new ApiError(403, 'WRONG_STAGE', `This request is awaiting ${step} review, not yours to action.`);
    }

    await client.query(
      `insert into leave_approvals (leave_request_id, step, approver_id, decision, comment)
       values ($1,$2,$3,$4,$5)`,
      [leaveRequestId, step, req.user.id, decision, comment || null]
    );

    let newStatus;
    if (decision === 'rejected') {
      newStatus = 'rejected';
    } else if (step === 'manager') {
      newStatus = 'pending_hr';
    } else {
      newStatus = 'approved';
    }

    const { rows: updated } = await client.query(
      `update leave_requests set status = $1, decided_at = case when $1 in ('approved','rejected') then now() else decided_at end,
              decided_by = case when $1 in ('approved','rejected') then $2 else decided_by end
       where id = $3 returning *`,
      [newStatus, req.user.id, leaveRequestId]
    );

    await recordAudit(req, {
      action: decision === 'rejected' ? 'leave.rejected' : 'leave.approved',
      entityType: 'leave_request',
      entityId: leaveRequestId,
      detail: { step, comment }
    });

    if (newStatus === 'pending_hr') {
      await notifications.notifyRole('hr', 'leave', 'A leave request needs HR review.');
    } else if (newStatus === 'approved' || newStatus === 'rejected') {
      await notifications.notify(
        leaveRequest.employee_user_id,
        'leave',
        `Your leave request (${leaveRequest.start_date}–${leaveRequest.end_date}) was ${newStatus}.`
      );
    }

    return updated[0];
  });
}

async function cancel(req, leaveRequestId) {
  const actingEmployee = await getEmployeeByUserId(req.user.id);
  const { rows } = await db.query(
    `update leave_requests set status = 'cancelled'
     where id = $1 and employee_id = $2 and status in ('pending_manager','pending_hr')
     returning *`,
    [leaveRequestId, actingEmployee?.id]
  );
  if (!rows[0]) throw new ApiError(404, 'NOT_FOUND', 'No cancellable request found (already decided, or not yours).');
  await recordAudit(req, { action: 'leave.cancelled', entityType: 'leave_request', entityId: leaveRequestId });
  return rows[0];
}

async function list(req, filters) {
  const clauses = [];
  const params = [];
  let i = 1;

  if (req.user.permissions.includes('employees.read.all')) {
    // HR/admin: no restriction beyond explicit filters below.
  } else if (req.user.permissions.includes('leave.approve.manager')) {
    clauses.push(`(e.user_id = $${i} or e.manager_id = (select id from employees where user_id = $${i}))`);
    params.push(req.user.id); i++;
  } else {
    clauses.push(`e.user_id = $${i}`);
    params.push(req.user.id); i++;
  }

  if (filters.status) { clauses.push(`lr.status = $${i}`); params.push(filters.status); i++; }
  if (filters.employeeId) { clauses.push(`lr.employee_id = $${i}`); params.push(filters.employeeId); i++; }

  const where = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const { rows } = await db.query(
    `select lr.*, e.job_title, u.display_name as employee_name
     from leave_requests lr
     join employees e on e.id = lr.employee_id
     join users u on u.id = e.user_id
     ${where}
     order by lr.submitted_at desc
     limit 200`,
    params
  );
  return rows;
}

module.exports = { getLeaveBalance, submitLeaveRequest, decide, cancel, list };
