require('dotenv').config();
const express = require('express');
const { authMiddleware } = require('./middleware/auth');
const { adminAuth } = require('./middleware/adminAuth');
const securityHeaders = require('./middleware/securityHeaders');
const { startRetentionJob } = require('./db/retention');
const { seedClient } = require('./db/seedClient');
const chatRouter = require('./routes/chat');
const metricsRouter = require('./routes/metrics');

const app = express();
app.use(express.json());
app.use(securityHeaders);

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) =>
  res.json({
    service: 'llm-gateway',
    endpoints: { health: '/health', chat: '/v1/chat', metrics: '/metrics' },
  })
);

app.use('/v1/chat', authMiddleware, chatRouter);
app.use('/metrics', adminAuth, metricsRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

// last-resort guard for sync throws and next(err); async handlers must
// catch their own rejections since Express 4 does not. 4-arity signature is
// what makes Express treat this as the error handler.
app.use((err, req, res, _next) => {
  console.error('[http] unhandled error:', err.message);
  res.status(500).json({ error: 'internal gateway error' });
});

startRetentionJob();

// optional: create a starter client from env (SEED_CLIENT_KEY) so fresh
// deploys need no SQL; failure here must never block boot
seedClient().catch((err) => console.error('[seed] failed:', err.message));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`llm-gateway listening on :${PORT}`);
});