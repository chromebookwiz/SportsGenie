const dotenv = require('dotenv');
const { callOpenRouter } = require('../../server/providers/llm');

dotenv.config({ path: '.env.server' });
dotenv.config();

module.exports = async (request, response) => {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const payload = await callOpenRouter(request.body || {});
    response.status(200).json(payload);
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : 'LLM request failed',
    });
  }
};