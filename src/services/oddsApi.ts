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

type ProviderSummary = {
  label: string;
  events: BettingEvent[];
};

type SportCatalogEntry = {
  espnPath: string;
  sportKey: string;
  sportTitle: string;
  kalshiPrefixes: string[];
  durationHours: number;
  teamMap: Record<string, string>;
};

type GenericRecord = Record<string, unknown>;

type KalshiEventSummary = {
  event_ticker?: string;
};

type KalshiMarket = {
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
  yes_sub_title?: string;
  title?: string;
  floor_strike?: number;
  status?: string;
  expected_expiration_time?: string;
  volume_fp?: string;
};

const NBA_TEAMS: Record<string, string> = {
  ATL: 'Atlanta Hawks',
  BOS: 'Boston Celtics',
  BKN: 'Brooklyn Nets',
  CHA: 'Charlotte Hornets',
  CHI: 'Chicago Bulls',
  CLE: 'Cleveland Cavaliers',
  DAL: 'Dallas Mavericks',
  DEN: 'Denver Nuggets',
  DET: 'Detroit Pistons',
  GSW: 'Golden State Warriors',
  HOU: 'Houston Rockets',
  IND: 'Indiana Pacers',
  LAC: 'LA Clippers',
  LAL: 'Los Angeles Lakers',
  MEM: 'Memphis Grizzlies',
  MIA: 'Miami Heat',
  MIL: 'Milwaukee Bucks',
  MIN: 'Minnesota Timberwolves',
  NOP: 'New Orleans Pelicans',
  NYK: 'New York Knicks',
  OKC: 'Oklahoma City Thunder',
  ORL: 'Orlando Magic',
  PHI: 'Philadelphia 76ers',
  PHX: 'Phoenix Suns',
  POR: 'Portland Trail Blazers',
  SAC: 'Sacramento Kings',
  SAS: 'San Antonio Spurs',
  TOR: 'Toronto Raptors',
  UTA: 'Utah Jazz',
  WAS: 'Washington Wizards',
};

const NHL_TEAMS: Record<string, string> = {
  ANA: 'Anaheim Ducks',
  BOS: 'Boston Bruins',
  BUF: 'Buffalo Sabres',
  CGY: 'Calgary Flames',
  CAR: 'Carolina Hurricanes',
  CHI: 'Chicago Blackhawks',
  CBJ: 'Columbus Blue Jackets',
  COL: 'Colorado Avalanche',
  DAL: 'Dallas Stars',
  DET: 'Detroit Red Wings',
  EDM: 'Edmonton Oilers',
  FLA: 'Florida Panthers',
  LA: 'Los Angeles Kings',
  MIN: 'Minnesota Wild',
  MTL: 'Montreal Canadiens',
  NSH: 'Nashville Predators',
  NJ: 'New Jersey Devils',
  NYI: 'New York Islanders',
  NYR: 'New York Rangers',
  OTT: 'Ottawa Senators',
  PHI: 'Philadelphia Flyers',
  PIT: 'Pittsburgh Penguins',
  SEA: 'Seattle Kraken',
  SJ: 'San Jose Sharks',
  STL: 'St. Louis Blues',
  TB: 'Tampa Bay Lightning',
  TOR: 'Toronto Maple Leafs',
  UTA: 'Utah Mammoth',
  VAN: 'Vancouver Canucks',
  VGK: 'Vegas Golden Knights',
  WPG: 'Winnipeg Jets',
  WSH: 'Washington Capitals',
};

const EPL_TEAMS: Record<string, string> = {
  ARS: 'Arsenal',
  AVL: 'Aston Villa',
  BHA: 'Brighton & Hove Albion',
  BOU: 'AFC Bournemouth',
  BRE: 'Brentford',
  BUR: 'Burnley',
  CHE: 'Chelsea',
  CRY: 'Crystal Palace',
  EVE: 'Everton',
  FUL: 'Fulham',
  LIV: 'Liverpool',
  LUT: 'Luton Town',
  MCI: 'Manchester City',
  MNC: 'Manchester City',
  MUN: 'Manchester United',
  NEW: 'Newcastle United',
  NFO: 'Nottingham Forest',
  SHU: 'Sheffield United',
  TOT: 'Tottenham Hotspur',
  WHU: 'West Ham United',
  WOL: 'Wolverhampton Wanderers',
};

