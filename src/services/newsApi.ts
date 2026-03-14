import { env } from '../config/env';
import { mockNews } from '../data/mock';
import type { NewsArticle, ProviderResult } from '../types/sports';

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
    const key = article.url.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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

const providerLoaders: Record<string, () => Promise<NewsArticle[] | null>> = {
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

    const articles = dedupeArticles(successful.flatMap((result) => result.value.articles ?? [])).slice(0, env.newsPageSize * 2);

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