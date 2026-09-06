const redis = require('../db/redis');

const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '3', 10);
const WINDOW_SECONDS = parseInt(process.env.CB_WINDOW_SECONDS || '30', 10);
const COOLDOWN_SECONDS = parseInt(process.env.CB_COOLDOWN_SECONDS || '60', 10);

function keyFor(providerId) {
  return `circuit:${providerId}`;
}

async function getState(providerId) {
  const data = await redis.hgetall(keyFor(providerId));
  return {
    state: data.state || 'closed',
    failures: parseInt(data.failures || '0', 10),
  };
}

async function canRequest(providerId) {
  const key = keyFor(providerId);
  const { state } = await getState(providerId);

  if (state === 'closed') return true;

  if (state === 'half_open') {
    return false;
  }

  const openedAt = await redis.hget(key, 'openedAt');
  const elapsed = (Date.now() - parseInt(openedAt || '0', 10)) / 1000;
  if (elapsed < COOLDOWN_SECONDS) return false;

  const claimed = await redis.hsetnx(key, 'trialClaim', '1');
  if (claimed === 1) {
    await redis.hset(key, 'state', 'half_open');
    return true;
  }
  return false;
}

async function recordSuccess(providerId) {
  await redis.del(keyFor(providerId));
}

async function recordFailure(providerId) {
  const key = keyFor(providerId);
  const { state, failures } = await getState(providerId);

  if (state === 'half_open') {
    await redis.hdel(key, 'trialClaim');
    await redis.hset(key, 'state', 'open', 'openedAt', Date.now(), 'failures', failures + 1);
    return;
  }

  const newFailures = failures + 1;
  if (newFailures >= FAILURE_THRESHOLD) {
    await redis.hset(key, 'state', 'open', 'openedAt', Date.now(), 'failures', newFailures);
  } else {
    await redis.hset(key, 'failures', newFailures);
    await redis.expire(key, WINDOW_SECONDS);
  }
}

module.exports = { canRequest, recordSuccess, recordFailure, getState };