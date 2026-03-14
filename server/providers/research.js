const { getPlayerProfiles } = require('./playerStats');

const normalizeText = (value) => String(value || '').toLowerCase();

const decodeXmlEntities = (value) =>
  String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const stripTags = (value) => decodeXmlEntities(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const readTag = (block, tagName) => {
  const match = String(block || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));

  return match ? match[1].trim() : undefined;
};

const parseRssItems = (xml) => {
  const matches = String(xml || '').match(/<item[\s\S]*?<\/item>/gi) || [];

  return matches.map((item) => ({
    title: readTag(item, 'title'),
    description: readTag(item, 'description'),
    link: readTag(item, 'link'),
    pubDate: readTag(item, 'pubDate'),
    source: item.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1],
  }));
};

const buildGoogleNewsSearchUrl = (query) => {
  const params = new URLSearchParams({
    q: query,
    hl: 'en-US',
    gl: 'US',
    ceid: 'US:en',
  });

  return `https://news.google.com/rss/search?${params.toString()}`;
};

const buildSearchBlob = (value) =>
  normalizeText(
    Array.isArray(value)
      ? value.join(' ')
      : typeof value === 'object' && value !== null
        ? Object.values(value).join(' ')
        : value
  );

const scoreMatch = (query, value) => {
  const tokens = normalizeText(query)
    .split(/\s+/)
    .filter((token) => token.length > 1);

  if (tokens.length === 0) {
    return 0;
  }

  const haystack = buildSearchBlob(value);

  return tokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
};

const summarizeEvent = (event) => ({
  id: event.id,
  sportTitle: event.sportTitle,
  matchup: `${event.awayTeam} at ${event.homeTeam}`,
  commenceTime: event.commenceTime,
  bookmakers: (event.bookmakers || []).slice(0, 3).map((bookmaker) => ({
    title: bookmaker.title,
    markets: (bookmaker.markets || []).slice(0, 3).map((market) => ({
      key: market.key,
      outcomes: (market.outcomes || []).slice(0, 4),
    })),
  })),
});

const summarizeCandidate = (candidate) => ({
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

const summarizeArticle = (article) => ({
  title: article.title,
  description: article.description,
  source: article.source,
  publishedAt: article.publishedAt,
  url: article.url,
});

const summarizeProfile = (profile) => ({
  id: profile.id,
  name: profile.name,
  team: profile.team,
  sportKey: profile.sportKey,
  position: profile.position,
  primaryStatLabel: profile.primaryStatLabel,
  recentGames: Array.isArray(profile.recentGames) ? profile.recentGames.slice(0, 5) : [],
});

async function searchNews({ query, limit = 6 }) {
  const response = await fetch(buildGoogleNewsSearchUrl(query));

  if (!response.ok) {
    throw new Error(`Google News search returned ${response.status}`);
  }

  const articles = parseRssItems(await response.text())
    .filter((item) => item.title && item.link)
    .map((item) => ({
      title: stripTags(item.title),
      description: stripTags(item.description || ''),
      url: stripTags(item.link),
      source: stripTags(item.source || 'Google News'),
      publishedAt: item.pubDate ? new Date(stripTags(item.pubDate)).toISOString() : new Date().toISOString(),
    }))
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 6)));

  return {
    query,
    articles,
  };
}

async function loadPlayerProfiles({ teams = [], sportKeys = [] }) {
  const payload = await getPlayerProfiles({
    teams: new Set((Array.isArray(teams) ? teams : []).filter(Boolean)),
    sportKeys: new Set((Array.isArray(sportKeys) ? sportKeys : []).filter(Boolean)),
  });

  return {
    provider: payload.provider,
    profiles: payload.profiles.slice(0, 12).map(summarizeProfile),
  };
}

function searchContext({ query, events = [], news = [], analytics = {}, candidates = [], limit = 6 }) {
  const maxResults = Math.max(1, Math.min(12, Number(limit) || 6));

  const matchedEvents = events
    .map((event) => ({ score: scoreMatch(query, [event.sportTitle, event.homeTeam, event.awayTeam]), item: summarizeEvent(event) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map((entry) => entry.item);

  const matchedCandidates = candidates
    .map((candidate) => ({
      score: scoreMatch(query, [candidate.matchup, candidate.market, candidate.selection, candidate.rationale, candidate.relatedHeadline]),
      item: summarizeCandidate(candidate),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.item.score - left.item.score)
    .slice(0, maxResults)
    .map((entry) => entry.item);

  const matchedNews = news
    .map((article) => ({ score: scoreMatch(query, article), item: summarizeArticle(article) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, maxResults)
    .map((entry) => entry.item);

  const matchedModels = (analytics.eventModels || [])
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
    }));

  return {
    query,
    matchedEvents,
    matchedCandidates,
    matchedNews,
    matchedModels,
  };
}

function getTopCandidates({ candidates = [], limit = 8, market, matchup, sportTitle }) {
  return candidates
    .filter((candidate) => {
      if (market && candidate.market !== market) {
        return false;
      }

      if (matchup && normalizeText(candidate.matchup) !== normalizeText(matchup)) {
        return false;
      }

      if (sportTitle && !normalizeText(candidate.matchup).includes(normalizeText(sportTitle))) {
        return false;
      }

      return true;
    })
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 8)))
    .map(summarizeCandidate);
}

module.exports = {
  searchNews,
  loadPlayerProfiles,
  searchContext,
  getTopCandidates,
};