const pool = require('./pool');

// prunes request_log older than LOG_RETENTION_DAYS (default 30, 0 disables).
// Errors are logged and swallowed — cleanup must never take the gateway down.
function startRetentionJob() {
  const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);
  if (!retentionDays) return;

  const prune = async () => {
    try {
      const { rowCount } = await pool.query(
        'DELETE FROM request_log WHERE created_at < now() - make_interval(days => $1)',
        [retentionDays]
      );
      if (rowCount > 0) console.log('[retention] pruned ' + rowCount + ' request_log rows');
    } catch (err) {
      console.error('[retention] prune failed:', err.message);
    }
  };

  prune();
  const timer = setInterval(prune, 24 * 60 * 60 * 1000);
  timer.unref();
}

module.exports = { startRetentionJob };