// simulates a real LLM provider — used to demo circuit breaker / failover
// on command, without needing a real provider outage or paid API calls.
const express = require('express');
const app = express();
app.use(express.json());

let failing = false;

app.post('/chat', (req, res) => {
  if (failing) {
    return res.status(500).json({ error: 'simulated provider outage' });
  }
  res.json({
    text: `mock response to: ${req.body.prompt}`,
    model: 'mock-model-v1',
  });
});

// toggle failure mode on/off for live demo
app.post('/simulate-fail', (req, res) => {
  failing = req.body.failing !== false;
  res.json({ failing });
});

app.listen(4000, () => console.log('mock-provider listening on :4000'));
