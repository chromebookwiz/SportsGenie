export type SportsbookOutcome = {
  name: string;
  price: number;
  point?: number | null;
};

export type PlayerGameLog = {
  date: string;
  opponent: string;
  home: boolean;
  minutes: number;
  primaryStat: number;
  secondaryStat: number;
  tertiaryStat: number;
  usageRate: number;
};

export type PlayerPerformanceProfile = {
  id: string;
  name: string;
  team: string;
  sportKey: string;
  position: string;
  primaryStatLabel: string;
  recentGames: PlayerGameLog[];
};

export type PlayerProjection = {
  playerId: string;
  playerName: string;
  team: string;
  metric: string;
  projectedValue: number;
  baselineAverage: number;
  trendSlope: number;
  trendLabel: 'rising' | 'flat' | 'falling';
  confidence: number;
};

export type TeamModel = {
  team: string;
  sportKey: string;
  formScore: number;
  projectedAdvantage: number;
  injuryRisk: number;
  stabilityScore: number;
  playerProjections: PlayerProjection[];
};

export type EventModel = {
  eventId: string;
  matchup: string;
  homeTeam: TeamModel;
  awayTeam: TeamModel;
  expectedMargin: number;
  marginStdDev: number;
  totalProjection: number;
  totalStdDev: number;
  homeWinProbability: number;
  awayWinProbability: number;
  drawProbability: number;
  volatility: number;
  bestAngles: string[];
};

export type AnalyticsOverview = {
  generatedAt: string;
  eventModels: EventModel[];
  featuredPlayers: PlayerProjection[];
  marketPulse: {
    averageConfidence: number;
    averageVolatility: number;
    bestEnvironment: string;
    averageStability: number;
  };
};

export type BacktestSample = {
  id: string;
  date: string;
  sportTitle: string;
  matchup: string;
  market: string;
  selection: string;
  odds: number;
  impliedProbability: number;
  fairProbability: number;
  expectedValue: number;
  kellyFraction: number;
  actualWin: boolean;
  profitUnits: number;
};

export type BacktestSummary = {
  sampleSize: number;
  winRate: number;
  roi: number;
  profitUnits: number;
  averageEdge: number;
  averageKelly: number;
  maxDrawdown: number;
  brierScore: number;
  calibrationGrade: string;
  recentSamples: BacktestSample[];
};

export type ParlayLeg = {
  recommendationId: string;
  matchup: string;
  selection: string;
  market: string;
  odds: number;
  sportsbook: string;
  edgePercent: number;
};

export type ParlayRecommendation = {
  id: string;
  title: string;
  combinedOdds: number;
  confidence: number;
  correlationRisk: 'low' | 'medium';
  rationale: string;
  expectedValue: number;
  kellyFraction: number;
  simulatedHitRate: number;
  legs: ParlayLeg[];
};

export type SportsbookMarket = {
  key: string;
  lastUpdate: string;
  outcomes: SportsbookOutcome[];
};

export type Sportsbook = {
  key: string;
  title: string;
  lastUpdate: string;
  markets: SportsbookMarket[];
};

export type BettingEvent = {
  id: string;
  sportKey: string;
  sportTitle: string;
  commenceTime: string;
  homeTeam: string;
  awayTeam: string;
  bookmakers: Sportsbook[];
};

export type NewsArticle = {
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  imageUrl?: string;
};

export type Recommendation = {
  id: string;
  rank: number;
  matchup: string;
  market: string;
  selection: string;
  sportsbook: string;
  odds: number;
  confidence: number;
  score: number;
  rationale: string;
  relatedHeadline?: string;
  edgePercent?: number;
  riskLabel?: 'low' | 'medium' | 'high';
  modelSummary?: string;
  supportingPlayers?: string[];
  parlayEligible?: boolean;
  impliedProbability?: number;
  fairProbability?: number;
  expectedValue?: number;
  kellyFraction?: number;
  simulatedWinRate?: number;
};

export type DashboardData = {
  bets: BettingEvent[];
  news: NewsArticle[];
  recommendations: Recommendation[];
  analytics: AnalyticsOverview;
  parlays: ParlayRecommendation[];
  backtest: BacktestSummary;
  providers: {
    odds: string;
    news: string;
    recommendations: string;
    analytics: string;
    backtest: string;
  };
};

export type ProviderResult<T> = {
  data: T;
  provider: string;
};