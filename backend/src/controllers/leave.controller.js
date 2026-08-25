const { z } = require('zod');
const leaveService = require('../services/leave.service');

const submitSchema = z.object({
  employeeId: z.string().uuid(),
  leaveType: z.enum(['annual_vacation', 'personal_leave', 'unpaid_leave', 'bereavement', 'parental', 'other', 'sick']),
  startDate: z.string().date(),
  endDate: z.string().date(),
  reason: z.string().max(2000).optional()
});

const decideSchema = z.object({
  comment: z.string().max(2000).optional()
});

async function submit(req, res, next) {
  try {
    const body = submitSchema.parse(req.body);
    const leaveRequest = await leaveService.submitLeaveRequest(req, body);
    res.status(201).json({ data: leaveRequest });
  } catch (err) { next(err); }
}

async function list(req, res, next) {
  try {
    const rows = await leaveService.list(req, { status: req.query.status, employeeId: req.query.employeeId });
    res.json({ data: rows });
  } catch (err) { next(err); }
}

async function approve(req, res, next) {
  try {
    const { comment } = decideSchema.parse(req.body);
    const updated = await leaveService.decide(req, { leaveRequestId: req.params.id, decision: 'approved', comment });
    res.json({ data: updated });
  } catch (err) { next(err); }
}

async function reject(req, res, next) {
  try {
    const { comment } = decideSchema.parse(req.body);
    const updated = await leaveService.decide(req, { leaveRequestId: req.params.id, decision: 'rejected', comment });
    res.json({ data: updated });
  } catch (err) { next(err); }
}

async function cancel(req, res, next) {
  try {
    const updated = await leaveService.cancel(req, req.params.id);
    res.json({ data: updated });
  } catch (err) { next(err); }
}

async function balance(req, res, next) {
  try {
    const result = await leaveService.getLeaveBalance(req.params.id);
    res.json({ data: result });
  } catch (err) { next(err); }
}

module.exports = { submit, list, approve, reject, cancel, balance };
