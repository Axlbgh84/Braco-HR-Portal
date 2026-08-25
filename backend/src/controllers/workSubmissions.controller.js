const { z } = require('zod');
const service = require('../services/workSubmissions.service');

const submitSchema = z.object({
  freelancerId: z.string().uuid(),
  period: z.string().min(1),
  description: z.string().max(2000).optional(),
  amount: z.number().positive(),
  documentId: z.string().uuid().optional()
});

async function submit(req, res, next) {
  try { res.status(201).json({ data: await service.submit(req, submitSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function list(req, res, next) {
  try { res.json({ data: await service.list(req) }); } catch (err) { next(err); }
}
async function approve(req, res, next) {
  try { res.json({ data: await service.decide(req, { workId: req.params.id, decision: 'approved' }) }); } catch (err) { next(err); }
}
async function reject(req, res, next) {
  try { res.json({ data: await service.decide(req, { workId: req.params.id, decision: 'rejected' }) }); } catch (err) { next(err); }
}
async function submitToFinance(req, res, next) {
  try { res.json({ data: await service.submitToFinance(req, req.params.id) }); } catch (err) { next(err); }
}
async function markPaid(req, res, next) {
  try { res.json({ data: await service.markPaid(req, req.params.id) }); } catch (err) { next(err); }
}

module.exports = { submit, list, approve, reject, submitToFinance, markPaid };
