import { env, recommendationSystemPrompt } from '../config/env';
import type { AnalyticsOverview, BettingEvent, NewsArticle, ProviderResult, Recommendation, SportsbookOutcome } from '../types/sports';
import {
  americanToImpliedProbability,
  clamp,
  expectedValue as calculateExpectedValue,
  kellyFraction as calculateKellyFraction,
  monteCarloWinRate,
  normalCdf,
  normalizedProbabilities,
  standardDeviation,
  zScore,
} from './quant';
import { callWebLlm, isWebLlmSupported } from './webllm';

type CandidateBet = {
  id: string;
  matchup: string;
  market: string;
  selection: string;
  sportsbook: string;
  lastUpdate: string;
  odds: number;
  point?: number | null;
  score: number;
  confidence: number;
  rationale: string;
  relatedHeadline?: string;
  bookmakerCount: number;
  marketHold: number;
  lineValue: number;
  startsInHours: number;
  marketFreshnessHours: number;
  modelAgreement: number;
  edgePercent: number;
  modelDelta: number;
  supportingPlayers: string[];
  modelSummary: string;
  parlayEligible: boolean;
  impliedProbability: number;
  fairProbability: number;
  expectedValue: number;
  kellyFraction: number;
  simulatedWinRate: number;
};

type LlmResponse = {
  recommendations?: Array<{
    rank?: number;
    matchup?: string;
    market?: string;
    selection?: string;
    sportsbook?: string;
    odds?: number;
    confidence?: number;
    score?: number;
    rationale?: string;
    relatedHeadline?: string;
  }>;
};

type LlmProviderKey = 'proxy' | 'webllm' | 'openrouter' | 'openai';

type LlmRequestContext = {
  events: BettingEvent[];
  news: NewsArticle[];
  analytics: AnalyticsOverview;
  candidates: CandidateBet[];
};

const marketPriority: Record<string, number> = {
  h2h: 3,
  spreads: 2.6,
  totals: 2.4,
};

const candidateLabel = (outcome: SportsbookOutcome) => {
  if (typeof outcome.point === 'number') {
    return `${outcome.name} ${outcome.point > 0 ? '+' : ''}${outcome.point}`;
  }

  return outcome.name;
};

const sameOutcome = (left: SportsbookOutcome, right: SportsbookOutcome) =>
  left.name === right.name && (left.point ?? null) === (right.point ?? null);

const findRelatedHeadline = (event: BettingEvent, news: NewsArticle[]) => {
  const haystacks = [event.homeTeam.toLowerCase(), event.awayTeam.toLowerCase(), event.sportTitle.toLowerCase()];

  return news.find((article) => {
    const blob = `${article.title} ${article.description}`.toLowerCase();

    return haystacks.some((needle) => blob.includes(needle));
  });
};

const buildOutcomeKey = (eventId: string, marketKey: string, outcome: SportsbookOutcome) =>
  `${eventId}:${marketKey}:${outcome.name}:${outcome.point ?? 'na'}`;

const startsInHours = (commenceTime: string) => (new Date(commenceTime).getTime() - Date.now()) / (1000 * 60 * 60);

const hoursSince = (value: string) => {
  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return 999;
  }

  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
};

const isPriceInRange = (odds: number) => odds >= -env.maxAbsoluteFavoritePrice && odds <= env.maxLongshotPrice;

const probabilityBlendWeights = (marketKey: string) => {
  if (marketKey === 'totals') {
    return {
      simulated: 0.46,
      analytical: 0.29,
      consensus: 0.25,
    };
  }

  if (marketKey === 'spreads') {
    return {
      simulated: 0.42,
      analytical: 0.33,
      consensus: 0.25,
    };
  }

  return {
    simulated: 0.38,
    analytical: 0.37,
    consensus: 0.25,
  };
};

