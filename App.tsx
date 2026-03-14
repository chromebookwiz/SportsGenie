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
import { loadDashboardData } from './src/services/dashboard';
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

function RecommendationCard({ recommendation, compact }: { recommendation: Recommendation; compact: boolean }) {
  const barWidth = `${Math.max(10, Math.min(100, recommendation.confidence))}%` as const;

  return (
    <View style={styles.recommendationCard}>
      <View style={styles.recommendationHeaderRow}>
        <View style={styles.rankToken}>
          <Text style={styles.rankBadge}>#{recommendation.rank}</Text>
        </View>
        <Text style={styles.confidenceText}>{recommendation.confidence}% confidence</Text>
      </View>
      <Text style={styles.recommendationMatchup}>{recommendation.matchup}</Text>
      <Text style={styles.recommendationPick}>{recommendation.selection}</Text>
      <Text style={styles.recommendationMeta}>
        {formatMarketLabel(recommendation.market)} via {recommendation.sportsbook} at {formatOdds(recommendation.odds)}
      </Text>
      <View style={styles.recommendationBadgeRow}>
        {typeof recommendation.edgePercent === 'number' ? <Text style={styles.edgeBadge}>Edge {formatPercent(recommendation.edgePercent)}</Text> : null}
        {recommendation.riskLabel ? <Text style={styles.riskBadge}>{recommendation.riskLabel} risk</Text> : null}
        {recommendation.parlayEligible ? <Text style={styles.parlayBadge}>Parlay-ready</Text> : null}
      </View>
      <View style={styles.confidenceTrack}>
        <View style={[styles.confidenceFill, { width: barWidth }]} />
      </View>
      <Text style={styles.recommendationReason}>{recommendation.rationale}</Text>
      {recommendation.modelSummary ? <Text style={styles.modelSummary}>{recommendation.modelSummary}</Text> : null}
      <Text style={styles.quantMetaLine}>
        Fair {typeof recommendation.fairProbability === 'number' ? formatPercent(recommendation.fairProbability) : 'n/a'} • Implied {typeof recommendation.impliedProbability === 'number' ? formatPercent(recommendation.impliedProbability) : 'n/a'} • EV {typeof recommendation.expectedValue === 'number' ? formatPercent(recommendation.expectedValue) : 'n/a'}
      </Text>
      <Text style={styles.quantMetaLine}>
        Kelly {typeof recommendation.kellyFraction === 'number' ? formatPercent(recommendation.kellyFraction) : 'n/a'} • Sim {typeof recommendation.simulatedWinRate === 'number' ? formatPercent(recommendation.simulatedWinRate) : 'n/a'}
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
  return (
    <View style={styles.parlayCard}>
      <View style={styles.parlayHeaderRow}>
        <Text style={styles.parlayTitle}>{parlay.title}</Text>
        <Text style={styles.parlayOdds}>{formatOdds(parlay.combinedOdds)}</Text>
      </View>
      <Text style={styles.parlayMeta}>{parlay.confidence}% confidence • {parlay.correlationRisk} correlation risk</Text>
      <Text style={styles.parlayReason}>{parlay.rationale}</Text>
      <Text style={styles.parlayQuantLine}>
        EV {formatPercent(parlay.expectedValue)} • Kelly {formatPercent(parlay.kellyFraction)} • Sim {formatPercent(parlay.simulatedHitRate)}
      </Text>
      {parlay.legs.map((leg) => (
        <View key={`${parlay.id}-${leg.recommendationId}`} style={styles.parlayLegRow}>
          <Text style={styles.parlayLegSelection}>{leg.selection}</Text>
          <Text style={styles.parlayLegOdds}>{formatOdds(leg.odds)}</Text>
        </View>
      ))}
    </View>
  );
}

function ProjectionSummary({ data }: { data: DashboardData }) {
  return (
    <View style={styles.quantGrid}>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Best environment</Text>
        <Text style={styles.quantValue}>{data.analytics.marketPulse.bestEnvironment}</Text>
        <Text style={styles.quantSubtext}>{data.analytics.marketPulse.averageConfidence}% avg player-model confidence</Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Market volatility</Text>
        <Text style={styles.quantValue}>{formatPercent(data.analytics.marketPulse.averageVolatility)}</Text>
        <Text style={styles.quantSubtext}>Lower volatility usually leads to cleaner single bets and safer parlays.</Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Average stability</Text>
        <Text style={styles.quantValue}>{formatPercent(data.analytics.marketPulse.averageStability)}</Text>
        <Text style={styles.quantSubtext}>Higher stability means the player-form model is seeing less variance in its core inputs.</Text>
      </View>
      <View style={styles.quantCard}>
        <Text style={styles.quantLabel}>Backtest ROI</Text>
        <Text style={styles.quantValue}>{formatPercent(data.backtest.roi)}</Text>
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
  const [selectedSport, setSelectedSport] = useState<string>('All sports');
  const [sectionMode, setSectionMode] = useState<SectionMode>('all');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const latestRequestId = useRef(0);
  const mountedRef = useRef(true);

  const isTablet = width >= 720;
  const isWide = width >= 1024;

  const fetchDashboard = async (mode: LoadingState) => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadingState(mode);
    setErrorMessage(null);

    try {
      if (mode === 'refreshing') {
        await impact();
      }

      const nextData = await loadDashboardData({ forceRefresh: mode === 'refreshing' });

      if (!mountedRef.current || latestRequestId.current !== requestId) {
        return;
      }

      setData(nextData);
      setLastUpdated(new Date().toISOString());
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
              <Text style={styles.playerProjection}>{projection.projectedValue.toFixed(1)}</Text>
            </View>
            <Text style={styles.playerStatsLine}>
              Baseline {projection.baselineAverage.toFixed(1)} • {formatTrendLabel(projection.trendLabel)} trend • {projection.confidence}% confidence
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
            <Text style={styles.quantValue}>{formatPercent(data?.backtest.winRate ?? 0)}</Text>
            <Text style={styles.quantSubtext}>Average edge {formatPercent(data?.backtest.averageEdge ?? 0)}</Text>
          </View>
          <View style={styles.quantCard}>
            <Text style={styles.quantLabel}>Max drawdown</Text>
            <Text style={styles.quantValue}>{(data?.backtest.maxDrawdown ?? 0).toFixed(2)}u</Text>
            <Text style={styles.quantSubtext}>Average Kelly {formatPercent(data?.backtest.averageKelly ?? 0)}</Text>
          </View>
          <View style={styles.quantCard}>
            <Text style={styles.quantLabel}>Brier score</Text>
            <Text style={styles.quantValue}>{(data?.backtest.brierScore ?? 0).toFixed(3)}</Text>
            <Text style={styles.quantSubtext}>Profit {data?.backtest.profitUnits.toFixed(2)}u</Text>
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
            <Text style={styles.eyebrow}>SportGenie</Text>
            <Text style={styles.heroTitle}>Quant-first betting board with restrained LLM research on top.</Text>
            <Text style={styles.heroSubtitle}>
              Live prices, no-vig math, model signals, and tool-assisted recommendations presented in a tighter, cleaner board.
            </Text>
            <View style={styles.moodRow}>
              <View style={styles.moodChip}>
                <Text style={styles.moodChipLabel}>Market mood</Text>
                <Text style={styles.moodChipValue}>{moodLabel}</Text>
              </View>
              <Text style={styles.moodCaption}>{moodCaption}</Text>
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
              <Text style={styles.lastUpdatedText}>Optimized for phone and tablet widths</Text>
            </View>
          </View>
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

        {loadingState === 'loading' ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color="#FACC15" size="large" />
            <Text style={styles.loadingText}>Building the board from sportsbook feeds, no-vig pricing, regression models, Monte Carlo simulations, and optional LLM ranking.</Text>
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
    backgroundColor: '#F2EFE8',
  },
  screen: {
    flex: 1,
    backgroundColor: '#F2EFE8',
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
    backgroundColor: '#111111',
    borderRadius: 4,
    padding: 22,
    borderWidth: 1,
    borderColor: '#111111',
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  eyebrow: {
    color: '#D6C2A2',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  heroTitle: {
    color: '#F5F1E8',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroSubtitle: {
    color: '#D3CEC3',
    fontSize: 15,
    lineHeight: 22,
  },
  moodRow: {
    marginTop: 18,
    gap: 10,
  },
  moodChip: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#4B4B4B',
    backgroundColor: '#1B1B1B',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  moodChipLabel: {
    color: '#A39D8F',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 11,
  },
  moodChipValue: {
    color: '#F5F1E8',
    fontWeight: '800',
    marginTop: 3,
  },
  moodCaption: {
    color: '#D3CEC3',
    lineHeight: 21,
    maxWidth: 560,
  },
  heroActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 20,
  },
  primaryButton: {
    backgroundColor: '#F0E8DA',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonDisabled: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: '#111111',
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
    borderColor: '#C45D4B',
    backgroundColor: '#FFF7F4',
  },
  secondaryButtonText: {
    color: '#7B2D21',
    fontWeight: '700',
  },
  snapshotCard: {
    minWidth: 88,
    backgroundColor: '#1B1B1B',
    borderRadius: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#343434',
  },
  snapshotValue: {
    color: '#F5F1E8',
    fontSize: 24,
    fontWeight: '800',
  },
  snapshotLabel: {
    color: '#A39D8F',
    fontSize: 12,
    marginTop: 4,
  },
  heroFooterRow: {
    marginTop: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  lastUpdatedText: {
    color: '#A39D8F',
    fontSize: 12,
  },
  providersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  providerPill: {
    flexGrow: 1,
    minWidth: '30%',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    backgroundColor: '#FBF8F1',
  },
  providerPillLive: {
    borderColor: '#111111',
  },
  providerPillFallback: {
    borderColor: '#B7B0A4',
  },
  providerLabel: {
    color: '#6E685F',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  providerValue: {
    color: '#111111',
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
    backgroundColor: '#111111',
    borderColor: '#111111',
  },
  filterChipIdle: {
    backgroundColor: '#FBF8F1',
    borderColor: '#CFC8BC',
  },
  filterChipText: {
    fontWeight: '700',
    fontSize: 13,
  },
  filterChipTextActive: {
    color: '#F5F1E8',
  },
  filterChipTextIdle: {
    color: '#111111',
  },
  loadingCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 24,
    alignItems: 'center',
    gap: 14,
    borderWidth: 1,
    borderColor: '#D1CAC0',
  },
  loadingText: {
    color: '#3C3A35',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorCard: {
    backgroundColor: '#FFF7F4',
    borderRadius: 4,
    padding: 20,
    borderWidth: 1,
    borderColor: '#C45D4B',
  },
  errorTitle: {
    color: '#7B2D21',
    fontWeight: '800',
    fontSize: 18,
    marginBottom: 8,
  },
  errorMessage: {
    color: '#7B2D21',
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
    color: '#111111',
    fontSize: 22,
    fontWeight: '800',
  },
  sectionSubtitle: {
    color: '#666055',
    lineHeight: 20,
  },
  recommendationCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 18,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    gap: 8,
  },
  recommendationHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rankToken: {
    backgroundColor: '#F0E8DA',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rankBadge: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '800',
  },
  confidenceText: {
    color: '#6E685F',
    fontSize: 13,
    fontWeight: '700',
  },
  recommendationMatchup: {
    color: '#111111',
    fontSize: 19,
    fontWeight: '800',
  },
  recommendationPick: {
    color: '#2B2925',
    fontSize: 17,
    fontWeight: '700',
  },
  recommendationMeta: {
    color: '#6E685F',
    fontSize: 13,
  },
  recommendationBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  edgeBadge: {
    color: '#2F3A1B',
    backgroundColor: '#E8E4D8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
  },
  riskBadge: {
    color: '#5E4A20',
    backgroundColor: '#F0E8DA',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  parlayBadge: {
    color: '#3B3530',
    backgroundColor: '#E8E4D8',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 12,
    fontWeight: '700',
  },
  confidenceTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#DDD6CB',
    overflow: 'hidden',
  },
  confidenceFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#111111',
  },
  recommendationReason: {
    color: '#2B2925',
    lineHeight: 20,
  },
  modelSummary: {
    color: '#4D4A44',
    lineHeight: 19,
  },
  quantMetaLine: {
    color: '#4D4A44',
    lineHeight: 18,
    fontSize: 12,
  },
  supportingPlayers: {
    color: '#4D4A44',
    lineHeight: 19,
  },
  recommendationHeadline: {
    color: '#7A6849',
    lineHeight: 20,
  },
  quantGrid: {
    gap: 12,
  },
  quantCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    gap: 6,
  },
  quantLabel: {
    color: '#6E685F',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  quantValue: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '800',
  },
  quantSubtext: {
    color: '#4D4A44',
    lineHeight: 19,
  },
  parlayCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    gap: 10,
  },
  parlayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  parlayTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '800',
  },
  parlayOdds: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '800',
  },
  parlayMeta: {
    color: '#6E685F',
    fontSize: 13,
  },
  parlayReason: {
    color: '#2B2925',
    lineHeight: 19,
  },
  parlayQuantLine: {
    color: '#4D4A44',
    fontSize: 12,
    lineHeight: 18,
  },
  parlayLegRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#DDD6CB',
  },
  parlayLegSelection: {
    color: '#111111',
    flex: 1,
  },
  parlayLegOdds: {
    color: '#4D4A44',
    fontWeight: '700',
  },
  playerCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    gap: 6,
  },
  playerCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  playerName: {
    color: '#111111',
    fontSize: 17,
    fontWeight: '700',
  },
  playerMeta: {
    color: '#6E685F',
    marginTop: 4,
  },
  playerProjection: {
    color: '#111111',
    fontSize: 22,
    fontWeight: '800',
  },
  playerStatsLine: {
    color: '#2B2925',
    lineHeight: 19,
  },
  newsCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 18,
    gap: 8,
    borderWidth: 1,
    borderColor: '#D1CAC0',
  },
  newsSourceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  newsSource: {
    color: '#7A6849',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  newsTime: {
    color: '#6E685F',
    fontSize: 12,
  },
  newsTitle: {
    color: '#111111',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  newsDescription: {
    color: '#2B2925',
    lineHeight: 20,
  },
  newsUrl: {
    color: '#4D4A44',
    fontSize: 12,
    fontWeight: '700',
  },
  eventCard: {
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    padding: 18,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    gap: 14,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  eventLeague: {
    color: '#7A6849',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  eventTime: {
    color: '#6E685F',
    fontSize: 12,
  },
  eventMatchup: {
    color: '#111111',
    fontSize: 20,
    fontWeight: '800',
  },
  bookmakerBlock: {
    backgroundColor: '#F7F3EB',
    borderRadius: 4,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2DBD0',
  },
  bookmakerName: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '700',
  },
  marketBlock: {
    gap: 8,
  },
  marketLabel: {
    color: '#6E685F',
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
    color: '#111111',
  },
  outcomePrice: {
    color: '#4D4A44',
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
    color: '#6E685F',
    lineHeight: 20,
    paddingVertical: 8,
  },
});
