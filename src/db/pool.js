const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// node-postgres does not parse ?sslmode=require from the URL — Render's
// *external* database URL includes it but still needs the flag translated to
// the pool's ssl option. Internal URLs (no sslmode) stay plaintext.
const ssl = /\?sslmode=require(&|$)/.test(connectionString)
  ? { rejectUnauthorized: false }
  : undefined;

const pool = new Pool({ connectionString, ssl });

module.exports = pool;