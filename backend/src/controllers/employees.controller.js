const { z } = require('zod');
const service = require('../services/employees.service');

const createSchema = z.object({
  name: z.string().trim().min(1, 'Employee name is required.').max(150),
  email: z.string().trim().email('A valid email address is required.'),
  companyId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  managerId: z.string().uuid().optional(),
  jobTitle: z.string().trim().min(1, 'Job title is required.').max(150),
  contractType: z.enum(['permanent', 'temporary']).optional(),
  contractStartDate: z.string().date().optional(),
  contractEndDate: z.string().date().optional(),
  vacationAllotmentDays: z.number().min(0).optional()
});

const emergencyContactSchema = z.object({
  name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string().min(1)
});

const bankingSchema = z.object({
  bankType: z.enum(['local', 'international']),
  bankName: z.string().min(1),
  accountHolderName: z.string().min(1),
  accountNumber: z.string().min(1),
  routingSwiftIban: z.string().optional()
});

const contractTermsSchema = z.object({
  responsibilities: z.string().max(4000).optional(),
  remuneration: z.string().max(2000).optional()
});

async function list(req, res, next) {
  try {
    const rows = await service.list({
      companyId: req.query.companyId,
      departmentId: req.query.departmentId,
      active: req.query.active !== undefined ? req.query.active === 'true' : undefined
    });
    res.json({ data: rows });
  } catch (err) { next(err); }
}

async function getById(req, res, next) {
  try { res.json({ data: await service.getById(req.params.id) }); } catch (err) { next(err); }
}

async function create(req, res, next) {
  try {
    const body = createSchema.parse(req.body);
    res.status(201).json({ data: await service.create(req, body) });
  } catch (err) { next(err); }
}

async function deactivate(req, res, next) {
  try { res.json({ data: await service.setActive(req, req.params.id, false) }); } catch (err) { next(err); }
}
async function reactivate(req, res, next) {
  try { res.json({ data: await service.setActive(req, req.params.id, true) }); } catch (err) { next(err); }
}

async function onboardingChecklist(req, res, next) {
  try { res.json({ data: await service.getOnboardingChecklist(req.params.id) }); } catch (err) { next(err); }
}

async function upsertEmergencyContact(req, res, next) {
  try {
    const body = emergencyContactSchema.parse(req.body);
    res.json({ data: await service.upsertEmergencyContact(req, req.params.id, body) });
  } catch (err) { next(err); }
}

async function upsertBanking(req, res, next) {
  try {
    const body = bankingSchema.parse(req.body);
    res.json({ data: await service.upsertBanking(req, req.params.id, body) });
  } catch (err) { next(err); }
}

async function getBanking(req, res, next) {
  try { res.json({ data: await service.getBankingMasked(req.params.id) }); } catch (err) { next(err); }
}

async function setContractTerms(req, res, next) {
  try {
    const body = contractTermsSchema.parse(req.body);
    res.json({ data: await service.setContractTerms(req, req.params.id, body) });
  } catch (err) { next(err); }
}

async function directory(req, res, next) {
  try { res.json({ data: await service.getDirectory() }); } catch (err) { next(err); }
}

async function departmentAllocation(req, res, next) {
  try { res.json({ data: await service.getDepartmentAllocation() }); } catch (err) { next(err); }
}

async function contractProgress(req, res, next) {
  try { res.json({ data: await service.getContractProgress(req.params.id) }); } catch (err) { next(err); }
}

module.exports = {
  list, getById, create, deactivate, reactivate, onboardingChecklist,
  upsertEmergencyContact, upsertBanking, getBanking, setContractTerms,
  directory, departmentAllocation, contractProgress
};
