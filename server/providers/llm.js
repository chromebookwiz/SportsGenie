const { getTopCandidates, loadPlayerProfiles, searchContext, searchNews } = require('./research');

const parseJson = (value) => {
  const normalized = String(value || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized);
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(normalized.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_context',
      description: 'Search the loaded slate, screened candidates, news, and analytics for a team, matchup, player, market, or angle.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_news',
      description: 'Search fresh Google News RSS results for a betting-relevant query to get updated headlines and context.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_player_profiles',
      description: 'Fetch current player profiles and recent game logs from the secure player-stats provider for specific teams or sport keys.',
      parameters: {
        type: 'object',
        properties: {
          teams: {
            type: 'array',
            items: { type: 'string' },
          },
          sportKeys: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_candidates',
      description: 'Return the strongest screened candidate bets, optionally filtered by market or matchup.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
          market: { type: 'string' },
          matchup: { type: 'string' },
        },
      },
    },
  },
];

const executeToolCall = async (toolCall, context) => {
  const args = parseJson(toolCall.function?.arguments || '{}') || {};

  switch (toolCall.function?.name) {
    case 'search_context':
      return searchContext({ ...args, ...context });
    case 'search_news':
      return searchNews(args);
    case 'get_player_profiles':
      return loadPlayerProfiles(args);
    case 'get_top_candidates':
      return getTopCandidates({ ...args, candidates: context.candidates });
    default:
      throw new Error(`Unsupported tool ${toolCall.function?.name || 'unknown'}`);
  }
};

const buildSystemPrompt = (systemPrompt) =>
  `${systemPrompt} You can use tools to search the current slate, pull fresh news, and fetch player-profile context before finalizing picks. Use tool calls when you need better evidence, then return JSON only in the required recommendations shape.`;

async function createOpenRouterResponse({ headers, body }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  return response.json();
}

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

  const context = {
    events: Array.isArray(events) ? events : [],
    news: Array.isArray(news) ? news : [],
    analytics: analytics && typeof analytics === 'object' ? analytics : {},
    candidates: Array.isArray(candidates) ? candidates : [],
  };
  const messages = [
    { role: 'system', content: buildSystemPrompt(systemPrompt) },
    { role: 'user', content: JSON.stringify(context) },
  ];
  const maxToolRounds = Math.max(1, Math.min(4, Number(process.env.SERVER_LLM_TOOL_MAX_ROUNDS || 3)));

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const payload = await createOpenRouterResponse({
      headers,
      body: {
        model: process.env.SERVER_OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
        temperature: 0.2,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice: 'auto',
      },
    });
    const message = payload.choices?.[0]?.message;

    if (!message) {
      throw new Error('Proxy LLM returned no message');
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content || '',
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        let result;

        try {
          result = await executeToolCall(toolCall, context);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : 'Tool execution failed',
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function?.name || 'unknown_tool',
          content: JSON.stringify(result),
        });
      }

      continue;
    }

    const content = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? JSON.stringify(message.content) : '';
    const parsed = parseJson(content);

    if (!parsed) {
      throw new Error('Proxy LLM returned invalid JSON');
    }

    return parsed;
  }

  throw new Error('Proxy LLM exceeded tool-call limit without returning recommendations');
}

module.exports = {
  callOpenRouter,
};