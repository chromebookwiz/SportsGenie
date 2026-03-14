import { env } from '../config/env';
import { mockEvents } from '../data/mock';
import type { BettingEvent, ProviderResult, Sportsbook, SportsbookMarket, SportsbookOutcome } from '../types/sports';

type FetchOptions = {
  forceRefresh?: boolean;
};

type OddsApiOutcome = SportsbookOutcome;

type OddsApiMarket = {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
};

type OddsApiEvent = {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
};

const buildUrl = () => {
  const params = new URLSearchParams({
    apiKey: env.oddsApiKey ?? '',
    regions: env.oddsRegions,
    markets: env.oddsMarkets,
    oddsFormat: 'american',
    dateFormat: 'iso',
  });

  if (env.oddsBookmakers) {
    params.set('bookmakers', env.oddsBookmakers);
  }

  return `https://api.the-odds-api.com/v4/sports/upcoming/odds/?${params.toString()}`;
};

const buildFreshUrl = (url: string, forceRefresh?: boolean) => {
  if (!forceRefresh) {
    return url;
  }

  const nextUrl = new URL(url);
  nextUrl.searchParams.set('_ts', String(Date.now()));

  return nextUrl.toString();
};

const normalizeBookmakers = (bookmakers: OddsApiBookmaker[]): Sportsbook[] =>
  bookmakers.map((bookmaker) => ({
    key: bookmaker.key,
    title: bookmaker.title,
    lastUpdate: bookmaker.last_update,
    markets: bookmaker.markets.map(
      (market): SportsbookMarket => ({
        key: market.key,
        lastUpdate: market.last_update,
        outcomes: market.outcomes,
      })
    ),
  }));

const normalizeEvents = (events: OddsApiEvent[]): BettingEvent[] =>
  events.slice(0, env.maxEvents).map((event) => ({
    id: event.id,
    sportKey: event.sport_key,
    sportTitle: event.sport_title,
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers: normalizeBookmakers(event.bookmakers ?? []),
  }));

export async function fetchOdds({ forceRefresh = false }: FetchOptions = {}): Promise<ProviderResult<BettingEvent[]>> {
  if (!env.oddsApiKey) {
    return {
      data: mockEvents,
      provider: 'Mock fallback',
    };
  }

  try {
    const response = await fetch(buildFreshUrl(buildUrl(), forceRefresh), {
      cache: forceRefresh ? 'no-store' : 'default',
    });

    if (!response.ok) {
      throw new Error(`Odds provider returned ${response.status}`);
    }

    const payload = (await response.json()) as OddsApiEvent[];
    const events = normalizeEvents(payload).filter((event) => event.bookmakers.length > 0);

    if (events.length === 0) {
      throw new Error('Odds provider returned no events');
    }

    const bookmakerCount = new Set(
      events.flatMap((event) => event.bookmakers.map((bookmaker) => bookmaker.key))
    ).size;

    return {
      data: events,
      provider: `Live The Odds API (${bookmakerCount} books)`,
    };
  } catch {
    return {
      data: mockEvents,
      provider: 'Mock fallback',
    };
  }
}