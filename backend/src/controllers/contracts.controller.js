const { z } = require('zod');
const service = require('../services/contracts.service');

const templateSchema = z.object({ companyId: z.string().uuid().optional(), bodyTemplate: z.string().min(1) });
const amendSchema = z.object({ body: z.string().min(1) });

async function getTemplate(req, res, next) {
  try { res.json({ data: { bodyTemplate: await service.getTemplate(req.query.companyId) } }); } catch (err) { next(err); }
}
async function updateTemplate(req, res, next) {
  try { res.json({ data: await service.updateTemplate(req, templateSchema.parse(req.body)) }); } catch (err) { next(err); }
}
async function generate(req, res, next) {
  try { res.status(201).json({ data: await service.generate(req, req.params.id) }); } catch (err) { next(err); }
}
async function getLatest(req, res, next) {
  try { res.json({ data: await service.getLatest(req.params.id) }); } catch (err) { next(err); }
}
async function amend(req, res, next) {
  try {
    const { body } = amendSchema.parse(req.body);
    res.json({ data: await service.amend(req, req.params.documentId, body) });
  } catch (err) { next(err); }
}

module.exports = { getTemplate, updateTemplate, generate, getLatest, amend };
