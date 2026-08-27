const { z } = require('zod');
const service = require('../services/companies.service');

const idSchema = z.string().uuid();

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

module.exports = {
  list,
  getById
};