const axios = require('axios');
const pool = require('../db/pool');
const circuitBreaker = require('./circuitBreaker');

async function getHealthyProviders() {
  const { rows } = await pool.query(
    'SELECT * FROM providers WHERE enabled = true ORDER BY priority ASC'
  );

  const healthy = [];
  for (const provider of rows) {
    if (await circuitBreaker.canRequest(provider.id)) {
      healthy.push(provider);
    }
  }
  return healthy;
}

// tries providers in priority order until one succeeds, records success/failure
// per attempt, returns normalized response. Throws only if ALL providers fail.
async function forward(payload) {
  const providers = await getHealthyProviders();
  if (providers.length === 0) {
    const err = new Error('all providers unavailable');
    err.code = 'NO_PROVIDERS';
    throw err;
  }

  let lastError;
  for (const provider of providers) {
    const start = Date.now();
    try {
      const apiKey = process.env[provider.api_key_env] || '';
      const res = await axios.post(
        `${provider.base_url}/chat`,
        payload,
        {
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          timeout: 10000,
        }
      );
      await circuitBreaker.recordSuccess(provider.id);
      return {
        providerId: provider.id,
        providerName: provider.name,
        latencyMs: Date.now() - start,
        data: res.data,
      };
    } catch (err) {
      await circuitBreaker.recordFailure(provider.id);
      lastError = err;
      // fall through to next provider — this IS the failover
    }
  }

  const err = new Error('all healthy providers failed on this request');
  err.code = 'ALL_FAILED';
  err.cause = lastError;
  throw err;
}

module.exports = { forward, getHealthyProviders };