const SPORT_CATALOG: SportCatalogEntry[] = [
  {
    espnPath: 'basketball/nba',
    sportKey: 'basketball_nba',
    sportTitle: 'NBA',
    kalshiPrefixes: ['KXNBA'],
    durationHours: 3,
    teamMap: NBA_TEAMS,
  },
  {
    espnPath: 'hockey/nhl',
    sportKey: 'icehockey_nhl',
    sportTitle: 'NHL',
    kalshiPrefixes: ['KXNHL'],
    durationHours: 3,
    teamMap: NHL_TEAMS,
  },
  {
    espnPath: 'soccer/eng.1',
    sportKey: 'soccer_epl',
    sportTitle: 'Premier League',
    kalshiPrefixes: ['KXEPL'],
    durationHours: 2,
    teamMap: EPL_TEAMS,
  },
];

const VALID_MARKETS = new Set(['h2h', 'spreads', 'totals']);

const nowIso = () => new Date().toISOString();

const buildFreshUrl = (url: string, forceRefresh?: boolean) => {
  if (!forceRefresh) {
    return url;
  }

  const nextUrl = new URL(url);
  nextUrl.searchParams.set('_ts', String(Date.now()));

  return nextUrl.toString();
};

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalizeIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

const parseNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseAmericanOdds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  if (normalized === 'EVEN') {
    return 100;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const parseQuotedLine = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number(value.replace(/^[ou]/i, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const probabilityToAmerican = (probability: number) => {
  const bounded = Math.min(0.99, Math.max(0.01, probability));

  if (bounded >= 0.5) {
    return Math.round((-100 * bounded) / (1 - bounded));
  }

  return Math.round((100 * (1 - bounded)) / bounded);
};

const toSportsbookMarket = (key: string, lastUpdate: string, outcomes: SportsbookOutcome[]): SportsbookMarket | null => {
  const filtered = outcomes.filter((outcome) => Number.isFinite(outcome.price));

  if (filtered.length < 2 || !VALID_MARKETS.has(key)) {
    return null;
  }

  return {
    key,
    lastUpdate,
    outcomes: filtered,
  };
};

const isMeaningfulTimestamp = (value: unknown): value is string => {
  if (typeof value !== 'string') {
    return false;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > Date.parse('2000-01-01T00:00:00Z');
};

const buildOddsApiUrl = () => {
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

const normalizeOddsApiEvents = (events: OddsApiEvent[]): BettingEvent[] =>
  events.map((event) => ({
    id: event.id,
    sportKey: event.sport_key,
    sportTitle: event.sport_title,
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    bookmakers: (event.bookmakers ?? []).map((bookmaker) => ({
      key: bookmaker.key,
      title: bookmaker.title,
      lastUpdate: bookmaker.last_update,
      markets: bookmaker.markets.map((market) => ({
        key: market.key,
        lastUpdate: market.last_update,
        outcomes: market.outcomes,
      })),
    })),
  }));

const getSportCatalogByEspnPath = (path: string) =>
  SPORT_CATALOG.find((entry) => entry.espnPath === path.toLowerCase());

const getSportCatalogByKalshiSeries = (seriesTicker: string) =>
  SPORT_CATALOG.find((entry) => entry.kalshiPrefixes.some((prefix) => seriesTicker.startsWith(prefix)));

const getNestedQuote = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as GenericRecord;

  return (record.current as GenericRecord | undefined) ??
    (record.close as GenericRecord | undefined) ??
    (record.open as GenericRecord | undefined) ??
    null;
};

const buildEspnBookmaker = (oddsEntry: GenericRecord, lastUpdate: string, homeTeam: string, awayTeam: string) => {
  const provider = (oddsEntry.provider as GenericRecord | undefined) ?? {};
  const providerName = String(provider.displayName ?? provider.name ?? 'DraftKings via ESPN');
  const bookmakerKey = `espn-${slugify(providerName)}`;
  const markets: SportsbookMarket[] = [];

  const moneyline = (oddsEntry.moneyline as GenericRecord | undefined) ?? {};
  const homeMoneyline = parseAmericanOdds((getNestedQuote(moneyline.home) ?? {}).odds);
  const awayMoneyline = parseAmericanOdds((getNestedQuote(moneyline.away) ?? {}).odds);
  const drawMoneyline = parseAmericanOdds(((getNestedQuote(moneyline.draw) ?? {}).odds) ?? (oddsEntry.drawOdds as GenericRecord | undefined)?.moneyLine);

  if (homeMoneyline !== null && awayMoneyline !== null) {
    const outcomes: SportsbookOutcome[] = [
      { name: homeTeam, price: homeMoneyline },
      { name: awayTeam, price: awayMoneyline },
    ];

    if (drawMoneyline !== null) {
      outcomes.push({ name: 'Draw', price: drawMoneyline });
    }

    const market = toSportsbookMarket('h2h', lastUpdate, outcomes);
    if (market) {
      markets.push(market);
    }
  }

  const pointSpread = (oddsEntry.pointSpread as GenericRecord | undefined) ?? {};
  const homeSpreadQuote = getNestedQuote(pointSpread.home) ?? {};
  const awaySpreadQuote = getNestedQuote(pointSpread.away) ?? {};
  const homeSpreadLine = parseQuotedLine(homeSpreadQuote.line);
  const awaySpreadLine = parseQuotedLine(awaySpreadQuote.line);
  const homeSpreadPrice = parseAmericanOdds(homeSpreadQuote.odds);
  const awaySpreadPrice = parseAmericanOdds(awaySpreadQuote.odds);

  if (
    homeSpreadLine !== null &&
    awaySpreadLine !== null &&
    homeSpreadPrice !== null &&
    awaySpreadPrice !== null
  ) {
    const market = toSportsbookMarket('spreads', lastUpdate, [
      { name: homeTeam, price: homeSpreadPrice, point: homeSpreadLine },
      { name: awayTeam, price: awaySpreadPrice, point: awaySpreadLine },
    ]);

    if (market) {
      markets.push(market);
    }
  }

  const total = (oddsEntry.total as GenericRecord | undefined) ?? {};
  const overQuote = getNestedQuote(total.over) ?? {};
  const underQuote = getNestedQuote(total.under) ?? {};
  const overLine = parseQuotedLine(overQuote.line);
  const underLine = parseQuotedLine(underQuote.line);
  const overPrice = parseAmericanOdds(overQuote.odds);
  const underPrice = parseAmericanOdds(underQuote.odds);

  if (overLine !== null && underLine !== null && overPrice !== null && underPrice !== null) {
    const market = toSportsbookMarket('totals', lastUpdate, [
      { name: 'Over', price: overPrice, point: overLine },
      { name: 'Under', price: underPrice, point: underLine },
    ]);

    if (market) {
      markets.push(market);
    }
  }

  if (markets.length === 0) {
    return null;
  }

  return {
    key: bookmakerKey,
    title: `${providerName} via ESPN`,
    lastUpdate,
    markets,
  } satisfies Sportsbook;
};

const normalizeEspnEvents = (path: string, payload: GenericRecord): BettingEvent[] => {
  const catalog = getSportCatalogByEspnPath(path);

  if (!catalog) {
    return [];
  }

  const events = Array.isArray(payload.events) ? payload.events : [];

  return events
    .map((entry) => entry as GenericRecord)
    .map((event) => {
      const competition = Array.isArray(event.competitions) ? (event.competitions[0] as GenericRecord | undefined) : undefined;

      if (!competition) {
        return null;
      }

      const competitors = Array.isArray(competition.competitors)
        ? (competition.competitors as GenericRecord[])
        : [];
      const homeCompetitor = competitors.find((competitor) => competitor.homeAway === 'home');
      const awayCompetitor = competitors.find((competitor) => competitor.homeAway === 'away');

      if (!homeCompetitor || !awayCompetitor) {
        return null;
      }

      const homeTeam = String((homeCompetitor.team as GenericRecord | undefined)?.displayName ?? '').trim();
      const awayTeam = String((awayCompetitor.team as GenericRecord | undefined)?.displayName ?? '').trim();

      if (!homeTeam || !awayTeam) {
        return null;
      }

      const oddsEntries = Array.isArray(competition.odds) ? (competition.odds as GenericRecord[]) : [];
      const oddsEntry = oddsEntries[0];

      if (!oddsEntry) {
        return null;
      }

      const lastUpdate = String(event.date ?? competition.date ?? nowIso());
      const bookmaker = buildEspnBookmaker(oddsEntry, lastUpdate, homeTeam, awayTeam);

      if (!bookmaker) {
        return null;
      }

      return {
        id: `espn:${String(event.id ?? competition.id ?? `${catalog.sportKey}:${awayTeam}:${homeTeam}`)}`,
        sportKey: catalog.sportKey,
        sportTitle: catalog.sportTitle,
        commenceTime: String(event.date ?? competition.date ?? nowIso()),
        homeTeam,
        awayTeam,
        bookmakers: [bookmaker],
      } satisfies BettingEvent;
    })
    .filter((event): event is BettingEvent => Boolean(event));
};

const parseKalshiSubTitleTeams = (subTitle: string, teamMap: Record<string, string>) => {
  const trimmed = subTitle.split('(')[0].trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.includes(' at ')) {
    const [awayAbbr, homeAbbr] = trimmed.split(' at ').map((part) => part.trim().toUpperCase());
    return {
      awayTeam: teamMap[awayAbbr] ?? awayAbbr,
      homeTeam: teamMap[homeAbbr] ?? homeAbbr,
    };
  }

  if (trimmed.includes(' vs ')) {
    const [homeAbbr, awayAbbr] = trimmed.split(' vs ').map((part) => part.trim().toUpperCase());
    return {
      awayTeam: teamMap[awayAbbr] ?? awayAbbr,
      homeTeam: teamMap[homeAbbr] ?? homeAbbr,
    };
  }

  return null;
};

const parseKalshiTitleTeams = (title: string) => {
  const cleaned = title.replace(/:.*$/, '').trim();

  if (cleaned.includes(' at ')) {
    const [awayTeam, homeTeam] = cleaned.split(' at ').map((part) => part.trim());
    return { awayTeam, homeTeam };
  }

  if (cleaned.includes(' vs ')) {
    const [homeTeam, awayTeam] = cleaned.split(' vs ').map((part) => part.trim());
    return { awayTeam, homeTeam };
  }

  return null;
};

const parseKalshiProbability = (market: KalshiMarket) => {
  const yesBid = parseNumber(market.yes_bid_dollars);
  const yesAsk = parseNumber(market.yes_ask_dollars);
  const lastPrice = parseNumber(market.last_price_dollars);

  if (yesBid !== null && yesAsk !== null && yesBid > 0 && yesAsk > 0) {
    return Math.min(0.99, Math.max(0.01, (yesBid + yesAsk) / 2));
  }

  if (lastPrice !== null && lastPrice > 0 && lastPrice < 1) {
    return Math.min(0.99, Math.max(0.01, lastPrice));
  }

  if (yesBid !== null && yesBid > 0 && yesBid < 1) {
    return Math.min(0.99, Math.max(0.01, yesBid));
  }

  if (yesAsk !== null && yesAsk > 0 && yesAsk < 1) {
    return Math.min(0.99, Math.max(0.01, yesAsk));
  }

  return null;
};

const parseKalshiVolume = (market: KalshiMarket) => parseNumber(market.volume_fp) ?? 0;

const isKalshiActive = (market: KalshiMarket) => market.status === 'active';

const chooseKalshiCenterMarket = (markets: KalshiMarket[]) =>
  [...markets]
    .filter(isKalshiActive)
    .map((market) => ({
      market,
      probability: parseKalshiProbability(market),
      volume: parseKalshiVolume(market),
    }))
    .filter((entry): entry is { market: KalshiMarket; probability: number; volume: number } => entry.probability !== null)
    .sort((left, right) => {
      const distance = Math.abs(left.probability - 0.5) - Math.abs(right.probability - 0.5);

      if (distance !== 0) {
        return distance;
      }

      return right.volume - left.volume;
    })[0]?.market;

const parseSpreadDescriptor = (value: string) => {
  const match = value.match(/^(.*) wins by over ([\d.]+) /i);

  if (!match) {
    return null;
  }

  return {
    team: match[1].trim(),
    line: Number(match[2]),
  };
};

const parseTotalDescriptor = (value: string) => {
  const match = value.match(/^Over ([\d.]+) /i);
  return match ? Number(match[1]) : null;
};

const estimateKalshiCommenceTime = (markets: KalshiMarket[], durationHours: number) => {
  const expectedExpiration = markets
    .map((market) => (isMeaningfulTimestamp(market.expected_expiration_time) ? Date.parse(market.expected_expiration_time) : null))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right)[0];

  if (!expectedExpiration) {
    return nowIso();
  }

  return new Date(expectedExpiration - durationHours * 60 * 60 * 1000).toISOString();
};

const buildKalshiMarkets = (detail: GenericRecord, catalog: SportCatalogEntry, homeTeam: string, awayTeam: string) => {
  const rawMarkets = Array.isArray(detail.markets) ? (detail.markets as KalshiMarket[]) : [];
  const event = (detail.event as GenericRecord | undefined) ?? {};
  const lastUpdate = isMeaningfulTimestamp(event.last_updated_ts) ? String(event.last_updated_ts) : nowIso();
  const markets: SportsbookMarket[] = [];
  const seriesTicker = String(event.series_ticker ?? '');

  if (seriesTicker.endsWith('GAME')) {
    const outcomes = rawMarkets
      .filter(isKalshiActive)
      .map((market) => {
        const name = String(market.yes_sub_title ?? '').trim();
        const probability = parseKalshiProbability(market);

        if (!name || probability === null) {
          return null;
        }

        return {
          name,
          price: probabilityToAmerican(probability),
        } satisfies SportsbookOutcome;
      })
      .filter((outcome): outcome is SportsbookOutcome => Boolean(outcome));

    const h2hMarket = toSportsbookMarket('h2h', lastUpdate, outcomes);
    if (h2hMarket) {
      markets.push(h2hMarket);
    }
  }

  if (seriesTicker.endsWith('SPREAD')) {
    const selected = chooseKalshiCenterMarket(rawMarkets);

    if (selected) {
      const descriptor = parseSpreadDescriptor(String(selected.yes_sub_title ?? selected.title ?? ''));
      const probability = parseKalshiProbability(selected);

      if (descriptor && probability !== null) {
        const favoriteIsHome = normalizeIdentity(descriptor.team) === normalizeIdentity(homeTeam);
        const line = selected.floor_strike ?? descriptor.line;
        const homeProbability = favoriteIsHome ? probability : 1 - probability;
        const awayProbability = 1 - homeProbability;
        const spreadMarket = toSportsbookMarket('spreads', lastUpdate, [
          { name: homeTeam, price: probabilityToAmerican(homeProbability), point: favoriteIsHome ? -line : line },
          { name: awayTeam, price: probabilityToAmerican(awayProbability), point: favoriteIsHome ? line : -line },
        ]);

        if (spreadMarket) {
          markets.push(spreadMarket);
        }
      }
    }
  }

  if (seriesTicker.endsWith('TOTAL')) {
    const selected = chooseKalshiCenterMarket(rawMarkets);

    if (selected) {
      const line = selected.floor_strike ?? parseTotalDescriptor(String(selected.yes_sub_title ?? selected.title ?? ''));
      const probability = parseKalshiProbability(selected);

      if (line !== null && probability !== null) {
        const totalMarket = toSportsbookMarket('totals', lastUpdate, [
          { name: 'Over', price: probabilityToAmerican(probability), point: line },
          { name: 'Under', price: probabilityToAmerican(1 - probability), point: line },
        ]);

        if (totalMarket) {
          markets.push(totalMarket);
        }
      }
    }
  }

  return {
    lastUpdate,
    markets,
    commenceTime: estimateKalshiCommenceTime(rawMarkets, catalog.durationHours),
  };
};

const normalizeKalshiEvent = (detail: GenericRecord): BettingEvent | null => {
  const event = (detail.event as GenericRecord | undefined) ?? {};
  const seriesTicker = String(event.series_ticker ?? '');
  const catalog = getSportCatalogByKalshiSeries(seriesTicker);

  if (!catalog) {
    return null;
  }

  const teams =
    parseKalshiSubTitleTeams(String(event.sub_title ?? ''), catalog.teamMap) ??
    parseKalshiTitleTeams(String(event.title ?? ''));

  if (!teams) {
    return null;
  }

  const { lastUpdate, markets, commenceTime } = buildKalshiMarkets(detail, catalog, teams.homeTeam, teams.awayTeam);

  if (markets.length === 0) {
    return null;
  }

  return {
    id: `kalshi:${String(event.event_ticker ?? `${seriesTicker}:${teams.awayTeam}:${teams.homeTeam}`)}`,
    sportKey: catalog.sportKey,
    sportTitle: catalog.sportTitle,
    commenceTime,
    homeTeam: teams.homeTeam,
    awayTeam: teams.awayTeam,
    bookmakers: [
      {
        key: 'kalshi-exchange',
        title: 'Kalshi Exchange',
        lastUpdate,
        markets,
      },
    ],
  };
};

const mergeBookmakers = (current: Sportsbook[], incoming: Sportsbook[]) => {
  const merged = new Map<string, Sportsbook>();

  for (const bookmaker of [...current, ...incoming]) {
    const existing = merged.get(bookmaker.key);

    if (!existing) {
      merged.set(bookmaker.key, bookmaker);
      continue;
    }

    const marketMap = new Map(existing.markets.map((market) => [market.key, market]));

    for (const market of bookmaker.markets) {
      marketMap.set(market.key, market);
    }

    merged.set(bookmaker.key, {
      key: bookmaker.key,
      title: bookmaker.title,
      lastUpdate: bookmaker.lastUpdate > existing.lastUpdate ? bookmaker.lastUpdate : existing.lastUpdate,
      markets: Array.from(marketMap.values()),
    });
  }

  return Array.from(merged.values());
};

const eventMergeKey = (event: BettingEvent) => {
  const day = event.commenceTime.slice(0, 10);
  return `${event.sportKey}:${normalizeIdentity(event.homeTeam)}:${normalizeIdentity(event.awayTeam)}:${day}`;
};

const mergeEvents = (events: BettingEvent[]) => {
  const merged = new Map<string, BettingEvent>();

  for (const event of events) {
    if (event.bookmakers.length === 0) {
      continue;
    }

    const key = eventMergeKey(event);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, event);
      continue;
    }

    merged.set(key, {
      ...existing,
      commenceTime: existing.commenceTime < event.commenceTime ? existing.commenceTime : event.commenceTime,
      bookmakers: mergeBookmakers(existing.bookmakers, event.bookmakers),
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => Date.parse(left.commenceTime) - Date.parse(right.commenceTime))
    .slice(0, env.maxEvents);
};

const fetchJson = async (url: string, forceRefresh: boolean) => {
  const response = await fetch(buildFreshUrl(url, forceRefresh), {
    cache: forceRefresh ? 'no-store' : 'default',
  });

  if (!response.ok) {
    throw new Error(`Odds provider returned ${response.status}`);
  }

  return (await response.json()) as GenericRecord;
};

const fetchTheOddsApiProvider = async (forceRefresh: boolean): Promise<ProviderSummary | null> => {
  if (!env.oddsApiKey) {
    return null;
  }

  const response = await fetch(buildFreshUrl(buildOddsApiUrl(), forceRefresh), {
    cache: forceRefresh ? 'no-store' : 'default',
  });

  if (!response.ok) {
    throw new Error(`The Odds API returned ${response.status}`);
  }

  const payload = (await response.json()) as OddsApiEvent[];
  const events = normalizeOddsApiEvents(payload).filter((event) => event.bookmakers.length > 0);

  if (events.length === 0) {
    return null;
  }

  return {
    label: 'The Odds API',
    events,
  };
};

const fetchEspnProvider = async (forceRefresh: boolean): Promise<ProviderSummary | null> => {
  if (!env.enableEspnOdds || env.espnOddsSports.length === 0) {
    return null;
  }

  const payloads = await Promise.all(
    env.espnOddsSports.map(async (path) => {
      const payload = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`, forceRefresh);
      return normalizeEspnEvents(path, payload);
    })
  );

  const events = payloads.flat().filter((event) => event.bookmakers.length > 0);

  if (events.length === 0) {
    return null;
  }

  return {
    label: 'ESPN public odds',
    events,
  };
};

const fetchKalshiProvider = async (forceRefresh: boolean): Promise<ProviderSummary | null> => {
  if (!env.enableKalshiOdds || env.kalshiSeries.length === 0) {
    return null;
  }

  const summaries = await Promise.all(
    env.kalshiSeries.map(async (seriesTicker) => {
      const payload = await fetchJson(
        `${env.kalshiBaseUrl}/events?series_ticker=${encodeURIComponent(seriesTicker)}&limit=${Math.max(env.maxEvents * 3, 24)}`,
        forceRefresh
      );

      return Array.isArray(payload.events) ? (payload.events as KalshiEventSummary[]) : [];
    })
  );

  const uniqueEventTickers = Array.from(
    new Map(
      summaries
        .flat()
        .filter((event): event is KalshiEventSummary & { event_ticker: string } => typeof event.event_ticker === 'string')
        .map((event) => [event.event_ticker, event])
    ).values()
  );

  if (uniqueEventTickers.length === 0) {
    return null;
  }

  const details = await Promise.all(
    uniqueEventTickers.map(async (summary) =>
      fetchJson(`${env.kalshiBaseUrl}/events/${encodeURIComponent(summary.event_ticker!)}`, forceRefresh)
    )
  );

  const events = details
    .map((detail) => normalizeKalshiEvent(detail))
    .filter((event): event is BettingEvent => Boolean(event));

  if (events.length === 0) {
    return null;
  }

  return {
    label: 'Kalshi sports exchange',
    events,
  };
};

const providerFetchers: Record<string, (forceRefresh: boolean) => Promise<ProviderSummary | null>> = {
  espn: fetchEspnProvider,
  kalshi: fetchKalshiProvider,
  'the-odds-api': fetchTheOddsApiProvider,
};

export async function fetchOdds({ forceRefresh = false }: FetchOptions = {}): Promise<ProviderResult<BettingEvent[]>> {
  const requestedProviders = env.oddsProviderOrder.filter((provider) => provider in providerFetchers);

  const results = await Promise.allSettled(requestedProviders.map((provider) => providerFetchers[provider](forceRefresh)));

  const successfulProviders = results
    .filter((result): result is PromiseFulfilledResult<ProviderSummary | null> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((provider): provider is ProviderSummary => Boolean(provider));

  const events = mergeEvents(successfulProviders.flatMap((provider) => provider.events));

  if (events.length === 0) {
    return {
      data: mockEvents,
      provider: 'Mock fallback',
    };
  }

  return {
    data: events,
    provider: `Live ${successfulProviders.map((provider) => provider.label).join(' + ')}`,
  };
}
