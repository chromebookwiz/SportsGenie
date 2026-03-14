import type { DashboardData } from '../types/sports';
import { buildAnalyticsOverview } from './analytics';
import { runBacktest } from './backtest';
import { fetchNews } from './newsApi';
import { fetchOdds } from './oddsApi';
import { buildParlayRecommendations } from './parlays';
import { fetchPlayerProfiles } from './playerStats';
import { generateRecommendations } from './recommendations';

export async function loadDashboardData(): Promise<DashboardData> {
  const [oddsResult, newsResult] = await Promise.all([fetchOdds(), fetchNews()]);
  const [playerStatsResult, backtestResult] = await Promise.all([
    fetchPlayerProfiles(oddsResult.data),
    runBacktest(),
  ]);
  const analyticsResult = await buildAnalyticsOverview(oddsResult.data, playerStatsResult.data);
  const recommendationResult = await generateRecommendations(oddsResult.data, newsResult.data, analyticsResult.data);
  const parlayRecommendations = buildParlayRecommendations(recommendationResult.data);

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