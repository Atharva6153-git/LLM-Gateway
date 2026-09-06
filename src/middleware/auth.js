const crypto = require('crypto');
const pool = require('../db/pool');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// attaches req.client on success. Never forwards unauthenticated requests
// to any provider, never counts them against any rate-limit bucket.
async function authMiddleware(req, res, next) {
  const rawKey = req.header('x-api-key');
  if (!rawKey) {
    return res.status(401).json({ error: 'missing x-api-key header' });
  }

  const hash = hashKey(rawKey);
  const { rows } = await pool.query(
    'SELECT * FROM api_clients WHERE api_key_hash = $1',
    [hash]
  );

  if (rows.length === 0) {
    return res.status(401).json({ error: 'invalid api key' });
  }

  req.client = rows[0];
  next();
}

module.exports = { authMiddleware, hashKey };
