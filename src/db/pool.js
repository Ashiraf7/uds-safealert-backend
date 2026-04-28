// src/db/pool.js
const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected pg pool error', { message: err.message });
});

/**
 * Execute a parameterised query.
 * Usage: db.query('SELECT * FROM users WHERE id=$1', [id])
 */
async function query(sql, params) {
  const start = Date.now();
  const res = await pool.query(sql, params);
  const dur = Date.now() - start;
  if (dur > 300) logger.warn('Slow query', { sql: sql.slice(0, 80), dur });
  return res;
}

/**
 * Grab a client for multi-statement transactions.
 * Always use try/finally to release it.
 */
async function getClient() {
  return pool.connect();
}

module.exports = { query, getClient, pool };