const buildMarketSnapshot = (event: BettingEvent) => {
  const snapshot = new Map<string, SportsbookOutcome[]>();

  for (const bookmaker of event.bookmakers) {
    for (const market of bookmaker.markets) {
      const marketKey = `${event.id}:${market.key}`;
      const outcomes = snapshot.get(marketKey) ?? [];
      outcomes.push(...market.outcomes);
      snapshot.set(marketKey, outcomes);
    }
  }

  return snapshot;
};

const calculateMarketHold = (outcomes: SportsbookOutcome[]) => {
  if (outcomes.length < 2) {
    return 0;
  }

  return outcomes.reduce((sum, outcome) => sum + americanToImpliedProbability(outcome.price), 0) - 1;
};

const buildConsensusFairProbability = (event: BettingEvent, marketKey: string, targetOutcome: SportsbookOutcome) => {
  const probabilities = event.bookmakers
    .flatMap((bookmaker) => bookmaker.markets.filter((market) => market.key === marketKey))
    .map((market) => {
      const normalized = normalizedProbabilities(market.outcomes.map((outcome) => outcome.price));
      const outcomeIndex = market.outcomes.findIndex((outcome) => sameOutcome(outcome, targetOutcome));

      return outcomeIndex >= 0 ? normalized[outcomeIndex] : null;
    })
    .filter((value): value is number => typeof value === 'number');

  if (probabilities.length === 0) {
    return null;
  }

  return probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length;
};

const buildModelProbability = (
  event: BettingEvent,
  marketKey: string,
  outcome: SportsbookOutcome,
  analytics: AnalyticsOverview
) => {
  const model = getEventModel(analytics, `${event.awayTeam} at ${event.homeTeam}`);

  if (!model) {
    return 0.5;
  }

  if (marketKey === 'h2h') {
    if (outcome.name === event.homeTeam) {
      return model.homeWinProbability;
    }

    if (outcome.name === event.awayTeam) {
      return model.awayWinProbability;
    }

    return model.drawProbability || 0.14;
  }

  if (marketKey === 'spreads' && typeof outcome.point === 'number') {
    if (outcome.name === event.homeTeam) {
      return 1 - normalCdf(-outcome.point, model.expectedMargin, model.marginStdDev);
    }

    return normalCdf(outcome.point, model.expectedMargin, model.marginStdDev);
  }

  if (marketKey === 'totals' && typeof outcome.point === 'number') {
    if (outcome.name.toLowerCase() === 'over') {
      return 1 - normalCdf(outcome.point, model.totalProjection, model.totalStdDev);
    }

    return normalCdf(outcome.point, model.totalProjection, model.totalStdDev);
  }

  return 0.5;
};

const buildSimulatedProbability = (
  event: BettingEvent,
  marketKey: string,
  outcome: SportsbookOutcome,
  analytics: AnalyticsOverview
) => {
  const model = getEventModel(analytics, `${event.awayTeam} at ${event.homeTeam}`);

  if (!model) {
    return 0.5;
  }

  if (marketKey === 'h2h') {
    if (outcome.name === event.homeTeam) {
      return monteCarloWinRate({
        seed: `${event.id}:h2h:home`,
        iterations: 450,
        meanValue: model.expectedMargin,
        stdDev: model.marginStdDev,
        comparator: (sample) => sample > 0,
      });
    }

    if (outcome.name === event.awayTeam) {
      return monteCarloWinRate({
        seed: `${event.id}:h2h:away`,
        iterations: 450,
        meanValue: model.expectedMargin,
        stdDev: model.marginStdDev,
        comparator: (sample) => sample < 0,
      });
    }

    return model.drawProbability || 0.14;
  }

  if (marketKey === 'spreads' && typeof outcome.point === 'number') {
    const line = outcome.point;

    if (outcome.name === event.homeTeam) {
      return monteCarloWinRate({
        seed: `${event.id}:spread:home:${outcome.point}`,
        iterations: 450,
        meanValue: model.expectedMargin,
        stdDev: model.marginStdDev,
        comparator: (sample) => sample + line > 0,
      });
    }

    return monteCarloWinRate({
      seed: `${event.id}:spread:away:${outcome.point}`,
      iterations: 450,
      meanValue: model.expectedMargin,
      stdDev: model.marginStdDev,
      comparator: (sample) => sample < line,
    });
  }

  if (marketKey === 'totals' && typeof outcome.point === 'number') {
    const line = outcome.point;

    return monteCarloWinRate({
      seed: `${event.id}:total:${outcome.name}:${outcome.point}`,
      iterations: 450,
      meanValue: model.totalProjection,
      stdDev: model.totalStdDev,
      comparator: (sample) => (outcome.name.toLowerCase() === 'over' ? sample > line : sample < line),
    });
  }

  return 0.5;
};

