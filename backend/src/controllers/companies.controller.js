const { z } = require('zod');
const service = require('../services/companies.service');

const idSchema = z.string().uuid();

const createSchema = z.object({
  name: z.string().trim().min(2, 'Company name is required.').max(150)
});


async function list(req, res, next) {
  try {
    const rows = await service.list();
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}


async function getById(req, res, next) {
  try {
    const id = idSchema.parse(req.params.id);
    const company = await service.getById(id);
    res.json({ data: company });
  } catch (err) {
    next(err);
  }
}


async function create(req, res, next) {
  try {
    const data = createSchema.parse(req.body);

    const company = await service.create(data);

    res.status(201).json({
      data: company
    });
  } catch (err) {
    next(err);
  }
}


module.exports = {
  list,
  getById,
  create
};