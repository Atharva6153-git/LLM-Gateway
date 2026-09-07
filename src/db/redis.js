const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

// rate-limit retry spam so Render/console logs stay readable while redis
// is down; the app is designed to keep serving (fail-open by default)
let lastLogged = 0;
redis.on('error', (err) => {
  const now = Date.now();
  if (now - lastLogged > 30000) {
    lastLogged = now;
    console.error('[redis] connection error:', err.message);
  }
});

module.exports = redis;
