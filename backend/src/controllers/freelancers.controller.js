const { z } = require('zod');
const service = require('../services/freelancers.service');

const createSchema = z.object({
  companyId: z.string().uuid(),
  project: z.string().min(1),
  rate: z.string().optional(),
  supervisorId: z.string().uuid().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
  email: z.string().email()
});
const updateSchema = createSchema.partial().omit({ email: true });
const contactSchema = z.object({ email: z.string().email().optional(), phone: z.string().optional() });
const bankingSchema = z.object({
  bankType: z.enum(['local', 'international']),
  bankName: z.string().min(1),
  accountHolderName: z.string().min(1),
  accountNumber: z.string().min(1),
  routingSwiftIban: z.string().optional()
});

async function create(req, res, next) {
  try { res.status(201).json({ data: await service.create(req, createSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function list(req, res, next) {
  try { res.json({ data: await service.list() }); } catch (err) { next(err); }
}
async function getById(req, res, next) {
  try { res.json({ data: await service.getById(req.params.id) }); } catch (err) { next(err); }
}
async function update(req, res, next) {
  try { res.json({ data: await service.update(req, req.params.id, updateSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function approve(req, res, next) {
  try { res.json({ data: await service.approve(req, req.params.id) }); } catch (err) { next(err); }
}
async function deactivate(req, res, next) {
  try { res.json({ data: await service.deactivate(req, req.params.id) }); } catch (err) { next(err); }
}
async function upsertContact(req, res, next) {
  try { res.json({ data: await service.upsertContact(req, req.params.id, contactSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function upsertBanking(req, res, next) {
  try { res.json({ data: await service.upsertBanking(req, req.params.id, bankingSchema.parse(req.body)) }); } catch (err) { next(err); }
}

module.exports = { create, list, getById, update, approve, deactivate, upsertContact, upsertBanking };
