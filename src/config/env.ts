import { Platform } from 'react-native';

const toNumber = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
};

const defaultProxyBaseUrl = process.env.EXPO_PUBLIC_PROXY_BASE_URL ?? (Platform.OS === 'web' ? '' : undefined);

export const env = {
  proxyBaseUrl: defaultProxyBaseUrl,
  oddsApiKey: process.env.EXPO_PUBLIC_ODDS_API_KEY,
  oddsRegions: process.env.EXPO_PUBLIC_ODDS_REGIONS ?? 'us',
  oddsMarkets: process.env.EXPO_PUBLIC_ODDS_MARKETS ?? 'h2h,spreads,totals',
  oddsBookmakers: process.env.EXPO_PUBLIC_ODDS_BOOKMAKERS,
  maxEvents: toNumber(process.env.EXPO_PUBLIC_MAX_EVENTS, 12),
  newsApiKey: process.env.EXPO_PUBLIC_NEWS_API_KEY,
  newsBaseUrl: process.env.EXPO_PUBLIC_NEWS_BASE_URL ?? 'https://newsapi.org/v2/everything',
  gNewsApiKey: process.env.EXPO_PUBLIC_GNEWS_API_KEY,
  gNewsBaseUrl: process.env.EXPO_PUBLIC_GNEWS_BASE_URL ?? 'https://gnews.io/api/v4/search',
  currentsApiKey: process.env.EXPO_PUBLIC_CURRENTS_API_KEY,
  currentsBaseUrl: process.env.EXPO_PUBLIC_CURRENTS_BASE_URL ?? 'https://api.currentsapi.services/v1/search',
  newsQuery: process.env.EXPO_PUBLIC_NEWS_QUERY ?? 'sports betting OR odds OR NFL OR NBA OR MLB OR NHL OR UFC OR soccer',
  newsLanguage: process.env.EXPO_PUBLIC_NEWS_LANGUAGE ?? 'en',
  newsPageSize: toNumber(process.env.EXPO_PUBLIC_NEWS_PAGE_SIZE, 10),
  newsProviderOrder: (process.env.EXPO_PUBLIC_NEWS_PROVIDER_ORDER ?? 'newsapi,gnews,currents')
    .split(',')
    .map((value: string) => value.trim().toLowerCase())
    .filter(Boolean),
  llmProxyUrl:
    process.env.EXPO_PUBLIC_LLM_PROXY_URL ??
    (defaultProxyBaseUrl !== undefined ? `${defaultProxyBaseUrl}/api/llm/recommendations` : undefined),
  openRouterApiKey: process.env.EXPO_PUBLIC_OPENROUTER_API_KEY,
  openRouterModel: process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'openai/gpt-4.1-mini',
  openRouterSiteUrl: process.env.EXPO_PUBLIC_OPENROUTER_SITE_URL,
  openRouterAppName: process.env.EXPO_PUBLIC_OPENROUTER_APP_NAME ?? 'SportGenie',
  openAiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY,
  openAiModel: process.env.EXPO_PUBLIC_OPENAI_MODEL ?? 'gpt-4.1-mini',
};

export const recommendationSystemPrompt = [
  'You are an elite sports betting analyst with deep knowledge of sportsbook pricing, bankroll discipline, market-making behavior, and parlay construction.',
  'Use the supplied odds, aggregated news, regression analytics, and screened candidate bets to produce the five strongest current positions.',
  'Prefer bets with the best available price, quant support from the regression model, low correlation, and grounded risk language.',
  'Treat parlays carefully and only endorse legs that remain individually strong after vig and correlation are considered.',
  'Return valid JSON only in the shape {"recommendations":[{"rank":1,"matchup":"","market":"","selection":"","sportsbook":"","odds":-110,"confidence":74,"score":8.4,"rationale":"","relatedHeadline":""}]}.'
].join(' ');