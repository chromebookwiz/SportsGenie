import { Platform } from 'react-native';

import { env } from '../config/env';
import { fetchPlayerProfiles } from './playerStats';

type ResearchCandidate = {
  id: string;
  matchup: string;
  market: string;
  selection: string;
  sportsbook: string;
  odds: number;
  score: number;
  confidence: number;
  edgePercent?: number;
  expectedValue?: number;
  kellyFraction?: number;
  simulatedWinRate?: number;
  rationale: string;
  relatedHeadline?: string;
};

type ResearchEvent = {
  id: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: Array<{
    key: string;
    title: string;
    lastUpdate: string;
    markets: Array<{
      key: string;
      lastUpdate: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number | null;
      }>;
    }>;
  }>;
};

type ResearchNewsArticle = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
};

type ResearchAnalytics = {
  eventModels?: Array<{
    matchup: string;
    expectedMargin: number;
    totalProjection: number;
    homeWinProbability: number;
    awayWinProbability: number;
    volatility: number;
    bestAngles: string[];
  }>;
};

type ResearchContext = {
  events: ResearchEvent[];
  news: ResearchNewsArticle[];
  analytics: ResearchAnalytics;
  candidates: ResearchCandidate[];
};

type ResearchToolContext = ResearchContext & {
  providerSummary?: Record<string, string>;
  selectedSport?: string;
};

type AdvisorHistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type WebLlmMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: unknown;
  tool_calls?: WebLlmToolCall[];
  tool_call_id?: string;
  name?: string;
};

type WebLlmToolCall = {
  id: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type WebLlmEngine = {
  chat: {
    completions: {
      create: (request: unknown) => Promise<{
        choices?: Array<{
          message?: {
            content?: unknown;
            tool_calls?: WebLlmToolCall[];
          };
        }>;
      }>;
    };
  };
};

type WebLlmModule = {
  CreateMLCEngine: (
    modelId: string,
    options?: {
      initProgressCallback?: (progress: unknown) => void;
    }
  ) => Promise<WebLlmEngine>;
};

const defaultModelOptions = [
  'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  'Llama-3.2-3B-Instruct-q4f32_1-MLC',
  'Phi-3.5-mini-instruct-q4f32_1-MLC',
  'Qwen2.5-7B-Instruct-q4f32_1-MLC',
];

const buildModelOptions = () => {
  const unique = new Set<string>();

  for (const modelId of [...env.webLlmModels, env.webLlmModel, ...defaultModelOptions]) {
    const normalized = String(modelId || '').trim();

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
};

let webLlmModulePromise: Promise<WebLlmModule> | null = null;
const engineCache = new Map<string, Promise<WebLlmEngine>>();
const loadedModelIds = new Set<string>();
let activeModelId = env.webLlmModel;

export const webLlmModelOptions = buildModelOptions();

const resolveModelId = (modelId?: string) => {
  const candidate = String(modelId ?? activeModelId ?? env.webLlmModel).trim();
  return candidate || env.webLlmModel;
};

const getWebLlmModule = () => {
  if (!webLlmModulePromise) {
    webLlmModulePromise = import('@mlc-ai/web-llm') as Promise<WebLlmModule>;
  }

  return webLlmModulePromise;
};

const hasWebGpuSupport = () => {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined';
};

const parseJson = <T>(value: string): T | null => {
  const normalized = String(value || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized) as T;
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(normalized.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
};

const extractMessageText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }

      if (
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }

      return '';
    })
    .join('');
};

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'search_context',
      description: 'Search the current slate, screened bets, news, and model context for teams, matchups, players, and market angles.',
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
      description: 'Pull fresh Google News RSS results for a betting-relevant query when the loaded headlines are not enough.',
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
      description: 'Fetch player profiles and recent game logs for the teams or sport keys most relevant to the current pick analysis.',
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
  {
    type: 'function',
    function: {
      name: 'inspect_matchup_lines',
      description: 'Inspect the current books and key lines for a specific matchup to compare markets and prices.',
      parameters: {
        type: 'object',
        properties: {
          matchup: { type: 'string' },
          limitBooks: { type: 'number' },
        },
        required: ['matchup'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_portfolio_risk',
      description: 'Analyze overall board risk, concentration, Kelly exposure, and diversification across the current recommendations or a selected subset.',
      parameters: {
        type: 'object',
        properties: {
          recommendationIds: {
            type: 'array',
            items: { type: 'string' },
          },
          limit: { type: 'number' },
          bankroll: { type: 'number' },
        },
      },
    },
  },
];

const normalizeText = (value: unknown) => String(value || '').toLowerCase();

const decodeXmlEntities = (value: string) =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const stripTags = (value: string) => decodeXmlEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const readTag = (block: string, tagName: string) => {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));

  return match ? match[1].trim() : undefined;
};