const buildPrefilterReason = (candidate: CandidateBet) => {
  if (candidate.bookmakerCount < env.minBookmakerCount) {
    return 'Too few books posted this exact selection.';
  }

  if (!isPriceInRange(candidate.odds)) {
    return 'Price sits in a poor risk-reward range.';
  }

  if (candidate.marketHold > env.maxMarketHold) {
    return 'Market vig is too high.';
  }

  if (candidate.lineValue < env.minLineValue) {
    return 'Best line does not separate enough from the market consensus.';
  }

  if (candidate.edgePercent < env.minEdgePercent) {
    return 'Quant edge is too small.';
  }

  if (candidate.expectedValue < env.minExpectedValue) {
    return 'Expected value is too weak.';
  }

  if (candidate.kellyFraction < env.minKellyFraction) {
    return 'Kelly stake is too small to justify the risk.';
  }

  if (candidate.startsInHours <= 0 || candidate.startsInHours > env.maxEventWindowHours) {
    return 'Event timing is outside the target recommendation window.';
  }

  return null;
};

const qualifiesForBackfill = (candidate: CandidateBet) => {
  if (!isPriceInRange(candidate.odds)) {
    return false;
  }

  if (candidate.marketHold > env.maxMarketHold * 1.1) {
    return false;
  }

  if (candidate.lineValue < env.minLineValue * 0.5) {
    return false;
  }

  if (candidate.edgePercent < env.minEdgePercent * 0.5) {
    return false;
  }

  if (candidate.expectedValue <= 0) {
    return false;
  }

  if (candidate.kellyFraction < Math.min(env.minKellyFraction, 0.001)) {
    return false;
  }

  if (candidate.startsInHours <= 0 || candidate.startsInHours > env.maxEventWindowHours) {
    return false;
  }

  return true;
};

const getEventModel = (analytics: AnalyticsOverview, matchup: string) =>
  analytics.eventModels.find((model) => model.matchup === matchup);

