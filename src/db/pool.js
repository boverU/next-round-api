const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  console.error('Unexpected error on idle postgres client', err);
});

/** Run `fn` inside a transaction, rolling back on any throw. */
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

module.exports = { pool, withTransaction };
