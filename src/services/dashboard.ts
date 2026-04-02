import type { DashboardData } from '../types/sports';
import { buildAnalyticsOverview } from './analytics';
import { runBacktest } from './backtest';
import { fetchNews } from './newsApi';
import { fetchOdds } from './oddsApi';
import { buildParlayRecommendations } from './parlays';
import { fetchPlayerProfiles } from './playerStats';
import { generateRecommendations } from './recommendations';

export type DashboardLoadProgress = {
  progress: number;
  text: string;
};

export async function loadDashboardData(
  { forceRefresh = false, onProgress }: { forceRefresh?: boolean; onProgress?: (progress: DashboardLoadProgress) => void } = {}
): Promise<DashboardData> {
  onProgress?.({
    progress: 0.08,
    text: 'Loading sportsbook feeds and news sources...',
  });
  const [oddsResult, newsResult] = await Promise.all([fetchOdds({ forceRefresh }), fetchNews({ forceRefresh })]);

  onProgress?.({
    progress: 0.38,
    text: 'Loading player data and historical calibration...',
  });

  const [playerStatsResult, backtestResult] = await Promise.all([
    fetchPlayerProfiles(oddsResult.data, { forceRefresh }),
    runBacktest(),
  ]);

  onProgress?.({
    progress: 0.66,
    text: 'Running quant models and market analytics...',
  });

  const analyticsResult = await buildAnalyticsOverview(oddsResult.data, playerStatsResult.data);

  onProgress?.({
    progress: 0.86,
    text: 'Ranking predictions and assembling the board...',
  });

  const recommendationResult = await generateRecommendations(oddsResult.data, newsResult.data, analyticsResult.data);
  const parlayRecommendations = buildParlayRecommendations(recommendationResult.data);

  onProgress?.({
    progress: 1,
    text: 'Board ready',
  });

  return {
    bets: oddsResult.data,
    news: newsResult.data,
    recommendations: recommendationResult.data,
    analytics: analyticsResult.data,
    parlays: parlayRecommendations,
    backtest: backtestResult.data,
    providers: {
      odds: oddsResult.provider,
      news: newsResult.provider,
      recommendations: recommendationResult.provider,
      analytics: `${analyticsResult.provider} + ${playerStatsResult.provider}`,
      backtest: backtestResult.provider,
    },
  };
}