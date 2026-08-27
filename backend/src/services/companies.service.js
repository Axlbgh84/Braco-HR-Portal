const db = require('../config/db');
const { ApiError } = require('../middleware/errorHandler');

/**
 * Returns the basic company directory used throughout the HR Portal.
 *
 * This endpoint deliberately exposes only non-sensitive company information.
 * Any authenticated portal user may need this data for company names,
 * employee profiles, dropdowns, dashboards, and other portal displays.
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
 *
 * Kept here so the service is ready for company-specific portal views later,
 * without exposing additional company data.
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


module.exports = {
  list,
  getById
};