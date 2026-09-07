const crypto = require('crypto');
const pool = require('./pool');

// bootstraps a first api_client from env so a fresh deploy needs zero SQL.
// Activated by SEED_CLIENT_KEY (raw key). Optional: SEED_CLIENT_NAME
// (default seed-client), SEED_BUCKET_SIZE (20), SEED_REFILL_RATE (5).
// Rotate/replace the seeded key after first use.
async function seedClient() {
  const key = process.env.SEED_CLIENT_KEY;
  if (!key) return;

  const name = process.env.SEED_CLIENT_NAME || 'seed-client';
  const bucket = parseInt(process.env.SEED_BUCKET_SIZE || '20', 10);
  const refill = parseInt(process.env.SEED_REFILL_RATE || '5', 10);

  const hash = crypto.createHash('sha256').update(key).digest('hex');
  await pool.query(
    'INSERT INTO api_clients (name, api_key_hash, bucket_size, refill_rate) VALUES ($1, $2, $3, $4) ON CONFLICT (api_key_hash) DO NOTHING',
    [name, hash, bucket, refill]
  );
}

module.exports = { seedClient };