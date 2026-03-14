const parseJson = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

async function callOpenRouter({ systemPrompt, events, news, analytics, candidates }) {
  if (!process.env.SERVER_OPENROUTER_API_KEY) {
    throw new Error('Missing SERVER_OPENROUTER_API_KEY');
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.SERVER_OPENROUTER_API_KEY}`,
  };

  if (process.env.SERVER_OPENROUTER_SITE_URL) {
    headers['HTTP-Referer'] = process.env.SERVER_OPENROUTER_SITE_URL;
  }

  if (process.env.SERVER_OPENROUTER_APP_NAME) {
    headers['X-Title'] = process.env.SERVER_OPENROUTER_APP_NAME;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: process.env.SERVER_OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({ events, news, analytics, candidates }) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = typeof content === 'string' ? parseJson(content) : null;

  if (!parsed) {
    throw new Error('Proxy LLM returned invalid JSON');
  }

  return parsed;
}

module.exports = {
  callOpenRouter,
};