const redis = require('../db/redis');

// atomic token-bucket refill+consume in one round trip — avoids read-then-write race
// KEYS[1] = bucket key
// ARGV[1] = bucket_size, ARGV[2] = refill_rate (tokens/sec), ARGV[3] = now (ms)
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts = tonumber(bucket[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
local refill = elapsed * refill_rate
tokens = math.min(capacity, tokens + refill)

if tokens < 1 then
  redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
  redis.call('EXPIRE', key, 3600)
  return 0
else
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
  redis.call('EXPIRE', key, 3600)
  return 1
end
`;

// returns true if request allowed. FAILS OPEN if redis is unreachable —
// see PRD open question #1: rate limiting is best-effort, not a source of truth
// for security, so a redis outage should not take down the whole gateway.
async function allowRequest(clientId, bucketSize, refillRate) {
  try {
    const result = await redis.eval(
      TOKEN_BUCKET_LUA,
      1,
      `bucket:${clientId}`,
      bucketSize,
      refillRate,
      Date.now()
    );
    return result === 1;
  } catch (err) {
    console.error('[rateLimiter] redis unavailable, failing open:', err.message);
    return true;
  }
}

module.exports = { allowRequest };
