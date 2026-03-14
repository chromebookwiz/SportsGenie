import type { ParlayRecommendation, Recommendation } from '../types/sports';
import { americanToDecimalOdds, clamp, expectedValue, kellyFraction } from './quant';

const toAmericanOdds = (decimalOdds: number) => {
  if (decimalOdds >= 2) {
    return Math.round((decimalOdds - 1) * 100);
  }

  return Math.round(-100 / (decimalOdds - 1));
};

const distinctGameKey = (recommendation: Recommendation) => `${recommendation.matchup}:${recommendation.market}`;

const combinationOf = <T>(items: T[], size: number): T[][] => {
  if (size === 0) {
    return [[]];
  }

  if (items.length < size) {
    return [];
  }

  const result: T[][] = [];

  items.forEach((item, index) => {
    const tails = combinationOf(items.slice(index + 1), size - 1);
    tails.forEach((tail) => {
      result.push([item, ...tail]);
    });
  });

  return result;
};

const pairCorrelation = (left: Recommendation, right: Recommendation) => {
  if (left.matchup === right.matchup) {
    return 0.3;
  }

  if (left.market === right.market) {
    return 0.08;
  }

  return 0.03;
};

const totalCorrelation = (picks: Recommendation[]) => {
  let total = 0;

  for (let index = 0; index < picks.length; index += 1) {
    for (let next = index + 1; next < picks.length; next += 1) {
      total += pairCorrelation(picks[index], picks[next]);
    }
  }

  return total;
};

const buildParlay = (title: string, picks: Recommendation[]): ParlayRecommendation => {
  const combinedDecimal = picks.reduce((product, pick) => product * americanToDecimalOdds(pick.odds), 1);
  const naiveJointProbability = picks.reduce((product, pick) => product * (pick.fairProbability ?? 0.5), 1);
  const correlationPenalty = totalCorrelation(picks);
  const adjustedProbability = clamp(naiveJointProbability * (1 - correlationPenalty), 0.01, 0.85);
  const averageConfidence = picks.reduce((sum, pick) => sum + pick.confidence, 0) / picks.length;
  const averageEdge = picks.reduce((sum, pick) => sum + (pick.edgePercent ?? 0), 0) / picks.length;
  const combinedAmerican = toAmericanOdds(combinedDecimal);
  const parlayExpectedValue = Number(expectedValue(adjustedProbability, combinedAmerican).toFixed(3));
  const parlayKellyFraction = Number(kellyFraction(adjustedProbability, combinedAmerican).toFixed(3));
  const simulatedHitRate = Number(adjustedProbability.toFixed(3));

  return {
    id: `${title.toLowerCase().replace(/\s+/g, '-')}-${picks.length}`,
    title,
    combinedOdds: combinedAmerican,
    confidence: Math.round(clamp(averageConfidence - correlationPenalty * 40 + averageEdge * 35 + parlayKellyFraction * 120, 40, 92)),
    correlationRisk: correlationPenalty >= 0.18 ? 'medium' : 'low',
    rationale: `Built from ${picks.length} legs with ${(averageEdge * 100).toFixed(1)}% average edge, ${(correlationPenalty * 100).toFixed(1)}% correlation drag, and ${(adjustedProbability * 100).toFixed(1)}% modeled hit rate.`,
    expectedValue: parlayExpectedValue,
    kellyFraction: parlayKellyFraction,
    simulatedHitRate,
    legs: picks.map((pick) => ({
      recommendationId: pick.id,
      matchup: pick.matchup,
      selection: pick.selection,
      market: pick.market,
      odds: pick.odds,
      sportsbook: pick.sportsbook,
      edgePercent: pick.edgePercent ?? 0,
    })),
  };
};

export function buildParlayRecommendations(recommendations: Recommendation[]): ParlayRecommendation[] {
  const eligible = recommendations
    .filter((recommendation) => recommendation.parlayEligible !== false)
    .sort((left, right) => (right.expectedValue ?? 0) - (left.expectedValue ?? 0) || (right.edgePercent ?? 0) - (left.edgePercent ?? 0));
  const uniqueByGame: Recommendation[] = [];
  const seenGames = new Set<string>();

  for (const recommendation of eligible) {
    const key = distinctGameKey(recommendation);

    if (!seenGames.has(key)) {
      uniqueByGame.push(recommendation);
      seenGames.add(key);
    }
  }

  const pairCandidates = combinationOf(uniqueByGame.slice(0, 6), 2).map((legs) => buildParlay('Low-correlation double', legs));
  const tripleCandidates = combinationOf(uniqueByGame.slice(0, 6), 3).map((legs) => buildParlay('Signal stack triple', legs));
  const totalsCandidates = combinationOf(eligible.filter((pick) => pick.market === 'totals').slice(0, 4), 2).map((legs) => buildParlay('Totals blend', legs));

  return [...pairCandidates, ...tripleCandidates, ...totalsCandidates]
    .sort((left, right) => right.expectedValue - left.expectedValue || right.kellyFraction - left.kellyFraction)
    .slice(0, 3);
}