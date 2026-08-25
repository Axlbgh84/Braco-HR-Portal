const { z } = require('zod');
const service = require('../services/loans.service');

const submitSchema = z.object({
  employeeId: z.string().uuid(),
  amount: z.number().positive().max(1000),
  purpose: z.string().min(1).max(500),
  months: z.number().int().refine((m) => [1, 2, 3, 4, 5, 6, 12].includes(m), 'Invalid repayment period.')
});
const decideSchema = z.object({ comment: z.string().max(2000).optional() });
const repaymentSchema = z.object({ status: z.enum(['pending', 'deducted', 'missed', 'adjusted']) });

async function submit(req, res, next) {
  try { res.status(201).json({ data: await service.submitLoanRequest(req, submitSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function list(req, res, next) {
  try { res.json({ data: await service.list(req, { status: req.query.status }) }); } catch (err) { next(err); }
}
async function approve(req, res, next) {
  try {
    const { comment } = decideSchema.parse(req.body);
    res.json({ data: await service.decide(req, { loanId: req.params.id, decision: 'approved', comment }) });
  } catch (err) { next(err); }
}
async function reject(req, res, next) {
  try {
    const { comment } = decideSchema.parse(req.body);
    res.json({ data: await service.decide(req, { loanId: req.params.id, decision: 'rejected', comment }) });
  } catch (err) { next(err); }
}
async function disburse(req, res, next) {
  try { res.json({ data: await service.disburse(req, req.params.id) }); } catch (err) { next(err); }
}
async function updateRepayment(req, res, next) {
  try {
    const { status } = repaymentSchema.parse(req.body);
    res.json({ data: await service.updateRepayment(req, req.params.id, Number(req.params.period), status) });
  } catch (err) { next(err); }
}

module.exports = { submit, list, approve, reject, disburse, updateRepayment };
