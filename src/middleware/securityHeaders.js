// harden HTTP responses. Done without a framework dep to keep the audit
// surface tiny; express default headers are weak (no nosniff etc).
module.exports = function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Cache-Control', 'no-store');
  next();
};