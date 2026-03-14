import { env } from '../config/env';
import { mockNews } from '../data/mock';
import type { NewsArticle, ProviderResult } from '../types/sports';

type RssFeedItem = {
  title?: string;
  description?: string;
  link?: string;
  pubDate?: string;
  source?: string;
};

type NewsApiResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    url?: string;
    publishedAt?: string;
    urlToImage?: string;
    source?: {
      name?: string;
    };
  }>;
};

type GNewsResponse = {
  articles?: Array<{
    title?: string;
    description?: string;
    url?: string;
    publishedAt?: string;
    image?: string;
    source?: {
      name?: string;
    };
  }>;
};

type CurrentsResponse = {
  news?: Array<{
    title?: string;
    description?: string;
    url?: string;
    published?: string;
    image?: string;
    author?: string;
  }>;
};

const buildNewsApiUrl = () => {
  const params = new URLSearchParams({
    q: env.newsQuery,
    language: env.newsLanguage,
    pageSize: String(env.newsPageSize),
    sortBy: 'publishedAt',
    apiKey: env.newsApiKey ?? '',
  });

  return `${env.newsBaseUrl}?${params.toString()}`;
};

const buildGNewsUrl = () => {
  const params = new URLSearchParams({
    q: env.newsQuery,
    lang: env.newsLanguage,
    max: String(env.newsPageSize),
    sortby: 'publishedAt',
    apikey: env.gNewsApiKey ?? '',
  });

  return `${env.gNewsBaseUrl}?${params.toString()}`;
};

const buildCurrentsUrl = () => {
  const params = new URLSearchParams({
    keywords: env.newsQuery,
    language: env.newsLanguage,
    limit: String(env.newsPageSize),
    apiKey: env.currentsApiKey ?? '',
  });

  return `${env.currentsBaseUrl}?${params.toString()}`;
};

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

const parseRssItems = (xml: string): RssFeedItem[] => {
  const matches = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];

  return matches.map((item) => {
    const description = readTag(item, 'description');
    const sourceTag = item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1];

    return {
      title: readTag(item, 'title'),
      description,
      link: readTag(item, 'link'),
      pubDate: readTag(item, 'pubDate'),
      source: sourceTag,
    };
  });
};

const googleRssDescriptionSource = (description: string) => {
  const text = decodeXmlEntities(description);
  const fontMatch = text.match(/<font[^>]*>([\s\S]*?)<\/font>/i);

  return fontMatch ? stripTags(fontMatch[1]) : 'Google News';
};

const normalizeRssArticles = (items: RssFeedItem[], defaultSource: string, sourceFromDescription?: (description: string) => string): NewsArticle[] =>
  items
    .filter((item) => item.title && item.link && item.pubDate)
    .map((item) => {
      const description = item.description ? stripTags(item.description) : '';

      return {
        title: stripTags(item.title ?? ''),
        description,
        url: stripTags(item.link ?? ''),
        source: item.description && sourceFromDescription ? sourceFromDescription(item.description) : stripTags(item.source ?? '') || defaultSource,
        publishedAt: new Date(stripTags(item.pubDate ?? '')).toISOString(),
      };
    });

const normalizeArticles = (payload: NewsApiResponse): NewsArticle[] =>
  (payload.articles ?? [])
    .filter((article) => article.title && article.url && article.publishedAt)
    .map((article) => ({
      title: article.title ?? '',
      description: article.description ?? '',
      url: article.url ?? '',
      source: article.source?.name ?? 'Unknown Source',
      publishedAt: article.publishedAt ?? new Date().toISOString(),
      imageUrl: article.urlToImage,
    }));

const normalizeGNewsArticles = (payload: GNewsResponse): NewsArticle[] =>
  (payload.articles ?? [])
    .filter((article) => article.title && article.url && article.publishedAt)
    .map((article) => ({
      title: article.title ?? '',
      description: article.description ?? '',
      url: article.url ?? '',
      source: article.source?.name ?? 'GNews',
      publishedAt: article.publishedAt ?? new Date().toISOString(),
      imageUrl: article.image,
    }));

