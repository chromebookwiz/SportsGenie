import { historicalBacktestSamples } from '../data/historicalBacktest';
import type { BacktestSummary, ProviderResult } from '../types/sports';

export async function runBacktest(): Promise<ProviderResult<BacktestSummary>> {
  const sampleSize = historicalBacktestSamples.length;
  const wins = historicalBacktestSamples.filter((sample) => sample.actualWin).length;
  const profitUnits = historicalBacktestSamples.reduce((sum, sample) => sum + sample.profitUnits, 0);
  const roi = profitUnits / Math.max(sampleSize, 1);
  const averageEdge =
    historicalBacktestSamples.reduce((sum, sample) => sum + (sample.fairProbability - sample.impliedProbability), 0) /
    Math.max(sampleSize, 1);
  const averageKelly = historicalBacktestSamples.reduce((sum, sample) => sum + sample.kellyFraction, 0) / Math.max(sampleSize, 1);
  const brierScore =
    historicalBacktestSamples.reduce(
      (sum, sample) => sum + (sample.fairProbability - (sample.actualWin ? 1 : 0)) ** 2,
      0
    ) / Math.max(sampleSize, 1);

  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;

  for (const sample of historicalBacktestSamples) {
    cumulative += sample.profitUnits;
    peak = Math.max(peak, cumulative);
    maxDrawdown = Math.max(maxDrawdown, peak - cumulative);
  }

  return {
    data: {
      sampleSize,
      winRate: wins / Math.max(sampleSize, 1),
      roi,
      profitUnits,
      averageEdge,
      averageKelly,
      maxDrawdown,
      brierScore,
      calibrationGrade: brierScore <= 0.18 ? 'A-' : brierScore <= 0.22 ? 'B' : 'C',
      recentSamples: [...historicalBacktestSamples].reverse().slice(0, 6),
    },
    provider: 'Historical calibration set',
  };
}