const parseRssItems = (xml: string) => {
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return matches.map((item) => ({
    title: readTag(item, 'title'),
    description: readTag(item, 'description'),
    link: readTag(item, 'link'),
    pubDate: readTag(item, 'pubDate'),
    source: item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1],
  }));
};

const buildSearchBlob = (value: unknown) =>
  normalizeText(
    Array.isArray(value)
      ? value.join(' ')
      : typeof value === 'object' && value !== null
        ? Object.values(value as Record<string, unknown>).join(' ')
        : value
  );

const scoreMatch = (query: string, value: unknown) => {
  const tokens = normalizeText(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);

  if (tokens.length === 0) {
    return 0;
  }

  const haystack = buildSearchBlob(value);

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
};

const summarizeEvent = (event: ResearchEvent) => ({
  id: event.id,
  sportTitle: event.sportTitle,
  matchup: `${event.awayTeam} at ${event.homeTeam}`,
  commenceTime: event.commenceTime,
  bookmakers: event.bookmakers.slice(0, 3).map((bookmaker) => ({
    title: bookmaker.title,
    markets: bookmaker.markets.slice(0, 3).map((market) => ({
      key: market.key,
      outcomes: market.outcomes.slice(0, 4),
    })),
  })),
});

const summarizeCandidate = (candidate: ResearchCandidate) => ({
  id: candidate.id,
  matchup: candidate.matchup,
  market: candidate.market,
  selection: candidate.selection,
  sportsbook: candidate.sportsbook,
  odds: candidate.odds,
  score: candidate.score,
  confidence: candidate.confidence,
  edgePercent: candidate.edgePercent,
  expectedValue: candidate.expectedValue,
  simulatedWinRate: candidate.simulatedWinRate,
  rationale: candidate.rationale,
  relatedHeadline: candidate.relatedHeadline,
});

const summarizeArticle = (article: ResearchNewsArticle) => ({
  title: article.title,
  description: article.description,
  source: article.source,
  publishedAt: article.publishedAt,
  url: article.url,
});

const buildGoogleNewsSearchUrl = (query: string) => {
  const params = new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
};

