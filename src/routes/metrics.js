const express = require('express');
const pool = require('../db/pool');
const redis = require('../db/redis');

const metricsRouter = express.Router();

metricsRouter.get('/', async (req, res) => {
  try {
    const { rows: providers } = await pool.query('SELECT id, name FROM providers WHERE enabled = true');

    const providerStats = [];
    for (const p of providers) {
      const { rows } = await pool.query(
        `SELECT status, count(*)::int as count, avg(latency_ms)::int as avg_latency
         FROM request_log WHERE provider_id = $1 GROUP BY status`,
        [p.id]
      );
      const circuitState = await redis.hgetall(`circuit:${p.id}`);
      providerStats.push({
        provider: p.name,
        circuit_state: circuitState.state || 'closed',
        stats: rows,
      });
    }

    const { rows: rateLimited } = await pool.query(
      `SELECT count(*)::int as count FROM request_log WHERE status = 'rate_limited'`
    );

    res.json({
      providers: providerStats,
      rate_limited_total: rateLimited[0]?.count || 0,
    });
  } catch (err) {
    console.error('[metrics] unexpected error:', err);
    res.status(500).json({ error: 'internal gateway error' });
  }
});

module.exports = metricsRouter;
