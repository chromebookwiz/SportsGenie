import { Platform } from 'react-native';

const toNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const toList = (value: string | undefined, fallback: string) =>
  (value ?? fallback)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const defaultProxyBaseUrl = process.env.EXPO_PUBLIC_PROXY_BASE_URL ?? (Platform.OS === 'web' ? '' : undefined);

export const env = {
  proxyBaseUrl: defaultProxyBaseUrl,
  oddsApiKey: process.env.EXPO_PUBLIC_ODDS_API_KEY,
  oddsRegions: process.env.EXPO_PUBLIC_ODDS_REGIONS ?? 'us',
  oddsMarkets: process.env.EXPO_PUBLIC_ODDS_MARKETS ?? 'h2h,spreads,totals',
  oddsBookmakers: process.env.EXPO_PUBLIC_ODDS_BOOKMAKERS,
  oddsProviderOrder: toList(process.env.EXPO_PUBLIC_ODDS_PROVIDER_ORDER, 'espn,kalshi,the-odds-api').map((value) =>
    value.toLowerCase()
  ),
  enableEspnOdds: toBoolean(process.env.EXPO_PUBLIC_ENABLE_ESPN_ODDS, true),
  espnOddsSports: toList(process.env.EXPO_PUBLIC_ESPN_ODDS_SPORTS, 'basketball/nba,hockey/nhl,soccer/eng.1').map(
    (value) => value.toLowerCase()
  ),
  enableKalshiOdds: toBoolean(process.env.EXPO_PUBLIC_ENABLE_KALSHI_ODDS, true),
  kalshiBaseUrl: process.env.EXPO_PUBLIC_KALSHI_BASE_URL ?? 'https://api.elections.kalshi.com/trade-api/v2',
  kalshiSeries: toList(
    process.env.EXPO_PUBLIC_KALSHI_SERIES,
    'KXNBAGAME,KXNBASPREAD,KXNBATOTAL,KXNHLGAME,KXNHLTOTAL,KXEPLGAME,KXEPLSPREAD,KXEPLTOTAL'
  ).map((value) => value.toUpperCase()),
  maxEvents: toNumber(process.env.EXPO_PUBLIC_MAX_EVENTS, 12),
  maxRecommendations: toNumber(process.env.EXPO_PUBLIC_MAX_RECOMMENDATIONS, 20),
  minRecommendationFloor: toNumber(process.env.EXPO_PUBLIC_MIN_RECOMMENDATION_FLOOR, 10),
  minBookmakerCount: toNumber(process.env.EXPO_PUBLIC_MIN_BOOKMAKER_COUNT, 1),
  maxAbsoluteFavoritePrice: toNumber(process.env.EXPO_PUBLIC_MAX_ABSOLUTE_FAVORITE_PRICE, 200),
  maxLongshotPrice: toNumber(process.env.EXPO_PUBLIC_MAX_LONGSHOT_PRICE, 375),
  maxMarketHold: toNumber(process.env.EXPO_PUBLIC_MAX_MARKET_HOLD, 0.135),
  minLineValue: toNumber(process.env.EXPO_PUBLIC_MIN_LINE_VALUE, 0.009),
  minEdgePercent: toNumber(process.env.EXPO_PUBLIC_MIN_EDGE_PERCENT, 0.012),
  minExpectedValue: toNumber(process.env.EXPO_PUBLIC_MIN_EXPECTED_VALUE, 0.02),
  minKellyFraction: toNumber(process.env.EXPO_PUBLIC_MIN_KELLY_FRACTION, 0.002),
  maxEventWindowHours: toNumber(process.env.EXPO_PUBLIC_MAX_EVENT_WINDOW_HOURS, 60),
  newsApiKey: process.env.EXPO_PUBLIC_NEWS_API_KEY,
  newsBaseUrl: process.env.EXPO_PUBLIC_NEWS_BASE_URL ?? 'https://newsapi.org/v2/everything',
  gNewsApiKey: process.env.EXPO_PUBLIC_GNEWS_API_KEY,
  gNewsBaseUrl: process.env.EXPO_PUBLIC_GNEWS_BASE_URL ?? 'https://gnews.io/api/v4/search',
  currentsApiKey: process.env.EXPO_PUBLIC_CURRENTS_API_KEY,
  currentsBaseUrl: process.env.EXPO_PUBLIC_CURRENTS_BASE_URL ?? 'https://api.currentsapi.services/v1/search',
  googleNewsRssUrl:
    process.env.EXPO_PUBLIC_GOOGLE_NEWS_RSS_URL ??
    'https://news.google.com/rss/search?q=sports%20betting%20OR%20odds%20OR%20NBA%20OR%20NFL%20OR%20NHL%20OR%20soccer&hl=en-US&gl=US&ceid=US:en',
  espnRssUrl: process.env.EXPO_PUBLIC_ESPN_RSS_URL ?? 'https://www.espn.com/espn/rss/news',
  newsQuery: process.env.EXPO_PUBLIC_NEWS_QUERY ?? 'sports betting OR odds OR NFL OR NBA OR MLB OR NHL OR UFC OR soccer',
  newsLanguage: process.env.EXPO_PUBLIC_NEWS_LANGUAGE ?? 'en',
  newsPageSize: toNumber(process.env.EXPO_PUBLIC_NEWS_PAGE_SIZE, 10),
  newsMaxAgeHours: toNumber(process.env.EXPO_PUBLIC_NEWS_MAX_AGE_HOURS, 72),
  newsProviderOrder: (process.env.EXPO_PUBLIC_NEWS_PROVIDER_ORDER ?? 'google,espn,newsapi,gnews,currents')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
  llmProxyUrl:
    process.env.EXPO_PUBLIC_LLM_PROXY_URL ??
    (defaultProxyBaseUrl !== undefined ? `${defaultProxyBaseUrl}/api/llm/recommendations` : undefined),
  llmProviderOrder: toList(process.env.EXPO_PUBLIC_LLM_PROVIDER_ORDER, 'proxy,webllm,openrouter,openai').map((value) =>
    value.toLowerCase()
  ),
  enableWebLlm: toBoolean(process.env.EXPO_PUBLIC_ENABLE_WEBLLM, true),
  webLlmModel: process.env.EXPO_PUBLIC_WEBLLM_MODEL ?? 'Llama-3.1-8B-Instruct-q4f32_1-MLC',
  webLlmToolMaxRounds: toNumber(process.env.EXPO_PUBLIC_WEBLLM_TOOL_MAX_ROUNDS, 3),
  openRouterApiKey: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY,
  openRouterModel: process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'openai/gpt-4.1-mini',
  openRouterSiteUrl: process.env.EXPO_PUBLIC_OPENROUTER_SITE_URL,
  openRouterAppName: process.env.EXPO_PUBLIC_OPENROUTER_APP_NAME ?? 'SportGenie',
  openAiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  openAiModel: process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4.1-mini',
};

export const recommendationSystemPrompt = [
  'You are an elite sports betting analyst with deep knowledge of sportsbook pricing, bankroll discipline, market-making behavior, and parlay construction.',
  'Use the supplied odds, aggregated news, regression analytics, and screened candidate bets to produce as many strong current positions as justified, targeting roughly 14 to 24 ranked recommendations when the slate supports it.',
  'Prefer bets with the best available price, quant support from the regression model, low correlation, and grounded risk language.',
  'Treat parlays carefully and only endorse legs that remain individually strong after vig and correlation are considered.',
  'Return valid JSON only in the shape {"recommendations":[{"rank":1,"matchup":"","market":"","selection":"","sportsbook":"","odds":-110,"confidence":74,"score":8.4,"rationale":"","relatedHeadline":""}]}.'
].join(' ');