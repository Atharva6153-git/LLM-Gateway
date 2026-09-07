const express = require('express');
const pool = require('../db/pool');
const redis = require('../db/redis');

// bound the scan window so /metrics cost stays O(window) not O(all-time);
// paired with the retention job in src/db/retention.js
const WINDOW_DAYS = parseInt(process.env.METRICS_WINDOW_DAYS || '30', 10);

const metricsRouter = express.Router();

metricsRouter.get('/', async (req, res) => {
  try {
    const { rows: providers } = await pool.query('SELECT id, name FROM providers WHERE enabled = true');

    const providerStats = [];
    for (const p of providers) {
      const { rows } = await pool.query(
        `SELECT status, count(*)::int as count, avg(latency_ms)::int as avg_latency
         FROM request_log
         WHERE provider_id = $1 AND created_at > now() - make_interval(days => $2)
         GROUP BY status`,
        [p.id, WINDOW_DAYS]
      );
      const circuitState = await redis.hgetall(`circuit:${p.id}`);
      providerStats.push({
        provider: p.name,
        circuit_state: circuitState.state || 'closed',
        stats: rows,
      });
    }

    const { rows: rateLimited } = await pool.query(
      `SELECT count(*)::int as count FROM request_log
       WHERE status = 'rate_limited' AND created_at > now() - make_interval(days => $1)`,
      [WINDOW_DAYS]
    );

    res.json({
      window_days: WINDOW_DAYS,
      providers: providerStats,
      rate_limited_total: rateLimited[0]?.count || 0,
    });
  } catch (err) {
    console.error('[metrics] unexpected error:', err.message);
    res.status(500).json({ error: 'internal gateway error' });
  }
});

module.exports = metricsRouter;