import type {
  AnalyticsOverview,
  BettingEvent,
  EventModel,
  PlayerPerformanceProfile,
  PlayerProjection,
  ProviderResult,
  TeamModel,
} from '../types/sports';
import { clamp, mean, monteCarloWinRate, normalCdf, standardDeviation } from './quant';

const linearRegression = (values: number[]) => {
  const points = values.map((value, index) => ({ x: index + 1, y: value }));
  const xMean = mean(points.map((point) => point.x));
  const yMean = mean(points.map((point) => point.y));

  let numerator = 0;
  let denominator = 0;

  for (const point of points) {
    numerator += (point.x - xMean) * (point.y - yMean);
    denominator += (point.x - xMean) ** 2;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const nextX = values.length + 1;

  return {
    slope,
    projected: intercept + slope * nextX,
    baseline: yMean,
  };
};

const trendLabelFor = (slope: number): 'rising' | 'flat' | 'falling' => {
  if (slope > 0.35) {
    return 'rising';
  }

  if (slope < -0.35) {
    return 'falling';
  }

  return 'flat';
};

const buildProjection = (profile: PlayerPerformanceProfile): PlayerProjection => {
  const primaryValues = profile.recentGames.map((game) => game.primaryStat);
  const usageValues = profile.recentGames.map((game) => game.usageRate);
  const minuteValues = profile.recentGames.map((game) => game.minutes);
  const primaryRegression = linearRegression(primaryValues);
  const usageRegression = linearRegression(usageValues);
  const minuteRegression = linearRegression(minuteValues);
  const confidence = clamp(
    60 + Math.abs(primaryRegression.slope) * 8 + Math.max(0, usageRegression.projected - usageRegression.baseline),
    58,
    90
  );
  const projectedValue = Number(
    (
      primaryRegression.projected * 0.72 +
      primaryRegression.baseline * 0.18 +
      (usageRegression.projected - usageRegression.baseline) * 0.08 +
      (minuteRegression.projected - minuteRegression.baseline) * 0.02
    ).toFixed(2)
  );

  return {
    playerId: profile.id,
    playerName: profile.name,
    team: profile.team,
    metric: profile.primaryStatLabel,
    projectedValue,
    baselineAverage: Number(primaryRegression.baseline.toFixed(2)),
    trendSlope: Number(primaryRegression.slope.toFixed(2)),
    trendLabel: trendLabelFor(primaryRegression.slope),
    confidence: Math.round(confidence),
  };
};

const buildTeamModel = (team: string, sportKey: string, profiles: PlayerPerformanceProfile[]): TeamModel => {
  const playerProjections = profiles.map(buildProjection).sort((left, right) => right.projectedValue - left.projectedValue);
  const topThree = playerProjections.slice(0, 3);
  const topProfiles = profiles.slice(0, 3);
  const formScore = Number(
    (
      mean(topThree.map((projection) => projection.projectedValue)) +
      mean(topThree.map((projection) => projection.confidence)) / 12
    ).toFixed(2)
  );
  const playerStdDevs = topProfiles.map((profile) => standardDeviation(profile.recentGames.map((game) => game.primaryStat)));
  const injuryRisk = Number(
    clamp(
      1 - mean(profiles.map((profile) => mean(profile.recentGames.map((game) => game.minutes)) / 90)),
      0.04,
      0.28
    ).toFixed(2)
  );
  const stabilityScore = Number(clamp(1 - mean(playerStdDevs) / 10 - injuryRisk, 0.18, 0.92).toFixed(2));

  return {
    team,
    sportKey,
    formScore,
    projectedAdvantage: 0,
    injuryRisk,
    stabilityScore,
    playerProjections,
  };
};

const buildAngles = (margin: number, totalProjection: number, homeTeam: TeamModel) => {
  const angles: string[] = [];

  if (Math.abs(margin) >= 2.5) {
    angles.push(margin > 0 ? `${homeTeam.team} spread support` : 'Away spread support');
  }

  if (totalProjection >= 6.2 && homeTeam.sportKey === 'icehockey_nhl') {
    angles.push('NHL over environment');
  }

  if (totalProjection >= 3.1 && homeTeam.sportKey === 'soccer_epl') {
    angles.push('Open match total');
  }

  if (totalProjection >= 224 && homeTeam.sportKey === 'basketball_nba') {
    angles.push('Fast pace total');
  }

  if (angles.length === 0) {
    angles.push('Moneyline stability');
  }

  return angles;
};

const buildEventModel = (event: BettingEvent, profiles: PlayerPerformanceProfile[]): EventModel => {
  const eventProfiles = profiles.filter(
    (profile) => profile.team === event.homeTeam || profile.team === event.awayTeam
  );
  const homeProfiles = eventProfiles.filter((profile) => profile.team === event.homeTeam);
  const awayProfiles = eventProfiles.filter((profile) => profile.team === event.awayTeam);
  const homeTeam = buildTeamModel(event.homeTeam, event.sportKey, homeProfiles);
  const awayTeam = buildTeamModel(event.awayTeam, event.sportKey, awayProfiles);
  const homeEdge = 1.2;
  const expectedMargin = Number((homeTeam.formScore - awayTeam.formScore + homeEdge).toFixed(2));
  const totalProjection = Number((homeTeam.formScore + awayTeam.formScore).toFixed(2));
  const marginStdDev = Number(
    clamp((2 - homeTeam.stabilityScore - awayTeam.stabilityScore) * 5.2 + Math.abs(expectedMargin) * 0.18, 2.5, 14).toFixed(2)
  );
  const totalStdDev = Number(clamp(marginStdDev * 1.45, 3, 18).toFixed(2));
  const drawProbability =
    event.sportKey === 'soccer_epl'
      ? Number(clamp(0.28 - Math.abs(expectedMargin) * 0.035 + Math.max(0, 3 - totalProjection) * 0.02, 0.14, 0.32).toFixed(3))
      : 0;
  const homeWinProbabilityBase = 1 - normalCdf(0, expectedMargin, marginStdDev);
  const homeWinProbability = Number(
    clamp(homeWinProbabilityBase * (1 - drawProbability), 0.08, 0.88).toFixed(3)
  );
  const awayWinProbability = Number(clamp(1 - homeWinProbability - drawProbability, 0.08, 0.88).toFixed(3));
  const simulatedHomeWinRate = monteCarloWinRate({
    seed: `${event.id}:h2h`,
    iterations: 400,
    meanValue: expectedMargin,
    stdDev: marginStdDev,
    comparator: (sample) => sample > 0,
  });
  const volatility = Number(
    clamp((homeTeam.injuryRisk + awayTeam.injuryRisk) * 1.8 + Math.abs(simulatedHomeWinRate - 0.5), 0.12, 0.82).toFixed(2)
  );

  homeTeam.projectedAdvantage = Number((expectedMargin / 2 + homeEdge).toFixed(2));
  awayTeam.projectedAdvantage = Number((expectedMargin * -0.5).toFixed(2));

  return {
    eventId: event.id,
    matchup: `${event.awayTeam} at ${event.homeTeam}`,
    homeTeam,
    awayTeam,
    expectedMargin,
    marginStdDev,
    totalProjection,
    totalStdDev,
    homeWinProbability,
    awayWinProbability,
    drawProbability,
    volatility,
    bestAngles: buildAngles(expectedMargin, totalProjection, homeTeam),
  };
};

export async function buildAnalyticsOverview(
  events: BettingEvent[],
  profiles: PlayerPerformanceProfile[]
): Promise<ProviderResult<AnalyticsOverview>> {
  const eventModels = events.map((event) => buildEventModel(event, profiles));
  const featuredPlayers = eventModels
    .flatMap((model) => [...model.homeTeam.playerProjections, ...model.awayTeam.playerProjections])
    .sort((left, right) => right.confidence - left.confidence || right.projectedValue - left.projectedValue)
    .slice(0, 6);
  const averageConfidence = Math.round(mean(featuredPlayers.map((projection) => projection.confidence)) || 0);
  const averageVolatility = Number(mean(eventModels.map((model) => model.volatility)).toFixed(2));
  const averageStability = Number(
    mean(eventModels.map((model) => (model.homeTeam.stabilityScore + model.awayTeam.stabilityScore) / 2)).toFixed(2)
  );
  const bestEnvironment = eventModels.sort((left, right) => Math.abs(right.expectedMargin) - Math.abs(left.expectedMargin))[0]?.matchup ?? 'No active model';

  return {
    data: {
      generatedAt: new Date().toISOString(),
      eventModels,
      featuredPlayers,
      marketPulse: {
        averageConfidence,
        averageVolatility,
        bestEnvironment,
        averageStability,
      },
    },
    provider: 'Regression model + player history',
  };
}