const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the whole process.
  console.error('Unexpected Postgres pool error', err);
});

/**
 * Run a query with automatic connection handling.
 * @param {string} text - SQL text, use $1/$2/... placeholders (never string-concat input).
 * @param {any[]} params
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (env.nodeEnv !== 'production') {
    console.log('query', { text, ms: Date.now() - start, rows: result.rowCount });
  }
  return result;
}

/**
 * Run a set of queries inside a single transaction.
 * @param {(client: import('pg').PoolClient) => Promise<any>} fn
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