const buildCandidates = (events: BettingEvent[], news: NewsArticle[], analytics: AnalyticsOverview): CandidateBet[] => {
  const grouped = new Map<string, CandidateBet[]>();

  for (const event of events) {
    const relatedHeadline = findRelatedHeadline(event, news)?.title;
    const matchup = `${event.awayTeam} at ${event.homeTeam}`;
    const eventStartsInHours = startsInHours(event.commenceTime);
    const model = getEventModel(analytics, matchup);
    const margin = model?.expectedMargin ?? 0;
    const supportingPlayers = model
      ? [...model.homeTeam.playerProjections, ...model.awayTeam.playerProjections]
          .sort((left, right) => right.confidence - left.confidence)
          .slice(0, 3)
          .map((projection) => `${projection.playerName} ${projection.trendLabel}`)
      : [];
    const totalTarget = model?.totalProjection ?? 0;

    for (const bookmaker of event.bookmakers) {
      for (const market of bookmaker.markets) {
        for (const outcome of market.outcomes) {
          const key = buildOutcomeKey(event.id, market.key, outcome);
          const eventStartsSoon = eventStartsInHours < 36;
          const baseScore = marketPriority[market.key] ?? 1.8;
          const newsBonus = relatedHeadline ? 0.45 : 0;
          const timingBonus = eventStartsSoon ? 0.4 : 0.1;
          const marketModelFit =
            market.key === 'spreads'
              ? Math.abs(margin) / 6
              : market.key === 'totals' && typeof outcome.point === 'number'
                ? Math.abs(totalTarget - outcome.point) / Math.max(8, totalTarget || 1)
                : market.key === 'h2h'
                  ? Math.abs(margin) / 8
                  : 0.14;
          const modelDelta = Number(marketModelFit.toFixed(3));

          const candidate: CandidateBet = {
            id: key,
            matchup,
            market: market.key,
            selection: candidateLabel(outcome),
            sportsbook: bookmaker.title,
            lastUpdate: market.lastUpdate,
            odds: outcome.price,
            point: outcome.point,
            score: baseScore + newsBonus + timingBonus,
            confidence: 58,
            rationale: '',
            relatedHeadline,
            bookmakerCount: 1,
            marketHold: 0,
            lineValue: 0,
            startsInHours: eventStartsInHours,
            marketFreshnessHours: hoursSince(market.lastUpdate),
            modelAgreement: 0,
            edgePercent: 0,
            modelDelta,
            supportingPlayers,
            modelSummary: model
              ? `${model.homeTeam.team} vs ${model.awayTeam.team} projects ${margin > 0 ? `${model.homeTeam.team} +${margin.toFixed(1)}` : `${model.awayTeam.team} +${Math.abs(margin).toFixed(1)}`}.`
              : 'No regression model available for this event.',
            parlayEligible: market.key !== 'spreads' || Math.abs(margin) >= 1.5,
            impliedProbability: 0,
            fairProbability: 0,
            expectedValue: 0,
            kellyFraction: 0,
            simulatedWinRate: 0,
          };

          const existing = grouped.get(key) ?? [];
          existing.push(candidate);
          grouped.set(key, existing);
        }
      }
    }
  }

  const pricedCandidates = events.flatMap((event) => {
    const marketSnapshot = buildMarketSnapshot(event);

    return Array.from(grouped.entries())
      .filter(([key]) => key.startsWith(`${event.id}:`))
      .map(([, candidates]) => {
    const best = candidates.reduce((currentBest, candidate) => (candidate.odds > currentBest.odds ? candidate : currentBest));
    const consensusFairProbability = buildConsensusFairProbability(event, best.market, {
      name: best.selection.replace(/\s[+-]?\d+(\.\d+)?$/, ''),
      price: best.odds,
      point: best.point,
    });
    const bestImplied = americanToImpliedProbability(best.odds);
    const lineValue = Math.max((consensusFairProbability ?? bestImplied) - bestImplied, 0);
    const marketOutcomes = marketSnapshot.get(`${event.id}:${best.market}`) ?? [];
    const marketHold = calculateMarketHold(marketOutcomes);
    const eventOutcome: SportsbookOutcome = {
      name: best.selection.replace(/\s[+-]?\d+(\.\d+)?$/, ''),
      price: best.odds,
      point: best.point,
    };
    const analyticalProbability = buildModelProbability(event, best.market, eventOutcome, analytics);
    const simulatedWinRate = buildSimulatedProbability(event, best.market, eventOutcome, analytics);
    const blendWeights = probabilityBlendWeights(best.market);
    const modelAgreement = Number((1 - Math.abs(analyticalProbability - simulatedWinRate)).toFixed(3));
    const marketFreshnessHours = Number(hoursSince(best.lastUpdate).toFixed(2));
    const freshnessScore = clamp(1 - marketFreshnessHours / 18, 0, 1);
    const fairProbability = Number(
      clamp(
        simulatedWinRate * blendWeights.simulated +
          analyticalProbability * blendWeights.analytical +
          (consensusFairProbability ?? bestImplied) * blendWeights.consensus,
        0.05,
        0.95
      ).toFixed(3)
    );
    const expectedValue = Number(calculateExpectedValue(fairProbability, best.odds).toFixed(3));
    const kellyFraction = Number(calculateKellyFraction(fairProbability, best.odds).toFixed(3));
    const edgePercent = Number(clamp(fairProbability - bestImplied, 0, 0.22).toFixed(3));
    const confidence = Math.min(
      95,
      Math.round(
        50 +
          edgePercent * 170 +
          expectedValue * 120 +
          best.modelDelta * 35 +
          kellyFraction * 120 +
          modelAgreement * 16 +
          freshnessScore * 8
      )
    );
    const score = Number(
      (best.score + expectedValue * 24 + edgePercent * 18 + kellyFraction * 30 + modelAgreement * 3 + freshnessScore * 2 - marketHold * 5).toFixed(2)
    );

    return {
      ...best,
      score,
      confidence,
      bookmakerCount: candidates.length,
      marketHold,
      lineValue,
      marketFreshnessHours,
      modelAgreement,
      edgePercent,
      impliedProbability: bestImplied,
      fairProbability,
      expectedValue,
      kellyFraction,
      simulatedWinRate: Number(simulatedWinRate.toFixed(3)),
      rationale: best.relatedHeadline
        ? `Best available price beats the consensus number across books, the model and simulation agree, and the latest news signal supports it: ${best.relatedHeadline}`
        : 'Best available price beats the consensus number across books, the model and simulation agree, and the market is still fresh enough to trust.',
    };
      });
  });

  const evAverage = pricedCandidates.reduce((sum, candidate) => sum + candidate.expectedValue, 0) / Math.max(pricedCandidates.length, 1);
  const evStdDev = standardDeviation(pricedCandidates.map((candidate) => candidate.expectedValue));

  return pricedCandidates.map((candidate) => ({
    ...candidate,
    score: Number((candidate.score + zScore(candidate.expectedValue, evAverage, evStdDev) * 1.8).toFixed(2)),
  }));
};

