import { StatusBar } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { AdvisorWindow } from './src/components/AdvisorWindow';
import { loadDashboardData, type DashboardLoadProgress } from './src/services/dashboard';
import type { BettingEvent, DashboardData, NewsArticle, ParlayRecommendation, Recommendation } from './src/types/sports';
import {
  formatCommenceTime,
  formatMarketLabel,
  formatOdds,
  formatPercent,
  formatRelativeTime,
  formatTrendLabel,
} from './src/utils/format';

type LoadingState = 'idle' | 'loading' | 'refreshing';
type SectionMode = 'all' | 'picks' | 'news' | 'lines' | 'model';

type BoardLoadState = {
  progress: number;
  text: string;
};

const sectionModes: Array<{ key: SectionMode; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'picks', label: 'Predictions' },
  { key: 'model', label: 'Quant Lab' },
  { key: 'news', label: 'Newswire' },
  { key: 'lines', label: 'Lines' },
];

const impact = async () => {
  if (Platform.OS !== 'web') {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
};

const success = async () => {
  if (Platform.OS !== 'web') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
};

const warning = async () => {
  if (Platform.OS !== 'web') {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
};

const formatDashboardTimestamp = (value: string) =>
  new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });

const buildMoodLabel = (data: DashboardData | null) => {
  if (!data || data.recommendations.length === 0) {
    return 'Building the board';
  }

  const avgConfidence =
    data.recommendations.reduce((sum, recommendation) => sum + recommendation.confidence, 0) /
    data.recommendations.length;
  const liveCount = Object.values(data.providers).filter((provider) => provider.toLowerCase().includes('live')).length;

  if (avgConfidence >= 75 && liveCount >= 2) {
    return 'Sharp signal night';
  }

  if (avgConfidence >= 68) {
    return 'Measured edge board';
  }

  return 'Volatile slate energy';
};

const buildMoodCaption = (data: DashboardData | null) => {
  if (!data || data.recommendations.length === 0) {
    return 'Waiting for enough market texture to shape the board.';
  }

  const topRecommendation = data.recommendations[0];

  return `${topRecommendation.selection} leads the board while ${formatMarketLabel(topRecommendation.market).toLowerCase()} markets show the cleanest price separation and the quant model agrees.`;
};

const defaultBoardLoadState: BoardLoadState = {
  progress: 0,
  text: 'Preparing board sync...',
};

const getSignedMetricTone = ({
  value,
  threshold = 0,
  treatAsPercent = false,
}: {
  value: number;
  threshold?: number;
  treatAsPercent?: boolean;
}) => {
  if (!Number.isFinite(value)) {
    return null;
  }

  if (treatAsPercent) {
    if (value > threshold) {
      return styles.metricPositive;
    }

    if (value < threshold) {
      return styles.metricNegative;
    }

    return null;
  }

  if (value > 0) {
    return styles.metricPositive;
  }

  if (value < 0) {
    return styles.metricNegative;
  }

  return null;
};

