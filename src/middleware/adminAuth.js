const crypto = require('crypto');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// gates admin routes (currently /metrics) behind ADMIN_API_KEY. Compares
// sha256 hashes with a constant-time function so response timing doesn't
// leak key prefix information. Denies by default when no admin key is set.
function adminAuth(req, res, next) {
  const expected = hashKey(process.env.ADMIN_API_KEY || '');
  if (!expected) {
    return res.status(401).json({ error: 'admin auth not configured' });
  }
  const presented = req.header('x-admin-key');
  if (!presented) {
    return res.status(401).json({ error: 'missing x-admin-key header' });
  }
  const actual = hashKey(presented);
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'invalid admin key' });
  }
  next();
}

module.exports = { adminAuth, hashKey };