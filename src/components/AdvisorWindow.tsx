import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import {
  askWebLlmAdvisor,
  getActiveWebLlmModel,
  getLoadedWebLlmModels,
  isWebLlmSupported,
  preloadWebLlmModel,
  webLlmModelOptions,
} from '../services/webllm';
import type { AnalyticsOverview, BettingEvent, NewsArticle, Recommendation } from '../types/sports';

type AdvisorWindowProps = {
  events: BettingEvent[];
  news: NewsArticle[];
  analytics: AnalyticsOverview | null;
  recommendations: Recommendation[];
  selectedSport: string;
  providerSummary?: Record<string, string>;
};

type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
};

type WindowState = 'open' | 'minimized' | 'closed';

type PersistedAdvisorState = {
  messages: ChatMessage[];
  windowState: WindowState;
  position?: { x: number; y: number };
  modelId?: string;
};

const quickPrompts = [
  'What is the cleanest bet on this board right now?',
  'What should I avoid because the evidence is weak?',
  'Compare the top spread and total opportunities.',
  'How should I size and diversify the top bets today?',
];

const STORAGE_KEY = 'sportgenie:advisor-window:v1';
const defaultMessages: ChatMessage[] = [
  {
    id: 'intro',
    role: 'assistant',
    content: 'Ask for a best bet, a risk check, a matchup breakdown, a book comparison, or portfolio sizing. On supported web builds, this advisor uses local WebLLM plus live research tools.',
  },
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const buildCandidateContext = (recommendations: Recommendation[]) =>
  recommendations.map((recommendation) => ({
    id: recommendation.id,
    matchup: recommendation.matchup,
    market: recommendation.market,
    selection: recommendation.selection,
    sportsbook: recommendation.sportsbook,
    odds: recommendation.odds,
    score: recommendation.score,
    confidence: recommendation.confidence,
    edgePercent: recommendation.edgePercent,
    expectedValue: recommendation.expectedValue,
    kellyFraction: recommendation.kellyFraction,
    simulatedWinRate: recommendation.simulatedWinRate,
    rationale: recommendation.rationale,
    relatedHeadline: recommendation.relatedHeadline,
  }));

export function AdvisorWindow({ events, news, analytics, recommendations, selectedSport, providerSummary }: AdvisorWindowProps) {
  const { width, height } = useWindowDimensions();
  const [windowState, setWindowState] = useState<WindowState>('open');
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(defaultMessages);
  const [loading, setLoading] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [selectedModel, setSelectedModel] = useState(getActiveWebLlmModel());
  const [activeModel, setActiveModel] = useState(getActiveWebLlmModel());
  const [loadedModels, setLoadedModels] = useState<string[]>(() => getLoadedWebLlmModels());
  const hasPositionRef = useRef(false);
  const hydratedRef = useRef(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const dragOriginRef = useRef({ x: 0, y: 0 });

  const panelWidth = Math.min(Math.max(width * 0.34, 320), 420);
  const panelHeight = Math.min(Math.max(height * 0.5, 420), 620);
  const supported = isWebLlmSupported();
  const canDragWindow = Platform.OS === 'web';

  const context = useMemo(
    () => ({
      events,
      news,
      analytics: analytics ?? { eventModels: [] },
      candidates: buildCandidateContext(recommendations),
      providerSummary,
      selectedSport,
    }),
    [analytics, events, news, providerSummary, recommendations, selectedSport]
  );
  const loadedModelSet = useMemo(() => new Set(loadedModels), [loadedModels]);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof localStorage === 'undefined') {
      hydratedRef.current = true;
      return;
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        hydratedRef.current = true;
        return;
      }

      const persisted = JSON.parse(raw) as PersistedAdvisorState;

      if (Array.isArray(persisted.messages) && persisted.messages.length > 0) {
        setMessages(persisted.messages.slice(-24));
      }

      if (persisted.windowState === 'open' || persisted.windowState === 'minimized' || persisted.windowState === 'closed') {
        setWindowState(persisted.windowState);
      }

      if (persisted.position && typeof persisted.position.x === 'number' && typeof persisted.position.y === 'number') {
        setPosition(persisted.position);
        hasPositionRef.current = true;
      }

      if (typeof persisted.modelId === 'string' && persisted.modelId.trim()) {
        setSelectedModel(persisted.modelId.trim());
      }

      setActiveModel(getActiveWebLlmModel());
      setLoadedModels(getLoadedWebLlmModels());
    } catch {
      setMessages(defaultMessages);
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasPositionRef.current) {
      setPosition({
        x: Math.max(12, width - panelWidth - 18),
        y: Math.max(88, height - panelHeight - 28),
      });
      hasPositionRef.current = true;
      return;
    }

    setPosition((current) => ({
      x: clamp(current.x, 8, Math.max(8, width - panelWidth - 8)),
      y: clamp(current.y, 8, Math.max(8, height - 72)),
    }));
  }, [height, panelHeight, panelWidth, width]);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages, loading]);

  useEffect(() => {
    if (!hydratedRef.current || Platform.OS !== 'web' || typeof localStorage === 'undefined') {
      return;
    }

    const persisted: PersistedAdvisorState = {
      messages: messages.slice(-24),
      windowState,
      position,
      modelId: selectedModel,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  }, [messages, position, selectedModel, windowState]);

  const loadSelectedModel = async () => {
    const trimmedModel = selectedModel.trim();

    if (!trimmedModel || modelLoading) {
      return;
    }

    setErrorMessage(null);
    setModelLoading(true);

    try {
      await preloadWebLlmModel(trimmedModel);
      setActiveModel(getActiveWebLlmModel());
      setLoadedModels(getLoadedWebLlmModels());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Model load failed');
    } finally {
      setModelLoading(false);
    }
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => canDragWindow,
        onMoveShouldSetPanResponder: (_event, gestureState) => canDragWindow && (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2),
        onStartShouldSetPanResponderCapture: () => canDragWindow,
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          canDragWindow && (Math.abs(gestureState.dx) > 2 || Math.abs(gestureState.dy) > 2),
        onPanResponderGrant: () => {
          dragOriginRef.current = position;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gestureState) => {
          if (!canDragWindow) {
            return;
          }

          setPosition({
            x: clamp(dragOriginRef.current.x + gestureState.dx, 8, Math.max(8, width - panelWidth - 8)),
            y: clamp(dragOriginRef.current.y + gestureState.dy, 8, Math.max(8, height - 72)),
          });
        },
      }),
    [canDragWindow, height, panelWidth, position, width]
  );

  const submitQuestion = async (question: string) => {
    const trimmed = question.trim();

    if (!trimmed || loading) {
      return;
    }

    const nextUserMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };
    const history = messages
      .filter((message) => message.role === 'assistant' || message.role === 'user')
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));

    setMessages((current) => [...current, nextUserMessage]);
    setInputValue('');
    setErrorMessage(null);
    setLoading(true);

    try {
      if (!supported) {
        throw new Error('WebLLM advisor is available only on web with EXPO_PUBLIC_ENABLE_WEBLLM=true and WebGPU support.');
      }

      const answer = await askWebLlmAdvisor({
        question: trimmed,
        context,
        history,
        modelId: selectedModel.trim(),
      });

      setActiveModel(getActiveWebLlmModel());
      setLoadedModels(getLoadedWebLlmModels());

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: answer,
        },
      ]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Advisor request failed');
    } finally {
      setLoading(false);
    }
  };

  if (windowState === 'closed') {
    return (
      <View style={styles.launcherWrap} pointerEvents="box-none">
        <Pressable style={styles.launcherButton} onPress={() => setWindowState('open')}>
          <Text style={styles.launcherTitle}>Advisor</Text>
          <Text style={styles.launcherSubtext}>{supported ? 'Open local WebLLM window' : 'Unavailable on this runtime'}</Text>
        </Pressable>
      </View>
    );
  }

  if (windowState === 'minimized') {
    return (
      <View style={styles.launcherWrap} pointerEvents="box-none">
        <View style={styles.minimizedBar}>
          <Pressable style={styles.minimizedMain} onPress={() => setWindowState('open')}>
            <Text style={styles.minimizedTitle}>Advisor</Text>
            <Text style={styles.minimizedSubtext}>{loading ? 'Thinking…' : supported ? 'Restore window' : 'Unavailable'}</Text>
          </Pressable>
          <Pressable style={styles.minimizedClose} onPress={() => setWindowState('closed')}>
            <Text style={styles.minimizedAction}>Close</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.overlayWrap,
        Platform.OS === 'web'
          ? {
              left: position.x,
              top: position.y,
              width: panelWidth,
            }
          : styles.overlayMobile,
      ]}
    >
      <View style={[styles.windowCard, Platform.OS !== 'web' ? { maxHeight: panelHeight } : null]}>
        <View
          style={[styles.windowHeader, canDragWindow ? styles.windowHeaderDraggable : null]}
          {...(canDragWindow ? panResponder.panHandlers : {})}
        >
          <View>
            <Text style={styles.windowTitle}>Advisor</Text>
            <Text style={styles.windowSubtitle}>{supported ? 'Local WebLLM with research tools' : 'WebLLM unavailable on this runtime'}</Text>
          </View>
          <View style={styles.windowActions}>
            <Pressable style={styles.windowActionButton} onPress={() => setWindowState('minimized')}>
              <Text style={styles.windowActionText}>Min</Text>
            </Pressable>
            <Pressable style={styles.windowActionButton} onPress={() => setWindowState('closed')}>
              <Text style={styles.windowActionText}>Close</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.windowMetaRow}>
          <Text style={styles.windowMetaText}>{selectedSport === 'All sports' ? 'Full slate' : selectedSport}</Text>
          <Text style={styles.windowMetaText}>{recommendations.length} board candidates</Text>
        </View>

        <View style={styles.modelRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modelChipRow}>
            {webLlmModelOptions.map((modelId) => (
              <Pressable
                key={modelId}
                style={[
                  styles.modelChip,
                  selectedModel === modelId ? styles.modelChipActive : null,
                  loadedModelSet.has(modelId) ? styles.modelChipLoaded : null,
                ]}
                onPress={() => setSelectedModel(modelId)}
              >
                <Text style={[styles.modelChipText, selectedModel === modelId ? styles.modelChipTextActive : null]}>{modelId}</Text>
                <Text style={[styles.modelChipMetaText, selectedModel === modelId ? styles.modelChipMetaTextActive : null]}>
                  {activeModel === modelId && loadedModelSet.has(modelId)
                    ? 'Active'
                    : loadedModelSet.has(modelId)
                      ? 'Loaded'
                      : activeModel === modelId
                        ? 'Default'
                        : 'Available'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.modelInputRow}>
            <TextInput
              value={selectedModel}
              onChangeText={setSelectedModel}
              placeholder="Model ID"
              placeholderTextColor="#7F786D"
              style={styles.modelInput}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.loadButton, modelLoading ? styles.loadButtonDisabled : null]}
              onPress={() => void loadSelectedModel()}
            >
              <Text style={styles.loadButtonText}>
                {modelLoading ? 'Loading...' : loadedModelSet.has(selectedModel) ? 'Use loaded model' : 'Load model'}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.modelMetaText}>
            {loadedModelSet.has(activeModel) ? `Active model: ${activeModel}` : `Default model: ${activeModel}`}
          </Text>
        </View>

        <View style={styles.quickPromptRow}>
          {quickPrompts.map((prompt) => (
            <Pressable key={prompt} style={styles.quickPromptButton} onPress={() => void submitQuestion(prompt)}>
              <Text style={styles.quickPromptText}>{prompt}</Text>
            </Pressable>
          ))}
        </View>

        <ScrollView ref={scrollViewRef} style={styles.chatScroll} contentContainerStyle={styles.chatContent}>
          {messages.map((message) => (
            <View key={message.id} style={[styles.chatBubble, message.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant]}>
              <Text style={styles.chatRole}>{message.role === 'user' ? 'You' : 'Advisor'}</Text>
              <Text style={styles.chatText}>{message.content}</Text>
            </View>
          ))}
          {loading ? (
            <View style={[styles.chatBubble, styles.chatBubbleAssistant]}>
              <Text style={styles.chatRole}>Advisor</Text>
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#111111" />
                <Text style={styles.chatText}>Running local research and composing advice.</Text>
              </View>
            </View>
          ) : null}
          {errorMessage ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorBoxText}>{errorMessage}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.inputWrap}>
          <View style={styles.inputMetaRow}>
            <Text style={styles.inputMetaText}>{supported ? 'History persists in this browser' : 'Enable WebGPU + WebLLM to use the advisor'}</Text>
            <Pressable onPress={() => setMessages(defaultMessages)}>
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          </View>
          <TextInput
            value={inputValue}
            onChangeText={setInputValue}
            placeholder="Ask about the best bet, risk, matchup, or books"
            placeholderTextColor="#7F786D"
            multiline
            style={styles.input}
          />
          <Pressable style={[styles.sendButton, (!inputValue.trim() || loading) ? styles.sendButtonDisabled : null]} onPress={() => void submitQuestion(inputValue)}>
            <Text style={styles.sendButtonText}>Send</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: 'absolute',
    zIndex: 40,
  },
  overlayMobile: {
    left: 12,
    right: 12,
    bottom: 12,
  },
  windowCard: {
    backgroundColor: '#FBF8F1',
    borderWidth: 1,
    borderColor: '#111111',
    borderRadius: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    overflow: 'hidden',
  },
  windowHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#111111',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  windowHeaderDraggable: {
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  windowTitle: {
    color: '#F5F1E8',
    fontSize: 15,
    fontWeight: '800',
  },
  windowSubtitle: {
    color: '#BFB6A9',
    fontSize: 11,
    marginTop: 2,
  },
  windowActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  dragPill: {
    borderWidth: 1,
    borderColor: '#3D3D3D',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: '#1C1C1C',
  },
  dragPillText: {
    color: '#BFB6A9',
    fontSize: 12,
    fontWeight: '700',
  },
  windowActionButton: {
    borderWidth: 1,
    borderColor: '#3D3D3D',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: '#1C1C1C',
  },
  windowActionText: {
    color: '#F5F1E8',
    fontSize: 12,
    fontWeight: '700',
  },
  windowMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E4DDD2',
  },
  windowMetaText: {
    color: '#5D584F',
    fontSize: 12,
    fontWeight: '600',
  },
  modelRow: {
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E4DDD2',
  },
  modelChipRow: {
    gap: 8,
    paddingRight: 10,
  },
  modelChip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    backgroundColor: '#F3EEE4',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  modelChipActive: {
    borderColor: '#111111',
    backgroundColor: '#111111',
  },
  modelChipLoaded: {
    borderColor: '#857B6D',
  },
  modelChipText: {
    color: '#2B2925',
    fontSize: 12,
    fontWeight: '600',
  },
  modelChipTextActive: {
    color: '#F5F1E8',
  },
  modelChipMetaText: {
    color: '#6E675D',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modelChipMetaTextActive: {
    color: '#BFB6A9',
  },
  modelInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  modelInput: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFC8BC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111111',
  },
  loadButton: {
    borderRadius: 16,
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadButtonDisabled: {
    opacity: 0.5,
  },
  loadButtonText: {
    color: '#F5F1E8',
    fontWeight: '700',
  },
  modelMetaText: {
    color: '#625C52',
    fontSize: 12,
  },
  quickPromptRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E4DDD2',
  },
  quickPromptButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    backgroundColor: '#F3EEE4',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  quickPromptText: {
    color: '#2B2925',
    fontSize: 12,
    fontWeight: '600',
  },
  chatScroll: {
    maxHeight: 320,
  },
  chatContent: {
    padding: 14,
    gap: 10,
  },
  chatBubble: {
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  chatBubbleAssistant: {
    borderColor: '#D1CAC0',
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
  },
  chatBubbleUser: {
    borderColor: '#111111',
    backgroundColor: '#F0E8DA',
    borderRadius: 4,
  },
  chatRole: {
    color: '#6B6458',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  chatText: {
    color: '#1F1D19',
    fontSize: 13,
    lineHeight: 19,
  },
  loadingRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: '#C45D4B',
    backgroundColor: '#FFF7F4',
    padding: 10,
    borderRadius: 4,
  },
  errorBoxText: {
    color: '#7B2D21',
    fontSize: 12,
    lineHeight: 18,
  },
  inputWrap: {
    borderTopWidth: 1,
    borderTopColor: '#E4DDD2',
    padding: 12,
    gap: 10,
  },
  inputMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  inputMetaText: {
    color: '#625C52',
    fontSize: 12,
  },
  clearText: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    minHeight: 72,
    maxHeight: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFC8BC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111111',
    textAlignVertical: 'top',
  },
  sendButton: {
    alignSelf: 'flex-end',
    borderRadius: 16,
    backgroundColor: '#111111',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#F5F1E8',
    fontWeight: '700',
  },
  launcherWrap: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    zIndex: 40,
  },
  launcherButton: {
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minWidth: 220,
  },
  launcherTitle: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '800',
  },
  launcherSubtext: {
    color: '#625C52',
    marginTop: 3,
    fontSize: 12,
  },
  minimizedBar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderColor: '#111111',
    backgroundColor: '#FBF8F1',
    borderRadius: 4,
    overflow: 'hidden',
    minWidth: 260,
  },
  minimizedMain: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  minimizedTitle: {
    color: '#111111',
    fontSize: 14,
    fontWeight: '800',
  },
  minimizedSubtext: {
    color: '#625C52',
    marginTop: 2,
    fontSize: 12,
  },
  minimizedClose: {
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderLeftWidth: 1,
    borderLeftColor: '#D1CAC0',
  },
  minimizedAction: {
    color: '#111111',
    fontWeight: '700',
    fontSize: 12,
  },
});