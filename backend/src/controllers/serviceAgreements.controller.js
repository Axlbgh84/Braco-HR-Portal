const { z } = require('zod');
const service = require('../services/serviceAgreements.service');

const createSchema = z.object({
  companyId: z.string().uuid(),
  vendorName: z.string().min(1),
  serviceDescription: z.string().max(2000).optional(),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
  fee: z.string().optional(),
  startDate: z.string().date().optional(),
  endDate: z.string().date().optional(),
  notes: z.string().max(2000).optional()
});
const updateSchema = createSchema.partial().extend({ status: z.enum(['draft', 'active', 'expired']).optional() });
const templateSchema = z.object({ bodyTemplate: z.string().min(1) });

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
async function remove(req, res, next) {
  try { await service.remove(req, req.params.id); res.status(204).send(); } catch (err) { next(err); }
}
async function getTemplate(req, res, next) {
  try { res.json({ data: { bodyTemplate: await service.getTemplate() } }); } catch (err) { next(err); }
}
async function updateTemplate(req, res, next) {
  try { res.json({ data: await service.updateTemplate(req, templateSchema.parse(req.body).bodyTemplate) }); } catch (err) { next(err); }
}
async function generate(req, res, next) {
  try { res.status(201).json({ data: await service.generate(req, req.params.id) }); } catch (err) { next(err); }
}

module.exports = { create, list, getById, update, remove, getTemplate, updateTemplate, generate };