const normalizeCurrentsArticles = (payload: CurrentsResponse): NewsArticle[] =>
  (payload.news ?? [])
    .filter((article) => article.title && article.url && article.published)
    .map((article) => ({
      title: article.title ?? '',
      description: article.description ?? '',
      url: article.url ?? '',
      source: article.author ?? 'Currents',
      publishedAt: article.published ?? new Date().toISOString(),
      imageUrl: article.image,
    }));

const dedupeArticles = (articles: NewsArticle[]) => {
  const seen = new Set<string>();

  return articles.filter((article) => {
    const key = `${article.title.toLowerCase()}::${article.source.toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const isRelevantArticle = (article: NewsArticle) => {
  const blob = `${article.title} ${article.description} ${article.source}`.toLowerCase();
  const includeTerms = [
    'odds',
    'bet',
    'sports betting',
    'spread',
    'moneyline',
    'total',
    'parlay',
    'nfl',
    'nba',
    'nhl',
    'mlb',
    'soccer',
    'premier league',
    'ufc',
    'college basketball',
  ];
  const excludeTerms = ['promo code', 'bonus code', 'advertisement', 'brand campaign'];

  return includeTerms.some((term) => blob.includes(term)) && !excludeTerms.some((term) => blob.includes(term));
};

const fetchNewsApiArticles = async () => {
  if (!env.newsApiKey) {
    return null;
  }

  const response = await fetch(buildNewsApiUrl());

  if (!response.ok) {
    throw new Error(`NewsAPI returned ${response.status}`);
  }

  return normalizeArticles((await response.json()) as NewsApiResponse);
};

const fetchGNewsArticles = async () => {
  if (!env.gNewsApiKey) {
    return null;
  }

  const response = await fetch(buildGNewsUrl());

  if (!response.ok) {
    throw new Error(`GNews returned ${response.status}`);
  }

  return normalizeGNewsArticles((await response.json()) as GNewsResponse);
};

const fetchCurrentsArticles = async () => {
  if (!env.currentsApiKey) {
    return null;
  }

  const response = await fetch(buildCurrentsUrl());

  if (!response.ok) {
    throw new Error(`Currents returned ${response.status}`);
  }

  return normalizeCurrentsArticles((await response.json()) as CurrentsResponse);
};

const fetchGoogleNewsArticles = async () => {
  const response = await fetch(env.googleNewsRssUrl);

  if (!response.ok) {
    throw new Error(`Google News RSS returned ${response.status}`);
  }

  return normalizeRssArticles(parseRssItems(await response.text()), 'Google News', googleRssDescriptionSource);
};

const fetchEspnRssArticles = async () => {
  const response = await fetch(env.espnRssUrl);

  if (!response.ok) {
    throw new Error(`ESPN RSS returned ${response.status}`);
  }

  return normalizeRssArticles(parseRssItems(await response.text()), 'ESPN');
};

const providerLoaders: Record<string, () => Promise<NewsArticle[] | null>> = {
  google: fetchGoogleNewsArticles,
  espn: fetchEspnRssArticles,
  newsapi: fetchNewsApiArticles,
  gnews: fetchGNewsArticles,
  currents: fetchCurrentsArticles,
};

export async function fetchNews(): Promise<ProviderResult<NewsArticle[]>> {
  const activeProviders = env.newsProviderOrder.filter((provider: string) => providerLoaders[provider]);

  if (activeProviders.length === 0) {
    return {
      data: mockNews,
      provider: 'Mock fallback',
    };
  }

  try {
    const settledResults = await Promise.allSettled(
      activeProviders.map(async (provider: string) => ({
        provider,
        articles: await providerLoaders[provider](),
      }))
    );

    const successful = settledResults
      .filter((result): result is PromiseFulfilledResult<{ provider: string; articles: NewsArticle[] | null }> => result.status === 'fulfilled')
      .filter((result) => (result.value.articles?.length ?? 0) > 0);

    const articles = dedupeArticles(successful.flatMap((result) => result.value.articles ?? []).filter(isRelevantArticle)).slice(0, env.newsPageSize * 3);

    if (articles.length === 0) {
      throw new Error('News provider returned no articles');
    }

    return {
      data: articles,
      provider: `Live ${successful.map((result) => result.value.provider).join(' + ')}`,
    };
  } catch {
    return {
      data: mockNews,
      provider: 'Mock fallback',
    };
  }
}