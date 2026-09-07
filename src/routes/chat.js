const express = require('express');
const pool = require('../db/pool');
const router = require('../lib/router');
const rateLimiter = require('../lib/rateLimiter');

const chatRouter = express.Router();

chatRouter.post('/', async (req, res) => {
  const client = req.client; 
  const { prompt, max_tokens } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const allowed = await rateLimiter.allowRequest(
    client.id,
    client.bucket_size,
    client.refill_rate
  );

  if (!allowed) {
    res.set('Retry-After', '1');
    return res.status(429).json({ error: 'rate limit exceeded' });
  }

  try {
    const result = await router.forward({ prompt, max_tokens });

    await pool.query(
      'INSERT INTO request_log (client_id, provider_id, status, latency_ms) VALUES ($1, $2, $3, $4)',
      [client.id, result.providerId, 'success', result.latencyMs]
    );

    return res.json({
      provider: result.providerName,
      latency_ms: result.latencyMs,
      response: result.data,
    });
  } catch (err) {
    await pool.query(
      'INSERT INTO request_log (client_id, provider_id, status, latency_ms) VALUES ($1, $2, $3, $4)',
      [client.id, null, 'failed', null]
    );

    if (err.code === 'NO_PROVIDERS' || err.code === 'ALL_FAILED') {
      return res.status(503).json({ error: 'all providers unavailable, try again shortly' });
    }
    console.error('[chat] unexpected error:', err);
    return res.status(500).json({ error: 'internal gateway error' });
  }
});

module.exports = chatRouter;
