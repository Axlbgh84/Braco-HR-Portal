const db = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Returns the basic company directory used throughout the HR Portal.
 */
async function list() {
  const { rows } = await db.query(
    `select id, name
     from companies
     order by name`
  );

  return rows;
}


/**
 * Returns one company by ID.
 */
async function getById(id) {
  const { rows } = await db.query(
    `select id, name
     from companies
     where id = $1`,
    [id]
  );

  if (!rows[0]) {
    throw new ApiError(
      404,
      'NOT_FOUND',
      'Company not found.'
    );
  }

  return rows[0];
}


/**
 * Creates a new Braco Group company.
 */
async function create({ name }) {

  const cleanName = name.trim();

  /*
   * Prevent duplicate company names.
   */
  const existing = await db.query(
    `select id
     from companies
     where lower(name) = lower($1)
     limit 1`,
    [cleanName]
  );

  if (existing.rows[0]) {
    throw new ApiError(
      409,
      'COMPANY_EXISTS',
      'A company with this name already exists.'
    );
  }

  const { rows } = await db.query(
    `insert into companies (name)
     values ($1)
     returning id, name`,
    [cleanName]
  );

  return rows[0];
}


module.exports = {
  list,
  getById,
  create
};