const searchNews = async ({ query, limit = 6 }: { query: string; limit?: number }) => {
  const response = await fetch(buildGoogleNewsSearchUrl(query), {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Google News search returned ${response.status}`);
  }

  return {
    query,
    articles: parseRssItems(await response.text())
      .filter((item) => item.title && item.link)
      .map((item) => ({
        title: stripTags(item.title || ''),
        description: stripTags(item.description || ''),
        url: stripTags(item.link || ''),
        source: stripTags(item.source || 'Google News'),
        publishedAt: item.pubDate ? new Date(stripTags(item.pubDate)).toISOString() : new Date().toISOString(),
      }))
      .slice(0, Math.max(1, Math.min(12, limit))),
  };
};

const searchContext = (context: ResearchToolContext, { query, limit = 6 }: { query: string; limit?: number }) => {
  const maxResults = Math.max(1, Math.min(12, limit));

  return {
    query,
    matchedEvents: context.events
      .map((event) => ({ score: scoreMatch(query, [event.sportTitle, event.homeTeam, event.awayTeam]), item: summarizeEvent(event) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxResults)
      .map((entry) => entry.item),
    matchedCandidates: context.candidates
      .map((candidate) => ({
        score: scoreMatch(query, [candidate.matchup, candidate.market, candidate.selection, candidate.rationale, candidate.relatedHeadline]),
        item: summarizeCandidate(candidate),
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || right.item.score - left.item.score)
      .slice(0, maxResults)
      .map((entry) => entry.item),
    matchedNews: context.news
      .map((article) => ({ score: scoreMatch(query, article), item: summarizeArticle(article) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxResults)
      .map((entry) => entry.item),
    matchedModels: (context.analytics.eventModels || [])
      .map((model) => ({ score: scoreMatch(query, [model.matchup, ...(model.bestAngles || [])]), item: model }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(4, maxResults))
      .map((entry) => ({
        matchup: entry.item.matchup,
        expectedMargin: entry.item.expectedMargin,
        totalProjection: entry.item.totalProjection,
        homeWinProbability: entry.item.homeWinProbability,
        awayWinProbability: entry.item.awayWinProbability,
        volatility: entry.item.volatility,
        bestAngles: entry.item.bestAngles,
      })),
  };
};

const getTopCandidates = (
  candidates: ResearchCandidate[],
  { limit = 8, market, matchup }: { limit?: number; market?: string; matchup?: string }
) =>
  candidates
    .filter((candidate) => {
      if (market && candidate.market !== market) {
        return false;
      }

      if (matchup && normalizeText(candidate.matchup) !== normalizeText(matchup)) {
        return false;
      }

      return true;
    })
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map(summarizeCandidate);

const getPlayerProfiles = async (
  context: ResearchToolContext,
  { teams = [], sportKeys = [] }: { teams?: string[]; sportKeys?: string[] }
) => {
  const teamSet = new Set(teams.filter(Boolean));
  const sportKeySet = new Set(sportKeys.filter(Boolean));
  const filteredEvents = context.events.filter(
    (event) =>
      teamSet.size === 0 ||
      teamSet.has(event.homeTeam) ||
      teamSet.has(event.awayTeam) ||
      (sportKeySet.size > 0 && sportKeySet.has(event.sportKey))
  );
  const result = await fetchPlayerProfiles(filteredEvents.length > 0 ? filteredEvents : context.events, { forceRefresh: true });

  return {
    provider: result.provider,
    profiles: result.data.slice(0, 12).map((profile) => ({
      id: profile.id,
      name: profile.name,
      team: profile.team,
      sportKey: profile.sportKey,
      position: profile.position,
      primaryStatLabel: profile.primaryStatLabel,
      recentGames: profile.recentGames.slice(0, 5),
    })),
  };
};

const inspectMatchupLines = (
  context: ResearchToolContext,
  { matchup, limitBooks = 4 }: { matchup: string; limitBooks?: number }
) => {
  const normalizedTarget = normalizeText(matchup);
  const event = context.events.find((candidateEvent) => normalizeText(`${candidateEvent.awayTeam} at ${candidateEvent.homeTeam}`) === normalizedTarget);

  if (!event) {
    return {
      matchup,
      error: 'Matchup not found in the current slate',
    };
  }

  return {
    matchup,
    commenceTime: event.commenceTime,
    sportTitle: event.sportTitle,
    books: event.bookmakers.slice(0, Math.max(1, Math.min(6, limitBooks))).map((bookmaker) => ({
      title: bookmaker.title,
      markets: bookmaker.markets.slice(0, 3).map((market) => ({
        key: market.key,
        lastUpdate: market.lastUpdate,
        outcomes: market.outcomes.slice(0, 4),
      })),
    })),
  };
};

const analyzePortfolioRisk = (
  context: ResearchToolContext,
  {
    recommendationIds = [],
    limit = 8,
    bankroll,
  }: { recommendationIds?: string[]; limit?: number; bankroll?: number }
) => {
  const selectedIds = new Set(recommendationIds.filter(Boolean));
  const source =
    selectedIds.size > 0
      ? context.candidates.filter((candidate) => selectedIds.has(candidate.id))
      : context.candidates.slice(0, Math.max(1, Math.min(12, limit)));

  const marketMix = source.reduce<Record<string, number>>((accumulator, candidate) => {
    accumulator[candidate.market] = (accumulator[candidate.market] ?? 0) + 1;
    return accumulator;
  }, {});
  const matchupCounts = source.reduce<Record<string, number>>((accumulator, candidate) => {
    accumulator[candidate.matchup] = (accumulator[candidate.matchup] ?? 0) + 1;
    return accumulator;
  }, {});
  const highRiskCount = source.filter((candidate) => (candidate.confidence ?? 0) < 62 || (candidate.expectedValue ?? 0) < 0.025).length;
  const averageConfidence =
    source.length > 0 ? source.reduce((sum, candidate) => sum + candidate.confidence, 0) / source.length : 0;
  const averageExpectedValue =
    source.length > 0 ? source.reduce((sum, candidate) => sum + (candidate.expectedValue ?? 0), 0) / source.length : 0;
  const summedKelly = source.reduce((sum, candidate) => sum + Math.max(0, candidate.kellyFraction ?? 0), 0);
  const largestKelly = source.reduce((max, candidate) => Math.max(max, Math.max(0, candidate.kellyFraction ?? 0)), 0);
  const duplicateMatchups = Object.entries(matchupCounts)
    .filter(([, count]) => count > 1)
    .map(([matchup, count]) => ({ matchup, count }));

  return {
    recommendationCount: source.length,
    averageConfidence,
    averageExpectedValue,
    totalKellyFraction: summedKelly,
    largestKellyFraction: largestKelly,
    bankroll,
    estimatedStakeUnits: typeof bankroll === 'number' ? summedKelly * bankroll : undefined,
    highRiskCount,
    marketMix,
    duplicateMatchups,
    diversificationScore: Math.max(0, 1 - duplicateMatchups.length / Math.max(1, source.length)),
    concentrationFlags: [
      ...(summedKelly > 0.12 ? ['Total Kelly exposure is elevated'] : []),
      ...(largestKelly > 0.04 ? ['A single recommendation is carrying outsized stake weight'] : []),
      ...(duplicateMatchups.length > 0 ? ['Multiple bets are concentrated in the same matchup'] : []),
      ...(highRiskCount > Math.max(1, Math.floor(source.length / 3)) ? ['Too many weaker-confidence positions are included'] : []),
    ],
    recommendations: source.map((candidate) => ({
      id: candidate.id,
      matchup: candidate.matchup,
      market: candidate.market,
      selection: candidate.selection,
      sportsbook: candidate.sportsbook,
      confidence: candidate.confidence,
      expectedValue: candidate.expectedValue,
      edgePercent: candidate.edgePercent,
      kellyFraction: candidate.kellyFraction,
    })),
  };
};

const executeToolCall = async (toolCall: WebLlmToolCall, context: ResearchToolContext) => {
  const name = toolCall.function?.name || '';
  const args = parseJson<Record<string, unknown>>(toolCall.function?.arguments || '{}') || {};

  switch (name) {
    case 'search_context':
      return searchContext(context, {
        query: String(args.query || ''),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
    case 'search_news':
      return searchNews({
        query: String(args.query || ''),
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
    case 'get_player_profiles':
      return getPlayerProfiles(context, {
        teams: Array.isArray(args.teams) ? args.teams.map(String) : [],
        sportKeys: Array.isArray(args.sportKeys) ? args.sportKeys.map(String) : [],
      });
    case 'get_top_candidates':
      return getTopCandidates(context.candidates, {
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        market: typeof args.market === 'string' ? args.market : undefined,
        matchup: typeof args.matchup === 'string' ? args.matchup : undefined,
      });
    case 'inspect_matchup_lines':
      return inspectMatchupLines(context, {
        matchup: String(args.matchup || ''),
        limitBooks: typeof args.limitBooks === 'number' ? args.limitBooks : undefined,
      });
    case 'analyze_portfolio_risk':
      return analyzePortfolioRisk(context, {
        recommendationIds: Array.isArray(args.recommendationIds) ? args.recommendationIds.map(String) : [],
        limit: typeof args.limit === 'number' ? args.limit : undefined,
        bankroll: typeof args.bankroll === 'number' ? args.bankroll : undefined,
      });
    default:
      throw new Error(`Unsupported WebLLM tool ${name || 'unknown'}`);
  }
};

const buildToolEnabledSystemPrompt = (systemPrompt: string) =>
  `${systemPrompt} You can use tools to search the current slate, pull fresher news, and fetch player-profile context before finalizing recommendations. Use tools when the loaded context is incomplete, then return JSON only in the required recommendations shape.`;

const buildAdvisorSystemPrompt = () =>
  [
    'You are SportGenie Advisor, a direct sports betting analyst.',
    'Act like a disciplined betting advisor: explain edges, identify uncertainty, compare books, reject weak positions, and discuss bankroll discipline when asked.',
    'Use tools whenever you need fresher news, matchup-specific line inspection, player context, better candidate comparison, or portfolio-risk analysis.',
    'Prefer concise, practical advice with a clear recommendation, why it matters, what could invalidate the view, and any stake-sizing or diversification warning that matters.',
    'Do not invent data. If evidence is weak, say so plainly.',
  ].join(' ');

const buildAdvisorUserMessage = (
  question: string,
  context: ResearchToolContext,
  history: AdvisorHistoryMessage[]
) =>
  JSON.stringify({
    question,
    selectedSport: context.selectedSport ?? 'All sports',
    providers: context.providerSummary,
    history,
    slateSummary: {
      events: context.events.length,
      headlines: context.news.length,
      candidateBets: context.candidates.length,
      topCandidates: context.candidates.slice(0, 6).map((candidate) => ({
        matchup: candidate.matchup,
        market: candidate.market,
        selection: candidate.selection,
        sportsbook: candidate.sportsbook,
        odds: candidate.odds,
        confidence: candidate.confidence,
        edgePercent: candidate.edgePercent,
        expectedValue: candidate.expectedValue,
      })),
    },
  });

const runWebLlmToolLoop = async ({
  systemPrompt,
  userMessage,
  context,
  jsonMode,
  modelId,
}: {
  systemPrompt: string;
  userMessage: string;
  context: ResearchToolContext;
  jsonMode: boolean;
  modelId?: string;
}) => {
  const engine = await getEngine(modelId);
  const messages: WebLlmMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userMessage,
    },
  ];
  const maxToolRounds = Math.max(1, Math.min(4, env.webLlmToolMaxRounds));

  for (let round = 0; round <= maxToolRounds; round += 1) {
    const response = await engine.chat.completions.create({
      temperature: jsonMode ? 0.25 : 0.35,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : null),
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      messages,
    });
    const message = response.choices?.[0]?.message;

    if (!message) {
      throw new Error('WebLLM returned no message');
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      });

      for (const toolCall of message.tool_calls) {
        let result: unknown;

        try {
          result = await executeToolCall(toolCall, context);
        } catch (error) {
          result = {
            error: error instanceof Error ? error.message : 'WebLLM tool execution failed',
          };
        }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function?.name,
          content: JSON.stringify(result),
        });
      }

      continue;
    }

    const content = extractMessageText(message.content);

    if (!content) {
      throw new Error('WebLLM returned no content');
    }

    return content;
  }

  throw new Error('WebLLM exceeded tool-call limit without returning a final answer');
};

const getEngine = async (modelId?: string) => {
  if (!isWebLlmSupported()) {
    throw new Error('WebLLM requires a web build with WebGPU support and EXPO_PUBLIC_ENABLE_WEBLLM=true');
  }

  const requestedModel = resolveModelId(modelId);

  const cachedEngine = engineCache.get(requestedModel);

  if (cachedEngine) {
    return cachedEngine.then((engine) => {
      loadedModelIds.add(requestedModel);
      activeModelId = requestedModel;
      return engine;
    });
  }

  const enginePromise = getWebLlmModule()
    .then(async ({ CreateMLCEngine }) => {
      const engine = await CreateMLCEngine(requestedModel, {
        initProgressCallback: () => undefined,
      });

      loadedModelIds.add(requestedModel);
      activeModelId = requestedModel;

      return engine;
    })
    .catch((error) => {
      engineCache.delete(requestedModel);
      loadedModelIds.delete(requestedModel);
      throw error;
    });

  engineCache.set(requestedModel, enginePromise);

  return enginePromise;
};

export const isWebLlmSupported = () => Platform.OS === 'web' && env.enableWebLlm && hasWebGpuSupport();

export const getActiveWebLlmModel = () => activeModelId;

export const getLoadedWebLlmModels = () => Array.from(loadedModelIds);

export const preloadWebLlmModel = async (modelId?: string) => {
  const resolved = resolveModelId(modelId);
  await getEngine(resolved);
  return resolved;
};

export const callWebLlm = async (systemPrompt: string, userPayload: unknown) => {
  return runWebLlmToolLoop({
    systemPrompt: buildToolEnabledSystemPrompt(systemPrompt),
    userMessage: JSON.stringify(userPayload),
    context: userPayload as ResearchToolContext,
    jsonMode: true,
  });
};

export const askWebLlmAdvisor = async ({
  question,
  context,
  history = [],
  modelId,
}: {
  question: string;
  context: ResearchToolContext;
  history?: AdvisorHistoryMessage[];
  modelId?: string;
}) =>
  runWebLlmToolLoop({
    systemPrompt: buildAdvisorSystemPrompt(),
    userMessage: buildAdvisorUserMessage(question, context, history),
    context,
    jsonMode: false,
    modelId,
  });