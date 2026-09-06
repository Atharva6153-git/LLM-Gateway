const redis = require('../db/redis');

const FAILURE_THRESHOLD = parseInt(process.env.CB_FAILURE_THRESHOLD || '3', 10);
const WINDOW_SECONDS = parseInt(process.env.CB_WINDOW_SECONDS || '30', 10);
const COOLDOWN_SECONDS = parseInt(process.env.CB_COOLDOWN_SECONDS || '60', 10);

// states: closed (normal), open (blocked), half_open (one trial request allowed)
function keyFor(providerId) {
  return `circuit:${providerId}`;
}

async function getState(providerId) {
  const data = await redis.hgetall(keyFor(providerId));
  console.error(`[CB DEBUG] getState(${providerId}) raw redis data:`, JSON.stringify(data));
  return {
    state: data.state || 'closed',
    failures: parseInt(data.failures || '0', 10),
  };
}

// call before routing to a provider — false means skip this provider
async function canRequest(providerId) {
  const { state } = await getState(providerId);
  if (state === 'open') {
    // check if cooldown has elapsed -> move to half_open
    const openedAt = await redis.hget(keyFor(providerId), 'openedAt');
    const elapsed = (Date.now() - parseInt(openedAt || '0', 10)) / 1000;
    if (elapsed >= COOLDOWN_SECONDS) {
      await redis.hset(keyFor(providerId), 'state', 'half_open');
      return true; // allow the one trial request
    }
    return false;
  }
  return true; // closed or half_open both allow (half_open allows exactly one trial by convention of caller)
}

async function recordSuccess(providerId) {
  // any success closes the circuit and resets failure count
  await redis.hset(keyFor(providerId), 'state', 'closed', 'failures', 0);
}

async function recordFailure(providerId) {
  const key = keyFor(providerId);
  const { state, failures } = await getState(providerId);

  if (state === 'half_open') {
    // trial failed -> reopen immediately, reset cooldown clock
    await redis.hset(key, 'state', 'open', 'openedAt', Date.now(), 'failures', failures + 1);
    return;
  }

  const newFailures = failures + 1;
  console.error(`[CB DEBUG] recordFailure(${providerId}) current failures=${failures}, writing newFailures=${newFailures}`);
  if (newFailures >= FAILURE_THRESHOLD) {
    await redis.hset(key, 'state', 'open', 'openedAt', Date.now(), 'failures', newFailures);
    console.error(`[CB DEBUG] threshold hit, circuit OPENED for provider ${providerId}`);
  } else {
    await redis.hset(key, 'failures', newFailures);
    await redis.expire(key, WINDOW_SECONDS); // failure count resets if window passes with no more failures
    console.error(`[CB DEBUG] wrote failures=${newFailures} to key=${key}`);
  }
}

module.exports = { canRequest, recordSuccess, recordFailure, getState };