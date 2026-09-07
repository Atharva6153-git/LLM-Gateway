const crypto = require('crypto');
const pool = require('../db/pool');

const ATTEMPT_LIMIT = parseInt(process.env.AUTH_MAX_FAILURES || '5', 10);
const ATTEMPT_WINDOW = parseInt(process.env.AUTH_FAIL_WINDOW_SECONDS || '60', 10);

const failedAttempts = new Map();

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function ipKey(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

function throttleFor(req) {
  const record = failedAttempts.get(ipKey(req));
  if (!record || record.count < ATTEMPT_LIMIT) return null;
  const remainingMs = record.windowEnd - Date.now();
  if (remainingMs <= 0) {
    failedAttempts.delete(ipKey(req));
    return null;
  }
  return { retryAfter: Math.ceil(remainingMs / 1000) };
}

function recordFailure(req) {
  const key = ipKey(req);
  const now = Date.now();
  const cur = failedAttempts.get(key) || { count: 0, windowEnd: now + ATTEMPT_WINDOW * 1000 };
  if (now >= cur.windowEnd) {
    cur.count = 0;
    cur.windowEnd = now + ATTEMPT_WINDOW * 1000;
  }
  cur.count += 1;
  failedAttempts.set(key, cur);
  if (failedAttempts.size > 10000) {
    for (const [k, v] of failedAttempts) {
      if (v.windowEnd <= now) failedAttempts.delete(k);
    }
  }
}

function clearAttempts(req) {
  failedAttempts.delete(ipKey(req));
}

async function authMiddleware(req, res, next) {
  const rawKey = req.header('x-api-key');
  if (!rawKey) {
    return res.status(401).json({ error: 'missing x-api-key header' });
  }

  const throttled = throttleFor(req);
  if (throttled) {
    res.set('Retry-After', String(throttled.retryAfter));
    return res.status(429).json({ error: 'too many failed attempts, slow down' });
  }

  try {
    const hash = hashKey(rawKey);
    const { rows } = await pool.query(
      'SELECT * FROM api_clients WHERE api_key_hash = $1',
      [hash]
    );

    if (rows.length === 0) {
      recordFailure(req);
      return res.status(401).json({ error: 'invalid api key' });
    }

    clearAttempts(req);
    req.client = rows[0];
    next();
  } catch (err) {
    // Express 4 doesn't catch rejected promises in async handlers — a DB
    // failure here would otherwise reject unhandled and crash the process.
    console.error('[auth] database error:', err.message);
    return res.status(500).json({ error: 'internal gateway error' });
  }
}

module.exports = { authMiddleware, hashKey };