const formatUnitSigned = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}u`;

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.filterChip, active ? styles.filterChipActive : styles.filterChipIdle]}>
      <Text style={[styles.filterChipText, active ? styles.filterChipTextActive : styles.filterChipTextIdle]}>{label}</Text>
    </Pressable>
  );
}

function InfoPanel({ moodLabel, moodCaption }: { moodLabel: string; moodCaption: string }) {
  return (
    <View style={styles.infoPanel}>
      <View style={styles.infoPanelHeader}>
        <Text style={styles.infoPanelEyebrow}>Board intel</Text>
        <Text style={styles.infoPanelTitle}>How this board works</Text>
      </View>
      <Text style={styles.infoPanelBody}>
        Live odds, news, player trends, and model outputs are blended into one ranked board so the strongest prices surface first.
      </Text>
      <View style={styles.infoPanelGrid}>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>Mood</Text>
          <Text style={styles.infoPillValue}>{moodLabel}</Text>
        </View>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>What to watch</Text>
          <Text style={styles.infoPillValue}>{moodCaption}</Text>
        </View>
        <View style={styles.infoPill}>
          <Text style={styles.infoPillLabel}>Inputs</Text>
          <Text style={styles.infoPillValue}>Live lines, news flow, quant projections, and recommendation scoring.</Text>
        </View>
      </View>
    </View>
  );
}

function RecommendationCard({ recommendation, compact }: { recommendation: Recommendation; compact: boolean }) {
  const barWidth = `${Math.max(10, Math.min(100, recommendation.confidence))}%` as const;
  const confidenceTone = getSignedMetricTone({ value: recommendation.confidence, threshold: 50, treatAsPercent: true });
  const edgeTone = typeof recommendation.edgePercent === 'number' ? getSignedMetricTone({ value: recommendation.edgePercent }) : null;
  const fairTone = typeof recommendation.fairProbability === 'number' ? getSignedMetricTone({ value: recommendation.fairProbability, threshold: 0.5, treatAsPercent: true }) : null;
  const impliedTone = typeof recommendation.impliedProbability === 'number' ? getSignedMetricTone({ value: recommendation.impliedProbability, threshold: 0.5, treatAsPercent: true }) : null;
  const expectedValueTone = typeof recommendation.expectedValue === 'number' ? getSignedMetricTone({ value: recommendation.expectedValue }) : null;
  const kellyTone = typeof recommendation.kellyFraction === 'number' ? getSignedMetricTone({ value: recommendation.kellyFraction }) : null;
  const simulationTone = typeof recommendation.simulatedWinRate === 'number' ? getSignedMetricTone({ value: recommendation.simulatedWinRate, threshold: 0.5, treatAsPercent: true }) : null;

  return (
    <View style={styles.recommendationCard}>
      <View style={styles.recommendationHeaderRow}>
        <View style={styles.rankToken}>
          <Text style={styles.rankBadge}>#{recommendation.rank}</Text>
        </View>
        <Text style={[styles.confidenceText, confidenceTone]}>{recommendation.confidence}% confidence</Text>
      </View>
      <Text style={styles.recommendationMatchup}>{recommendation.matchup}</Text>
      <Text style={styles.recommendationPick}>{recommendation.selection}</Text>
      <Text style={styles.recommendationMeta}>
        {formatMarketLabel(recommendation.market)} via {recommendation.sportsbook} at {formatOdds(recommendation.odds)}
      </Text>
      <View style={styles.recommendationBadgeRow}>
        {typeof recommendation.edgePercent === 'number' ? <Text style={[styles.edgeBadge, edgeTone]}>Edge {formatPercent(recommendation.edgePercent)}</Text> : null}
        {recommendation.riskLabel ? <Text style={styles.riskBadge}>{recommendation.riskLabel} risk</Text> : null}
        {recommendation.parlayEligible ? <Text style={styles.parlayBadge}>Parlay-ready</Text> : null}
      </View>
      <View style={styles.confidenceTrack}>
        <View style={[styles.confidenceFill, { width: barWidth }]} />
      </View>
      <Text style={styles.recommendationReason}>{recommendation.rationale}</Text>
      {recommendation.modelSummary ? <Text style={styles.modelSummary}>{recommendation.modelSummary}</Text> : null}
      <Text style={styles.quantMetaLine}>
        <Text>Fair </Text>
        <Text style={fairTone}>{typeof recommendation.fairProbability === 'number' ? formatPercent(recommendation.fairProbability) : 'n/a'}</Text>
        <Text> • Implied </Text>
        <Text style={impliedTone}>{typeof recommendation.impliedProbability === 'number' ? formatPercent(recommendation.impliedProbability) : 'n/a'}</Text>
        <Text> • EV </Text>
        <Text style={expectedValueTone}>{typeof recommendation.expectedValue === 'number' ? formatPercent(recommendation.expectedValue) : 'n/a'}</Text>
      </Text>
      <Text style={styles.quantMetaLine}>
        <Text>Kelly </Text>
        <Text style={kellyTone}>{typeof recommendation.kellyFraction === 'number' ? formatPercent(recommendation.kellyFraction) : 'n/a'}</Text>
        <Text> • Sim </Text>
        <Text style={simulationTone}>{typeof recommendation.simulatedWinRate === 'number' ? formatPercent(recommendation.simulatedWinRate) : 'n/a'}</Text>
      </Text>
      {recommendation.supportingPlayers?.length ? (
        <Text numberOfLines={compact ? 2 : 3} style={styles.supportingPlayers}>
          Drivers: {recommendation.supportingPlayers.join(' • ')}
        </Text>
      ) : null}
      {recommendation.relatedHeadline ? (
        <Text numberOfLines={compact ? 2 : 3} style={styles.recommendationHeadline}>
          News watch: {recommendation.relatedHeadline}
        </Text>
      ) : null}
    </View>
  );
}

function EventCard({ event, compact }: { event: BettingEvent; compact: boolean }) {
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventHeaderRow}>
        <Text style={styles.eventLeague}>{event.sportTitle}</Text>
        <Text style={styles.eventTime}>{formatCommenceTime(event.commenceTime)}</Text>
      </View>
      <Text style={styles.eventMatchup}>{event.awayTeam} at {event.homeTeam}</Text>
      {event.bookmakers.map((bookmaker) => (
        <View key={`${event.id}-${bookmaker.key}`} style={styles.bookmakerBlock}>
          <Text style={styles.bookmakerName}>{bookmaker.title}</Text>
          {bookmaker.markets.map((market) => (
            <View key={`${bookmaker.key}-${market.key}`} style={styles.marketBlock}>
              <Text style={styles.marketLabel}>{formatMarketLabel(market.key)}</Text>
              {market.outcomes.map((outcome) => (
                <View
                  key={`${bookmaker.key}-${market.key}-${outcome.name}-${outcome.point ?? 'na'}`}
                  style={[styles.outcomeRow, compact ? styles.outcomeRowCompact : null]}
                >
                  <Text style={styles.outcomeName}>
                    {outcome.name}
                    {typeof outcome.point === 'number' ? ` ${outcome.point > 0 ? '+' : ''}${outcome.point}` : ''}
                  </Text>
                  <Text style={styles.outcomePrice}>{formatOdds(outcome.price)}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function NewsCard({ article }: { article: NewsArticle }) {
  const handleOpen = async () => {
    await impact();
    await Linking.openURL(article.url);
  };

  return (
    <Pressable onPress={() => void handleOpen()} style={styles.newsCard}>
      <View style={styles.newsSourceRow}>
        <Text style={styles.newsSource}>{article.source}</Text>
        <Text style={styles.newsTime}>{formatRelativeTime(article.publishedAt)}</Text>
      </View>
      <Text style={styles.newsTitle}>{article.title}</Text>
      {article.description ? <Text style={styles.newsDescription}>{article.description}</Text> : null}
      <Text style={styles.newsUrl}>Open story</Text>
    </Pressable>
  );
}

function ProviderPill({ label, value }: { label: string; value: string }) {
  const live = value.toLowerCase().includes('live') || value.toLowerCase().includes('regression');

  return (
    <View style={[styles.providerPill, live ? styles.providerPillLive : styles.providerPillFallback]}>
      <Text style={styles.providerLabel}>{label}</Text>
      <Text style={styles.providerValue}>{value}</Text>
    </View>
  );
}

function ParlayCard({ parlay }: { parlay: ParlayRecommendation }) {
  const parlayConfidenceTone = getSignedMetricTone({ value: parlay.confidence, threshold: 50, treatAsPercent: true });
  const parlayOddsTone = getSignedMetricTone({ value: parlay.combinedOdds });
  const parlayExpectedValueTone = getSignedMetricTone({ value: parlay.expectedValue });
  const parlayKellyTone = getSignedMetricTone({ value: parlay.kellyFraction });
  const parlaySimulationTone = getSignedMetricTone({ value: parlay.simulatedHitRate, threshold: 0.5, treatAsPercent: true });

  return (
    <View style={styles.parlayCard}>
      <View style={styles.parlayHeaderRow}>
        <Text style={styles.parlayTitle}>{parlay.title}</Text>
        <Text style={[styles.parlayOdds, parlayOddsTone]}>{formatOdds(parlay.combinedOdds)}</Text>
      </View>
      <Text style={styles.parlayMeta}>
        <Text style={parlayConfidenceTone}>{parlay.confidence}% confidence</Text>
        <Text> • {parlay.correlationRisk} correlation risk</Text>
      </Text>
      <Text style={styles.parlayReason}>{parlay.rationale}</Text>
      <Text style={styles.parlayQuantLine}>
        <Text>EV </Text>
        <Text style={parlayExpectedValueTone}>{formatPercent(parlay.expectedValue)}</Text>
        <Text> • Kelly </Text>
        <Text style={parlayKellyTone}>{formatPercent(parlay.kellyFraction)}</Text>
        <Text> • Sim </Text>
        <Text style={parlaySimulationTone}>{formatPercent(parlay.simulatedHitRate)}</Text>
      </Text>
      {parlay.legs.map((leg) => (
        <View key={`${parlay.id}-${leg.recommendationId}`} style={styles.parlayLegRow}>
          <Text style={styles.parlayLegSelection}>{leg.selection}</Text>
          <Text style={[styles.parlayLegOdds, getSignedMetricTone({ value: leg.odds })]}>{formatOdds(leg.odds)}</Text>
        </View>
      ))}
    </View>
  );
}

function ProjectionSummary({ data }: { data: DashboardData }) {
  const marketConfidenceTone = getSignedMetricTone({ value: data.analytics.marketPulse.averageConfidence, threshold: 50, treatAsPercent: true });
  const volatilityTone = getSignedMetricTone({ value: data.analytics.marketPulse.averageVolatility, threshold: 0.5, treatAsPercent: true });
  const stabilityTone = getSignedMetricTone({ value: data.analytics.marketPulse.averageStability, threshold: 0.5, treatAsPercent: true });
  const roiTone = getSignedMetricTone({ value: data.backtest.roi });

  return (
    <View style={styles.quantGrid}>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Best environment</Text>
        <Text style={styles.quantValue}>{data.analytics.marketPulse.bestEnvironment}</Text>
        <Text style={styles.quantSubtext}>
          <Text style={marketConfidenceTone}>{data.analytics.marketPulse.averageConfidence}%</Text>
          <Text> avg player-model confidence</Text>
        </Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Market volatility</Text>
        <Text style={[styles.quantValue, volatilityTone]}>{formatPercent(data.analytics.marketPulse.averageVolatility)}</Text>
        <Text style={styles.quantSubtext}>Lower volatility usually leads to cleaner single bets and safer parlays.</Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Average stability</Text>
        <Text style={[styles.quantValue, stabilityTone]}>{formatPercent(data.analytics.marketPulse.averageStability)}</Text>
        <Text style={styles.quantSubtext}>Higher stability means the player-form model is seeing less variance in its core inputs.</Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Backtest ROI</Text>
        <Text style={[styles.quantValue, roiTone]}>{formatPercent(data.backtest.roi)}</Text>
        <Text style={styles.quantSubtext}>{data.backtest.sampleSize} historical samples • calibration {data.backtest.calibrationGrade}</Text>
      </View>
    </View>
  );
}

export default function App() {
  const { width } = useWindowDimensions();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [selectedSport, setSelectedSport] = useState<string>('All sports');
  const [sectionMode, setSectionMode] = useState<SectionMode>('all');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [boardLoadState, setBoardLoadState] = useState<BoardLoadState>(defaultBoardLoadState);
  const latestRequestId = useRef(0);
  const mountedRef = useRef(true);

  const isTablet = width >= 720;
  const isWide = width >= 1024;

  const fetchDashboard = async (mode: LoadingState) => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadingState(mode);
    setErrorMessage(null);
    setBoardLoadState(defaultBoardLoadState);

    try {
      if (mode === 'refreshing') {
        await impact();
      }

      const nextData = await loadDashboardData({
        forceRefresh: mode === 'refreshing',
        onProgress: (progress: DashboardLoadProgress) => {
          if (!mountedRef.current || latestRequestId.current !== requestId) {
            return;
          }

          setBoardLoadState({
            progress: progress.progress,
            text: progress.text,
          });
        },
      });

      if (!mountedRef.current || latestRequestId.current !== requestId) {
        return;
      }

      setData(nextData);
      setLastUpdated(new Date().toISOString());
      setBoardLoadState({
        progress: 1,
        text: 'Board ready',
      });
      await success();
    } catch (error) {
      if (!mountedRef.current || latestRequestId.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unexpected error while loading the dashboard.';
      setErrorMessage(message);
      await warning();
    } finally {
      if (mountedRef.current && latestRequestId.current === requestId) {
        setLoadingState('idle');
      }
    }
  };

  useEffect(() => {
    void fetchDashboard('loading');

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const recommendationCount = data?.recommendations.length ?? 0;
  const betCount = data?.bets.length ?? 0;
  const newsCount = data?.news.length ?? 0;
  const parlayCount = data?.parlays.length ?? 0;
  const sportOptions = ['All sports', ...(data ? Array.from(new Set(data.bets.map((event) => event.sportTitle))) : [])];
  const filteredBets =
    data?.bets.filter((event) => selectedSport === 'All sports' || event.sportTitle === selectedSport) ?? [];
  const matchupSet = new Set(filteredBets.map((event) => `${event.awayTeam} at ${event.homeTeam}`));
  const filteredRecommendations =
    data?.recommendations.filter(
      (recommendation) => selectedSport === 'All sports' || matchupSet.has(recommendation.matchup)
    ) ?? [];
  const filteredNewsBase =
    data?.news.filter((article) => {
      if (selectedSport === 'All sports') {
        return true;
      }

      const articleText = `${article.title} ${article.description}`.toLowerCase();

      return filteredBets.some((event) => {
        return [event.sportTitle, event.homeTeam, event.awayTeam].some((token) => articleText.includes(token.toLowerCase()));
      });
    }) ?? [];
  const filteredNews = filteredNewsBase.length > 0 || selectedSport === 'All sports' ? filteredNewsBase : data?.news ?? [];
  const filteredParlays =
    data?.parlays.filter(
      (parlay) => selectedSport === 'All sports' || parlay.legs.some((leg) => matchupSet.has(leg.matchup))
    ) ?? [];
  const filteredPlayers =
    data?.analytics.featuredPlayers.filter(
      (projection) =>
        selectedSport === 'All sports' || filteredBets.some((event) => event.homeTeam === projection.team || event.awayTeam === projection.team)
    ) ?? [];
  const moodLabel = buildMoodLabel(data);
  const moodCaption = buildMoodCaption(data);
  const shouldShowPicks = sectionMode === 'all' || sectionMode === 'picks';
  const shouldShowNews = sectionMode === 'all' || sectionMode === 'news';
  const shouldShowLines = sectionMode === 'all' || sectionMode === 'lines';
  const shouldShowModel = sectionMode === 'all' || sectionMode === 'model';

  const renderRecommendations = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Live predictions board</Text>
        <Text style={styles.sectionSubtitle}>Ranked by best available price, market quality, and recommendation engine confidence across the full screened slate.</Text>
      </View>
      {filteredRecommendations.map((recommendation) => (
        <RecommendationCard key={recommendation.id} recommendation={recommendation} compact={isTablet} />
      ))}
      {filteredRecommendations.length === 0 ? <Text style={styles.emptyText}>No recommendations match that sport filter yet.</Text> : null}
    </View>
  );

  const renderNews = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Sports betting news</Text>
        <Text style={styles.sectionSubtitle}>Tap any story to open the source and inspect what is influencing the board.</Text>
      </View>
      {filteredNews.map((article) => (
        <NewsCard key={article.url} article={article} />
      ))}
    </View>
  );

  const renderModel = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Quant model</Text>
        <Text style={styles.sectionSubtitle}>Regression projections and low-correlation parlay builds derived from recent player performance histories.</Text>
      </View>
      {data ? <ProjectionSummary data={data} /> : null}
      {filteredParlays.map((parlay) => (
        <ParlayCard key={parlay.id} parlay={parlay} />
      ))}
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Player model drivers</Text>
          <Text style={styles.sectionSubtitle}>The most important player trends feeding into the event-level regression model.</Text>
        </View>
        {filteredPlayers.map((projection) => (
          <View key={projection.playerId} style={styles.playerCard}>
            <View style={styles.playerCardHeader}>
              <View>
                <Text style={styles.playerName}>{projection.playerName}</Text>
                <Text style={styles.playerMeta}>{projection.team} • {projection.metric}</Text>
              </View>
              <Text style={[styles.playerProjection, getSignedMetricTone({ value: projection.projectedValue })]}>{projection.projectedValue.toFixed(1)}</Text>
            </View>
            <Text style={styles.playerStatsLine}>
              <Text>Baseline </Text>
              <Text style={getSignedMetricTone({ value: projection.baselineAverage })}>{projection.baselineAverage.toFixed(1)}</Text>
              <Text> • {formatTrendLabel(projection.trendLabel)} trend • </Text>
              <Text style={getSignedMetricTone({ value: projection.confidence, threshold: 50, treatAsPercent: true })}>{projection.confidence}% confidence</Text>
            </Text>
          </View>
        ))}
      </View>
      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Backtest and calibration</Text>
          <Text style={styles.sectionSubtitle}>Recent historical samples used to keep the deterministic engine honest.</Text>
        </View>
        <View style={styles.quantGrid}>
          <View style={styles.quantCard}>
            <Text style={styles.quantLabel}>Win rate</Text>
            <Text style={[styles.quantValue, getSignedMetricTone({ value: data?.backtest.winRate ?? 0, threshold: 0.5, treatAsPercent: true })]}>{formatPercent(data?.backtest.winRate ?? 0)}</Text>
            <Text style={styles.quantSubtext}>
              <Text>Average edge </Text>
              <Text style={getSignedMetricTone({ value: data?.backtest.averageEdge ?? 0 })}>{formatPercent(data?.backtest.averageEdge ?? 0)}</Text>
            </Text>
          </View>
          <View style={styles.quantCard}>
            <Text style={styles.quantLabel}>Max drawdown</Text>
            <Text style={[styles.quantValue, getSignedMetricTone({ value: -(data?.backtest.maxDrawdown ?? 0) })]}>{formatUnitSigned(-(data?.backtest.maxDrawdown ?? 0))}</Text>
            <Text style={styles.quantSubtext}>
              <Text>Average Kelly </Text>
              <Text style={getSignedMetricTone({ value: data?.backtest.averageKelly ?? 0 })}>{formatPercent(data?.backtest.averageKelly ?? 0)}</Text>
            </Text>
          </View>
          <View style={styles.quantCard}>
            <Text style={styles.quantLabel}>Brier score</Text>
            <Text style={styles.quantValue}>{(data?.backtest.brierScore ?? 0).toFixed(3)}</Text>
            <Text style={styles.quantSubtext}>
              <Text>Profit </Text>
              <Text style={getSignedMetricTone({ value: data?.backtest.profitUnits ?? 0 })}>{formatUnitSigned(data?.backtest.profitUnits ?? 0)}</Text>
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderLines = () => (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>All tracked betting lines</Text>
        <Text style={styles.sectionSubtitle}>The full market board for the active filter, optimized for both phone and tablet widths.</Text>
      </View>
      {filteredBets.map((event) => (
        <EventCard key={event.id} event={event} compact={isTablet} />
      ))}
      {filteredBets.length === 0 ? <Text style={styles.emptyText}>No events match that sport filter.</Text> : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            tintColor="#FACC15"
            refreshing={loadingState === 'refreshing'}
            onRefresh={() => void fetchDashboard('refreshing')}
          />
        }
      >
        <View style={styles.heroShell}>
          <View style={styles.heroCard}>
            <View style={styles.heroTopRow}>
              <View style={styles.heroHeadingBlock}>
                <Text style={styles.heroTitle}>sports genie</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showInfoPanel ? 'Hide info panel' : 'Show info panel'}
                style={[styles.infoButton, showInfoPanel ? styles.infoButtonActive : null]}
                onPress={() => {
                  void impact();
                  setShowInfoPanel((current) => !current);
                }}
              >
                <Text style={[styles.infoButtonText, showInfoPanel ? styles.infoButtonTextActive : null]}>i</Text>
              </Pressable>
            </View>
            <View style={styles.heroActionsRow}>
              <Pressable
                disabled={loadingState !== 'idle'}
                style={[styles.primaryButton, loadingState !== 'idle' ? styles.primaryButtonDisabled : null]}
                onPress={() => void fetchDashboard('refreshing')}
              >
                <Text style={styles.primaryButtonText}>Refresh board</Text>
              </Pressable>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotValue}>{recommendationCount}</Text>
                <Text style={styles.snapshotLabel}>Predictions</Text>
              </View>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotValue}>{betCount}</Text>
                <Text style={styles.snapshotLabel}>Events</Text>
              </View>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotValue}>{newsCount}</Text>
                <Text style={styles.snapshotLabel}>Headlines</Text>
              </View>
              <View style={styles.snapshotCard}>
                <Text style={styles.snapshotValue}>{parlayCount}</Text>
                <Text style={styles.snapshotLabel}>Parlays</Text>
              </View>
            </View>
            <View style={styles.heroFooterRow}>
              <Text style={styles.lastUpdatedText}>
                {lastUpdated ? `Updated ${formatDashboardTimestamp(lastUpdated)}` : 'Waiting for first sync'}
              </Text>
            </View>
          </View>
          {showInfoPanel ? <InfoPanel moodLabel={moodLabel} moodCaption={moodCaption} /> : null}
        </View>

        {data ? (
          <View style={styles.providersRow}>
            <ProviderPill label="Odds" value={data.providers.odds} />
            <ProviderPill label="News" value={data.providers.news} />
            <ProviderPill label="Picks" value={data.providers.recommendations} />
            <ProviderPill label="Model" value={data.providers.analytics} />
          </View>
        ) : null}

        <View style={styles.controlStrip}>
          {sectionModes.map((mode) => (
            <FilterChip
              key={mode.key}
              label={mode.label}
              active={sectionMode === mode.key}
              onPress={() => {
                void impact();
                setSectionMode(mode.key);
              }}
            />
          ))}
        </View>

        <View style={styles.controlStrip}>
          {sportOptions.map((sport) => (
            <FilterChip
              key={sport}
              label={sport}
              active={selectedSport === sport}
              onPress={() => {
                void impact();
                setSelectedSport(sport);
              }}
            />
          ))}
        </View>

        {loadingState !== 'idle' ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#FACC15" size="large" />
            <View style={styles.boardLoadTrack}>
              <View style={[styles.boardLoadFill, { width: `${Math.max(8, Math.min(100, Math.round(boardLoadState.progress * 100)))}%` }]} />
            </View>
            <Text style={styles.loadingText}>{boardLoadState.text}</Text>
            <Text style={styles.loadingMetaText}>{Math.round(boardLoadState.progress * 100)}% complete</Text>
          </View>
        ) : null}

        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorTitle}>Unable to refresh the board</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable style={styles.secondaryButton} onPress={() => void fetchDashboard('refreshing')}>
              <Text style={styles.secondaryButtonText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {data ? (
          <>
            {isWide && sectionMode === 'all' ? (
              <View style={styles.desktopGrid}>
                <View style={styles.leftColumn}>
                  {shouldShowPicks ? renderRecommendations() : null}
                  {shouldShowModel ? renderModel() : null}
                  {shouldShowNews ? renderNews() : null}
                </View>
                <View style={styles.rightColumn}>{shouldShowLines ? renderLines() : null}</View>
              </View>
            ) : (
              <>
                {shouldShowPicks ? renderRecommendations() : null}
                {shouldShowModel ? renderModel() : null}
                {shouldShowNews ? renderNews() : null}
                {shouldShowLines ? renderLines() : null}
              </>
            )}
          </>
        ) : null}
      </ScrollView>
      <AdvisorWindow
        events={filteredBets}
        news={filteredNews.slice(0, 12)}
        analytics={data?.analytics ?? null}
        recommendations={filteredRecommendations.slice(0, 12)}
        selectedSport={selectedSport}
        providerSummary={data?.providers}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#EAF2FF',
  },
  screen: {
    flex: 1,
    backgroundColor: '#EAF2FF',
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 40,
    gap: 14,
  },
  heroShell: {
    marginTop: 14,
  },
  heroCard: {
    backgroundColor: '#0D4CFF',
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: '#1B63FF',
    shadowColor: '#0B2B7A',
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
    gap: 16,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroHeadingBlock: {
    flex: 1,
    gap: 6,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontSize: 36,
    lineHeight: 40,
    fontWeight: '900',
  },
  infoButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#90B6FF',
    backgroundColor: '#F5FF5B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoButtonActive: {
    backgroundColor: '#081B53',
    borderColor: '#9FC3FF',
  },
  infoButtonText: {
    color: '#081B53',
    fontSize: 20,
    fontWeight: '900',
  },
  infoButtonTextActive: {
    color: '#FFFFFF',
  },
  heroActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: '#FF6B00',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryButton: {
    marginTop: 14,
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FF6B6B',
    backgroundColor: '#FFF0F0',
  },
  secondaryButtonText: {
    color: '#B42318',
    fontWeight: '700',
  },
  snapshotCard: {
    minWidth: 88,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#A9C6FF',
  },
  snapshotValue: {
    color: '#0D4CFF',
    fontSize: 24,
    fontWeight: '800',
  },
  snapshotLabel: {
    color: '#506484',
    fontSize: 12,
    marginTop: 4,
  },
  heroFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  lastUpdatedText: {
    color: '#DDEAFF',
    fontSize: 12,
    fontWeight: '600',
  },
  infoPanel: {
    marginTop: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#B8D1FF',
    gap: 14,
    shadowColor: '#0B2B7A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  infoPanelHeader: {
    gap: 4,
  },
  infoPanelEyebrow: {
    color: '#FF6B00',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  infoPanelTitle: {
    color: '#081B53',
    fontSize: 22,
    fontWeight: '900',
  },
  infoPanelBody: {
    color: '#30425F',
    lineHeight: 21,
  },
  infoPanelGrid: {
    gap: 10,
  },
  infoPill: {
    backgroundColor: '#F3F8FF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D4E3FF',
    padding: 14,
    gap: 4,
  },
  infoPillLabel: {
    color: '#4E6FA6',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.9,
  },
  infoPillValue: {
    color: '#081B53',
    lineHeight: 20,
    fontWeight: '600',
  },
  providersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  providerPill: {
    flexGrow: 1,
    minWidth: '30%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    backgroundColor: '#FFFFFF',
  },
  providerPillLive: {
    borderColor: '#12B76A',
    backgroundColor: '#ECFDF3',
  },
  providerPillFallback: {
    borderColor: '#F79009',
    backgroundColor: '#FFF7E8',
  },
  providerLabel: {
    color: '#5B6F92',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  providerValue: {
    color: '#081B53',
    fontWeight: '700',
    fontSize: 14,
  },
  controlStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  filterChip: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
  },
  filterChipActive: {
    backgroundColor: '#0D4CFF',
    borderColor: '#0D4CFF',
  },
  filterChipIdle: {
    backgroundColor: '#FFFFFF',
    borderColor: '#C6D9FF',
  },
  filterChipText: {
    fontWeight: '700',
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  filterChipTextIdle: {
    color: '#14305F',
  },
  loadingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#C6D9FF',
  },
  loadingText: {
    color: '#16335E',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  loadingMetaText: {
    color: '#4E6FA6',
    fontSize: 12,
    fontWeight: '700',
  },
  boardLoadTrack: {
    width: '100%',
    maxWidth: 420,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#D8E6FF',
    overflow: 'hidden',
  },
  boardLoadFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#12B76A',
  },
  errorCard: {
    backgroundColor: '#FFF0F0',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#FF6B6B',
  },
  errorTitle: {
    color: '#B42318',
    fontWeight: '800',
    fontSize: 18,
    marginBottom: 8,
  },
  errorMessage: {
    color: '#B42318',
    lineHeight: 20,
  },
  sectionBlock: {
    gap: 14,
  },
  sectionHeader: {
    marginTop: 10,
    gap: 4,
  },
  sectionTitle: {
    color: '#081B53',
    fontSize: 22,
    fontWeight: '900',
  },
  sectionSubtitle: {
    color: '#49617F',
    lineHeight: 20,
  },
  recommendationCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#C6D9FF',
    gap: 8,
  },
  recommendationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rankToken: {
    backgroundColor: '#F5FF5B',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rankBadge: {
    color: '#081B53',
    fontSize: 14,
    fontWeight: '800',
  },
  confidenceText: {
    color: '#4E6FA6',
    fontSize: 13,
    fontWeight: '700',
  },
  metricPositive: {
    color: '#0E9F6E',
  },
  metricNegative: {
    color: '#D92D20',
  },
  recommendationMatchup: {
    color: '#081B53',
    fontSize: 19,
    fontWeight: '800',
  },
  recommendationPick: {
    color: '#0D4CFF',
    fontSize: 17,
    fontWeight: '700',
  },
  recommendationMeta: {
    color: '#49617F',
    fontSize: 13,
  },
  recommendationBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  edgeBadge: {
    color: '#075E45',
    backgroundColor: '#D9FBE8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
  },
  riskBadge: {
    color: '#9A6700',
    backgroundColor: '#FFF0C2',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  parlayBadge: {
    color: '#0D4CFF',
    backgroundColor: '#E5EEFF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
  },
  confidenceTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#D8E6FF',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#FF6B00',
  },
  recommendationReason: {
    color: '#16335E',
    lineHeight: 20,
  },
  modelSummary: {
    color: '#35517A',
    lineHeight: 19,
  },
  quantMetaLine: {
    color: '#35517A',
    lineHeight: 18,
    fontSize: 12,
  },
  supportingPlayers: {
    color: '#35517A',
    lineHeight: 19,
  },
  recommendationHeadline: {
    color: '#B54708',
    lineHeight: 20,
  },
  quantGrid: {
    gap: 12,
  },
  quantCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#C6D9FF',
    gap: 6,
  },
  quantLabel: {
    color: '#4E6FA6',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  quantValue: {
    color: '#081B53',
    fontSize: 20,
    fontWeight: '800',
  },
  quantSubtext: {
    color: '#35517A',
    lineHeight: 19,
  },
  parlayCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#C6D9FF',
    gap: 10,
  },
  parlayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  parlayTitle: {
    color: '#081B53',
    fontSize: 18,
    fontWeight: '800',
  },
  parlayOdds: {
    color: '#0D4CFF',
    fontSize: 18,
    fontWeight: '800',
  },
  parlayMeta: {
    color: '#49617F',
    fontSize: 13,
  },
  parlayReason: {
    color: '#16335E',
    lineHeight: 19,
  },
  parlayQuantLine: {
    color: '#35517A',
    fontSize: 12,
    lineHeight: 18,
  },
  parlayLegRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#D8E6FF',
  },
  parlayLegSelection: {
    color: '#081B53',
    flex: 1,
  },
  parlayLegOdds: {
    color: '#35517A',
    fontWeight: '700',
  },
  playerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#C6D9FF',
    gap: 6,
  },
  playerCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  playerName: {
    color: '#081B53',
    fontSize: 17,
    fontWeight: '700',
  },
  playerMeta: {
    color: '#49617F',
    marginTop: 4,
  },
  playerProjection: {
    color: '#0D4CFF',
    fontSize: 22,
    fontWeight: '800',
  },
  playerStatsLine: {
    color: '#16335E',
    lineHeight: 19,
  },
  newsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: '#C6D9FF',
  },
  newsSourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  newsSource: {
    color: '#FF6B00',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  newsTime: {
    color: '#49617F',
    fontSize: 12,
  },
  newsTitle: {
    color: '#081B53',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  newsDescription: {
    color: '#16335E',
    lineHeight: 20,
  },
  newsUrl: {
    color: '#0D4CFF',
    fontSize: 12,
    fontWeight: '700',
  },
  eventCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#C6D9FF',
    gap: 14,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventLeague: {
    color: '#FF6B00',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  eventTime: {
    color: '#49617F',
    fontSize: 12,
  },
  eventMatchup: {
    color: '#081B53',
    fontSize: 20,
    fontWeight: '800',
  },
  bookmakerBlock: {
    backgroundColor: '#F5F9FF',
    borderRadius: 16,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#D4E3FF',
  },
  bookmakerName: {
    color: '#081B53',
    fontSize: 15,
    fontWeight: '700',
  },
  marketBlock: {
    gap: 8,
  },
  marketLabel: {
    color: '#4E6FA6',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  outcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  outcomeRowCompact: {
    alignItems: 'flex-start',
  },
  outcomeName: {
    flex: 1,
    color: '#16335E',
  },
  outcomePrice: {
    color: '#0D4CFF',
    fontWeight: '700',
  },
  desktopGrid: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'flex-start',
  },
  leftColumn: {
    flex: 1,
    gap: 18,
  },
  rightColumn: {
    flex: 1.05,
    gap: 18,
  },
  emptyText: {
    color: '#49617F',
    lineHeight: 20,
    paddingVertical: 8,
  },
});
