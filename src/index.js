require('dotenv').config();
const express = require('express');
const { authMiddleware } = require('./middleware/auth');
const { adminAuth } = require('./middleware/adminAuth');
const securityHeaders = require('./middleware/securityHeaders');
const { startRetentionJob } = require('./db/retention');
const chatRouter = require('./routes/chat');
const metricsRouter = require('./routes/metrics');

const app = express();
app.use(express.json());
app.use(securityHeaders);

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/v1/chat', authMiddleware, chatRouter);
app.use('/metrics', adminAuth, metricsRouter);

app.use((req, res) => res.status(404).json({ error: 'not found' }));

startRetentionJob();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`llm-gateway listening on :${PORT}`);
});