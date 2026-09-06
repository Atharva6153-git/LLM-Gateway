const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 200, 2000),
});

redis.on('error', (err) => {
  // do not crash process on redis error — gateway must fail-open on rate limiter, see lib/rateLimiter.js
  console.error('[redis] connection error:', err.message);
});

module.exports = redis;
