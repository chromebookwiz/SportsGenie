const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { getPlayerProfiles } = require('./providers/playerStats');
const { callOpenRouter } = require('./providers/llm');

dotenv.config({ path: '.env.server' });
dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'sportgenie-proxy' });
});

app.get('/api/player-stats', async (request, response) => {
  const teams = new Set(String(request.query.teams || '').split(',').map((value) => value.trim()).filter(Boolean));
  const sportKeys = new Set(String(request.query.sportKeys || '').split(',').map((value) => value.trim()).filter(Boolean));

  const payload = await getPlayerProfiles({ teams, sportKeys });

  response.json(payload);
});

app.post('/api/llm/recommendations', async (request, response) => {
  try {
    const payload = await callOpenRouter(request.body);
    response.json(payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'Proxy request failed',
    });
  }
});

app.listen(port, () => {
  console.log(`SportGenie proxy listening on http://localhost:${port}`);
});