const prefilterCandidates = (candidates: CandidateBet[]) => {
  const passed = candidates.filter((candidate) => buildPrefilterReason(candidate) === null);
  const desiredCount = Math.max(env.minRecommendationFloor, env.maxRecommendations);

  if (passed.length >= desiredCount) {
    return passed;
  }

  // If strict filtering leaves too little inventory, backfill with the least-bad candidates.
  const fallback = [...candidates]
    .map((candidate) => ({
      candidate,
      rejection: buildPrefilterReason(candidate),
    }))
    .filter(({ candidate, rejection }) => rejection === null || qualifiesForBackfill(candidate))
    .sort((left, right) => {
      if (left.rejection === null && right.rejection !== null) {
        return -1;
      }

      if (left.rejection !== null && right.rejection === null) {
        return 1;
      }

      return right.candidate.score - left.candidate.score;
    })
    .map((entry) => entry.candidate);

  return fallback.slice(0, Math.max(desiredCount, passed.length));
};

const toRecommendations = (candidates: CandidateBet[]): Recommendation[] =>
  candidates.slice(0, env.maxRecommendations).map((candidate, index) => ({
    id: candidate.id,
    rank: index + 1,
    matchup: candidate.matchup,
    market: candidate.market,
    selection: candidate.selection,
    sportsbook: candidate.sportsbook,
    odds: candidate.odds,
    confidence: candidate.confidence,
    score: candidate.score,
    rationale: `${candidate.rationale} Screened across ${candidate.bookmakerCount} books with ${(candidate.marketHold * 100).toFixed(1)}% market hold.`,
    relatedHeadline: candidate.relatedHeadline,
    edgePercent: candidate.edgePercent,
    riskLabel: candidate.kellyFraction >= 0.03 && candidate.simulatedWinRate >= 0.56 ? 'low' : candidate.expectedValue >= 0.04 ? 'medium' : 'high',
    modelSummary: candidate.modelSummary,
    supportingPlayers: candidate.supportingPlayers,
    parlayEligible: candidate.parlayEligible,
    impliedProbability: candidate.impliedProbability,
    fairProbability: candidate.fairProbability,
    expectedValue: candidate.expectedValue,
    kellyFraction: candidate.kellyFraction,
    simulatedWinRate: candidate.simulatedWinRate,
  }));

