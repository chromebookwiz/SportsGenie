import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
  type WebLlmLoadProgress,
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

type ModelLoadState = {
  visible: boolean;
  progress: number;
  text: string;
  tone: 'idle' | 'loading' | 'ready';
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

const defaultModelLoadState: ModelLoadState = {
  visible: false,
  progress: 0,
  text: '',
  tone: 'idle',
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const getModelStatusLabel = (modelId: string, activeModel: string, loadedModelSet: Set<string>) => {
  if (activeModel === modelId && loadedModelSet.has(modelId)) {
    return 'Active';
  }

  if (loadedModelSet.has(modelId)) {
    return 'Loaded';
  }

  if (activeModel === modelId) {
    return 'Default';
  }

  return 'Available';
};

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
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [modelLoadState, setModelLoadState] = useState<ModelLoadState>(defaultModelLoadState);
  const [activeModel, setActiveModel] = useState(getActiveWebLlmModel());
  const [loadedModels, setLoadedModels] = useState<string[]>(() => getLoadedWebLlmModels());
  const hasPositionRef = useRef(false);
  const lastViewportRef = useRef<{ width: number; height: number } | null>(null);
  const hydratedRef = useRef(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const dragPointerOriginRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);

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
  const availableModelOptions = useMemo(() => {
    const nextOptions = new Set(webLlmModelOptions);
    const trimmedModel = selectedModel.trim();

    if (trimmedModel) {
      nextOptions.add(trimmedModel);
    }

    return Array.from(nextOptions);
  }, [selectedModel]);

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
    const nextViewport = { width, height };
    const maxX = Math.max(8, width - panelWidth - 8);
    const maxY = Math.max(8, height - panelHeight - 8);

    if (!hasPositionRef.current) {
      setPosition({
        x: Math.max(12, width - panelWidth - 18),
        y: Math.max(88, height - panelHeight - 28),
      });
      hasPositionRef.current = true;
      lastViewportRef.current = nextViewport;
      return;
    }

    const previousViewport = lastViewportRef.current;
    lastViewportRef.current = nextViewport;

    if (!previousViewport) {
      setPosition((current) => ({
        x: clamp(current.x, 8, maxX),
        y: clamp(current.y, 8, maxY),
      }));
      return;
    }

    const viewportShrank = width < previousViewport.width || height < previousViewport.height;

    if (!viewportShrank) {
      return;
    }

    setPosition((current) => ({
      x: clamp(current.x, 8, maxX),
      y: clamp(current.y, 8, maxY),
    }));
  }, [height, panelHeight, panelWidth, width]);

  useEffect(() => {
    scrollViewRef.current?.scrollToEnd({ animated: true });
  }, [messages, loading]);

  useEffect(() => {
    if (!canDragWindow || typeof window === 'undefined') {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) {
        return;
      }

      setPosition({
        x: clamp(dragOriginRef.current.x + (event.pageX - dragPointerOriginRef.current.x), 8, Math.max(8, width - panelWidth - 8)),
        y: clamp(dragOriginRef.current.y + (event.pageY - dragPointerOriginRef.current.y), 8, Math.max(8, height - panelHeight - 8)),
      });
    };

    const stopDragging = () => {
      draggingRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    window.addEventListener('pointercancel', stopDragging);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    };
  }, [canDragWindow, height, panelWidth, width]);

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
    setModelLoadState({
      visible: true,
      progress: 0,
      text: 'Starting model download...',
      tone: 'loading',
    });

    try {
      await preloadWebLlmModel(trimmedModel, (progress: WebLlmLoadProgress) => {
        setModelLoadState({
          visible: true,
          progress: progress.progress,
          text: progress.text,
          tone: progress.progress >= 1 ? 'ready' : 'loading',
        });
      });
      setActiveModel(getActiveWebLlmModel());
      setLoadedModels(getLoadedWebLlmModels());
      setIsModelMenuOpen(false);
      setModelLoadState({
        visible: true,
        progress: 1,
        text: 'Model ready',
        tone: 'ready',
      });
    } catch (error) {
      setModelLoadState(defaultModelLoadState);
      setErrorMessage(error instanceof Error ? error.message : 'Model load failed');
    } finally {
      setModelLoading(false);
    }
  };

  const startWindowDrag = (event: any) => {
    if (!canDragWindow) {
      return;
    }

    event.preventDefault?.();
    event.stopPropagation?.();
    dragOriginRef.current = position;
    dragPointerOriginRef.current = {
      x: Number(event?.nativeEvent?.pageX ?? 0),
      y: Number(event?.nativeEvent?.pageY ?? 0),
    };
    draggingRef.current = true;
  };

  const stopHeaderDragEvent = (event: any) => {
    event.stopPropagation?.();
  };

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

    if (!loadedModelSet.has(selectedModel.trim())) {
      setModelLoadState({
        visible: true,
        progress: 0,
        text: 'Starting model download...',
        tone: 'loading',
      });
    }

    try {
      if (!supported) {
        throw new Error('WebLLM advisor is available only on web with EXPO_PUBLIC_ENABLE_WEBLLM=true and WebGPU support.');
      }

      const answer = await askWebLlmAdvisor({
        question: trimmed,
        context,
        history,
        modelId: selectedModel.trim(),
        onModelLoadProgress: (progress: WebLlmLoadProgress) => {
          setModelLoadState({
            visible: true,
            progress: progress.progress,
            text: progress.text,
            tone: progress.progress >= 1 ? 'ready' : 'loading',
          });
        },
      });

      setActiveModel(getActiveWebLlmModel());
      setLoadedModels(getLoadedWebLlmModels());
      setModelLoadState((current) =>
        current.visible
          ? {
              visible: true,
              progress: 1,
              text: 'Model ready',
              tone: 'ready',
            }
          : current
      );

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: answer,
        },
      ]);
    } catch (error) {
      setModelLoadState(defaultModelLoadState);
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
        <View style={[styles.windowHeader, canDragWindow ? styles.windowHeaderDraggable : null]} onPointerDown={canDragWindow ? startWindowDrag : undefined}>
          <View>
            <Text style={styles.windowTitle}>Advisor</Text>
            <Text style={styles.windowSubtitle}>{supported ? 'Local WebLLM with research tools' : 'WebLLM unavailable on this runtime'}</Text>
          </View>
          <View style={styles.windowActions}>
            <Pressable style={styles.windowActionButton} onPointerDown={stopHeaderDragEvent} onPress={() => setWindowState('minimized')}>
              <Text style={styles.windowActionText}>_</Text>
            </Pressable>
            <Pressable style={styles.windowActionButton} onPointerDown={stopHeaderDragEvent} onPress={() => setWindowState('closed')}>
              <Text style={styles.windowActionText}>×</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.windowMetaRow}>
          <Text style={styles.windowMetaText}>{selectedSport === 'All sports' ? 'Full slate' : selectedSport}</Text>
          <Text style={styles.windowMetaText}>{recommendations.length} board candidates</Text>
        </View>

        <View style={styles.modelRow}>
          <View style={styles.modelInputRow}>
            <View style={styles.modelDropdownWrap}>
              <Pressable style={styles.modelDropdownButton} onPress={() => setIsModelMenuOpen((current) => !current)}>
                <View style={styles.modelDropdownTextWrap}>
                  <Text numberOfLines={1} style={styles.modelDropdownLabel}>{selectedModel}</Text>
                  <Text style={styles.modelDropdownMeta}>{getModelStatusLabel(selectedModel, activeModel, loadedModelSet)}</Text>
                </View>
                <Text style={styles.modelDropdownChevron}>{isModelMenuOpen ? '▲' : '▼'}</Text>
              </Pressable>
              {isModelMenuOpen ? (
                <ScrollView style={styles.modelDropdownMenu} nestedScrollEnabled>
                  {availableModelOptions.map((modelId) => (
                    <Pressable
                      key={modelId}
                      style={[
                        styles.modelOption,
                        selectedModel === modelId ? styles.modelOptionActive : null,
                      ]}
                      onPress={() => {
                        setSelectedModel(modelId);
                        setIsModelMenuOpen(false);
                      }}
                    >
                      <Text style={[styles.modelOptionText, selectedModel === modelId ? styles.modelOptionTextActive : null]}>{modelId}</Text>
                      <Text style={[styles.modelOptionMetaText, selectedModel === modelId ? styles.modelOptionMetaTextActive : null]}>
                        {getModelStatusLabel(modelId, activeModel, loadedModelSet)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>
            <Pressable
              style={[styles.loadButton, modelLoading ? styles.loadButtonDisabled : null]}
              onPress={() => void loadSelectedModel()}
            >
              <Text style={styles.loadButtonText}>
                {modelLoading ? 'Loading...' : loadedModelSet.has(selectedModel) ? 'Use loaded model' : 'Load model'}
              </Text>
            </Pressable>
          </View>
          {modelLoadState.visible ? (
            <View style={styles.progressWrap}>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    modelLoadState.tone === 'ready' ? styles.progressFillReady : null,
                    { width: `${Math.max(6, Math.min(100, Math.round(modelLoadState.progress * 100)))}%` },
                  ]}
                />
              </View>
              <View style={styles.progressMetaRow}>
                <Text style={styles.progressText}>{modelLoadState.text}</Text>
                <Text style={styles.progressPercent}>{Math.round(modelLoadState.progress * 100)}%</Text>
              </View>
            </View>
          ) : null}
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
  windowActionButton: {
    borderWidth: 1,
    borderColor: '#3D3D3D',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: '#1C1C1C',
    minWidth: 32,
    alignItems: 'center',
  },
  windowActionText: {
    color: '#F5F1E8',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 16,
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
  modelInputRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  modelDropdownWrap: {
    flex: 1,
    gap: 6,
  },
  modelDropdownButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CFC8BC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  modelDropdownTextWrap: {
    flex: 1,
    gap: 2,
  },
  modelDropdownLabel: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
  },
  modelDropdownMeta: {
    color: '#625C52',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modelDropdownChevron: {
    color: '#625C52',
    fontSize: 11,
    fontWeight: '800',
  },
  modelDropdownMenu: {
    maxHeight: 180,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#D1CAC0',
    backgroundColor: '#FFFFFF',
  },
  modelOption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: '#EEE7DB',
  },
  modelOptionActive: {
    backgroundColor: '#111111',
  },
  modelOptionText: {
    color: '#2B2925',
    fontSize: 12,
    fontWeight: '600',
  },
  modelOptionTextActive: {
    color: '#F5F1E8',
  },
  modelOptionMetaText: {
    color: '#6E675D',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modelOptionMetaTextActive: {
    color: '#BFB6A9',
  },
  loadButton: {
    borderRadius: 16,
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    justifyContent: 'center',
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
  progressWrap: {
    gap: 6,
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E7E0D5',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#111111',
  },
  progressFillReady: {
    backgroundColor: '#365F48',
  },
  progressMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  progressText: {
    flex: 1,
    color: '#625C52',
    fontSize: 12,
  },
  progressPercent: {
    color: '#111111',
    fontSize: 12,
    fontWeight: '700',
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