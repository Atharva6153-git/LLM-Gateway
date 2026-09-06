require('dotenv').config();
const express = require('express');
const { authMiddleware } = require('./middleware/auth');
const chatRouter = require('./routes/chat');
const metricsRouter = require('./routes/metrics');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/v1/chat', authMiddleware, chatRouter);
app.use('/metrics', metricsRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`llm-gateway listening on :${PORT}`);
});