const buildEmergencyRecommendations = (events: BettingEvent[]): Recommendation[] => {
  const rawOutcomes = events.flatMap((event) =>
    event.bookmakers.flatMap((bookmaker) =>
      bookmaker.markets.flatMap((market) =>
        market.outcomes.map((outcome, index) => ({
          id: `${event.id}:${bookmaker.key}:${market.key}:${outcome.name}:${outcome.point ?? index}`,
          matchup: `${event.awayTeam} at ${event.homeTeam}`,
          market: market.key,
          selection: candidateLabel(outcome),
          sportsbook: bookmaker.title,
          odds: outcome.price,
          rankSeed: americanToImpliedProbability(outcome.price),
        }))
      )
    )
  );

  return rawOutcomes
    .sort((left, right) => right.rankSeed - left.rankSeed)
    .slice(0, Math.max(3, Math.min(env.maxRecommendations, rawOutcomes.length)))
    .map((candidate, index) => ({
      id: candidate.id,
      rank: index + 1,
      matchup: candidate.matchup,
      market: candidate.market,
      selection: candidate.selection,
      sportsbook: candidate.sportsbook,
      odds: candidate.odds,
      confidence: 52,
      score: Number((5.2 - index * 0.08).toFixed(2)),
      rationale: 'Fallback board pick generated from the best currently posted price while richer quant inputs finish or remain incomplete.',
      impliedProbability: candidate.rankSeed,
      fairProbability: candidate.rankSeed,
      expectedValue: 0,
      kellyFraction: 0,
      simulatedWinRate: candidate.rankSeed,
    }));
};

const parseJson = (content: string): LlmResponse | null => {
  const normalized = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized) as LlmResponse;
  } catch {
    const start = normalized.indexOf('{');
    const end = normalized.lastIndexOf('}');

    if (start < 0 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(normalized.slice(start, end + 1)) as LlmResponse;
    } catch {
      return null;
    }
  }
};

const buildLlmPayload = ({ events, news, analytics, candidates }: LlmRequestContext) => ({
  events,
  news,
  analytics,
  candidates: candidates.slice(0, 20),
});

const normalizeLlmRecommendations = (payload: LlmResponse): Recommendation[] =>
  (payload.recommendations ?? [])
    .slice(0, env.maxRecommendations)
    .map((item, index) => ({
      id: `${item.matchup ?? 'bet'}-${item.market ?? 'market'}-${index}`,
      rank: item.rank ?? index + 1,
      matchup: item.matchup ?? 'Unknown matchup',
      market: item.market ?? 'h2h',
      selection: item.selection ?? 'Unavailable selection',
      sportsbook: item.sportsbook ?? 'Best available',
      odds: item.odds ?? -110,
      confidence: item.confidence ?? 65,
      score: item.score ?? 6.5,
      rationale: item.rationale ?? 'LLM recommendation returned without explanation.',
      relatedHeadline: item.relatedHeadline,
    }))
    .sort((left, right) => left.rank - right.rank);

const callProxy = async ({ events, news, analytics, candidates }: LlmRequestContext) => {
  const response = await fetch(env.llmProxyUrl ?? '', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemPrompt: recommendationSystemPrompt,
      ...buildLlmPayload({ events, news, analytics, candidates }),
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM proxy returned ${response.status}`);
  }

  return (await response.json()) as LlmResponse;
};

const callOpenAi = async ({ events, news, analytics, candidates }: LlmRequestContext) => {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: env.openAiModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: recommendationSystemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmPayload({ events, news, analytics, candidates })),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned no content');
  }

  const parsed = parseJson(content);

  if (!parsed) {
    throw new Error('OpenAI returned invalid JSON');
  }

  return parsed;
};

const callOpenRouter = async ({ events, news, analytics, candidates }: LlmRequestContext) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${env.openRouterApiKey}`,
  };

  if (env.openRouterSiteUrl) {
    headers['HTTP-Referer'] = env.openRouterSiteUrl;
  }

  if (env.openRouterAppName) {
    headers['X-Title'] = env.openRouterAppName;
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: env.openRouterModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: recommendationSystemPrompt,
        },
        {
          role: 'user',
          content: JSON.stringify(buildLlmPayload({ events, news, analytics, candidates })),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenRouter returned no content');
  }

  const parsed = parseJson(content);

  if (!parsed) {
    throw new Error('OpenRouter returned invalid JSON');
  }

  return parsed;
};

const callLocalWebLlm = async ({ events, news, analytics, candidates }: LlmRequestContext) => {
  const content = await callWebLlm(recommendationSystemPrompt, buildLlmPayload({ events, news, analytics, candidates }));
  const parsed = parseJson(content);

  if (!parsed) {
    throw new Error('WebLLM returned invalid JSON');
  }

  return parsed;
};

const llmProviderLabels: Record<LlmProviderKey, string> = {
  proxy: 'Live tool-calling LLM proxy',
  webllm: 'Local WebLLM with tools',
  openrouter: 'Live OpenRouter',
  openai: 'Live OpenAI',
};

const isConfiguredLlmProvider = (provider: LlmProviderKey) => {
  switch (provider) {
    case 'proxy':
      return Boolean(env.llmProxyUrl);
    case 'webllm':
      return isWebLlmSupported();
    case 'openrouter':
      return Boolean(env.openRouterApiKey);
    case 'openai':
      return Boolean(env.openAiApiKey);
  }
};

const callConfiguredLlmProvider = async (provider: LlmProviderKey, context: LlmRequestContext) => {
  switch (provider) {
    case 'proxy':
      return callProxy(context);
    case 'webllm':
      return callLocalWebLlm(context);
    case 'openrouter':
      return callOpenRouter(context);
    case 'openai':
      return callOpenAi(context);
  }
};

export async function generateRecommendations(
  events: BettingEvent[],
  news: NewsArticle[],
  analytics: AnalyticsOverview
): Promise<ProviderResult<Recommendation[]>> {
  const allCandidates = buildCandidates(events, news, analytics).sort((left, right) => right.score - left.score);
  const heuristicCandidates = prefilterCandidates(allCandidates).sort((left, right) => right.score - left.score);
  const heuristicRecommendations = toRecommendations(heuristicCandidates);
  const emergencyRecommendations = heuristicRecommendations.length > 0 ? heuristicRecommendations : toRecommendations(allCandidates);
  const guaranteedRecommendations = emergencyRecommendations.length > 0 ? emergencyRecommendations : buildEmergencyRecommendations(events);
  const llmCandidates = heuristicCandidates.slice(0, Math.max(env.maxRecommendations * 2, 30));

  const context: LlmRequestContext = {
    events,
    news,
    analytics,
    candidates: llmCandidates,
  };
  const attemptedProviders: string[] = [];
  const orderedProviders = env.llmProviderOrder.filter(
    (provider): provider is LlmProviderKey => ['proxy', 'webllm', 'openrouter', 'openai'].includes(provider)
  );

  for (const provider of orderedProviders) {
    if (!isConfiguredLlmProvider(provider)) {
      continue;
    }

    try {
      const payload = await callConfiguredLlmProvider(provider, context);
      const recommendations = normalizeLlmRecommendations(payload);

      if (recommendations.length > 0) {
        return {
          data: recommendations,
          provider: `${llmProviderLabels[provider]} on top of quant engine (${llmCandidates.length} screened bets sent)`,
        };
      }

      attemptedProviders.push(llmProviderLabels[provider]);
    } catch {
      attemptedProviders.push(llmProviderLabels[provider]);
    }
  }

  const failureSuffix = attemptedProviders.length > 0 ? `, ${attemptedProviders.join(', ')} unavailable` : '';

  return {
    data: guaranteedRecommendations,
    provider: `Deterministic quant engine (${llmCandidates.length} screened bets${failureSuffix})`,
  };
}