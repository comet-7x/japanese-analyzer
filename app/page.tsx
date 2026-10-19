'use client';

import { getModelPreferences } from './lib/aiModels';

import { analysisCache, sentenceCacheKey, localCorrectionCache, localCorrectionCacheKey } from './utils/sentenceCache';
import { useReadingPreferences } from './hooks/useReadingPreferences';
import DictionaryLookup from './components/DictionaryLookup';
import ResegmentEditor from './components/ResegmentEditor';
import { useAnalysisEditing } from './hooks/useAnalysisEditing';
import { buildReadingGroups } from './utils/analysisEditing';
import { browserStorage } from './utils/storage';
import { loadSpeechSettings, SPEECH_PRESETS, SPEECH_SETTINGS_KEY, type SpeechSettings } from './lib/speechServices';
import { readTranslationServiceSettings, TRANSLATION_SERVICES_KEY, type TranslationProviderId, type TranslationServiceSettings } from './lib/translationServices';

import { useLanguage } from './contexts/LanguageContext';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import InputSection from './components/InputSection';
import AnalysisResult, { DisplayOptions } from './components/AnalysisResult';
import TranslationSection from './components/TranslationSection';
import SettingsModal from './components/SettingsModal';
import Header from './components/Header';
import { Icon } from './components/Icons';
import LoginModal from './components/LoginModal';
import AIChat from './components/AIChat';
import ReasoningStream from './components/ReasoningStream';
import SelectionDetailPanel from './components/SelectionDetailPanel';
import { useAnalysisHistory } from './hooks/useAnalysisHistory';
import AnalysisProgressView from './components/AnalysisProgressView';
import AnalysisEngineControl from './components/AnalysisEngineControl';
import { analyzeLocally, clearLocalDictionaryCache } from './services/localAnalyzer';
import { createLocalCorrectionSession } from './services/localCorrection';
import type { AnalysisEngine, LocalProgress } from './lib/localAnalyzerTypes';
import type { AnalysisSession, AnalysisProgress } from './utils/analysisSession';
import { selectWordDetailContext } from './utils/wordDetailContext';
import { getPhraseReading, getPhraseText, mergePhraseTokens, normalizePhraseRange, isPunctuationToken, type PhraseRange } from './utils/phraseRange';
import { calculateMoraTimeline, getActiveTokenIndexAtTime, type TokenTimeCue } from './utils/moraTiming';
import { createRequestMetrics, trackAnalyzeUsage, type AnalyzeUsageMetadata } from './utils/analytics';
import {
  createAnalysisSession,
  TokenData,
  loadAISettingsFromStorage,
  saveAISettingsToStorage,
  summarizeReasoningProgress,
  type EndpointPayload,
  type ProviderProfile,
  effectiveCaps,
} from './services/api';
import { ReasoningSummaryController } from './utils/reasoningSummary';
import { ReasoningTextStore } from './utils/reasoningTextStore';

export default function Home() {
  const { t, locale, errorText } = useLanguage();
  const history = useAnalysisHistory();
  const [currentSentence, setCurrentSentence] = useState('');
  const editing = useAnalysisEditing();
  const startAnalysisWorkspace = editing.startWorkspace;
  const analyzedTokens = editing.state.tokens;
  const setAnalyzedTokens = editing.setTokens;
  const resultKind = editing.activeVariant;
  const analysisValidated = editing.variant.validated;
  const analysisSource = { key: editing.variant.sourceKey ?? '', model: editing.variant.model ?? '' };
  const analysisFromCache = editing.variant.fromCache === true;
  const [draft, setDraft] = useState('');
  const [dictionaryDraft, setDictionaryDraft] = useState('');
  const [mode, setMode] = useState<'analyze' | 'dictionary'>('analyze');
  const [editRange, setEditRange] = useState<{ range: PhraseRange; taskId: number; revision: number } | null>(null);
  const handleDraftChange = useCallback((value: string) => {
    setDraft(value); setEditRange(null);
    if (value !== currentSentence) {
      analysisAbortControllerRef.current?.abort('edit');
      const cancelled = analysisSessionRef.current?.session.getSnapshot();
      if (cancelled && activeAnalysisTypeRef.current === 'model') setAnalyzedTokens(cancelled.confirmedTokens);
      analysisAbortControllerRef.current = null;
      analysisSessionRef.current = null;
      setAnalysisProgress(null);
      setLocalProgress(null);
      setIsAnalyzing(false);
    }
  }, [currentSentence, setAnalyzedTokens]);
  const readingGroups = useMemo(() => buildReadingGroups(analyzedTokens, editing.state.groups), [analyzedTokens, editing.state.groups]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const analysisSessionRef = useRef<{ session: AnalysisSession; retry: () => Promise<void> } | null>(null);
  const [analysisEngine, setAnalysisEngine] = useState<AnalysisEngine>('model');
  const [localProgress, setLocalProgress] = useState<LocalProgress | null>(null);
  const [localNotice, setLocalNotice] = useState('');
  const [localNoticeIsError, setLocalNoticeIsError] = useState(false);
  const activeAnalysisTypeRef = useRef<'model' | 'local' | 'correction'>('model');
  const [editNotice, setEditNotice] = useState('');
  const activeAnalysisKeyRef = useRef('');

  const [analysisSignal, setAnalysisSignal] = useState<AbortSignal>();
  const [translationTrigger, setTranslationTrigger] = useState(0);
  // 解析开始后输入区收起，句子成为页面唯一主角；点「编辑原文」再展开
  const [isEditingInput, setIsEditingInput] = useState(true);
  // 圈选的多词短语（与单个选中的词互斥）
  const [selectedRange, setSelectedRange] = useState<PhraseRange | null>(null);
  // 圈选起点：长按或详情里点「选中多个词」后设置，再点一个词即选中这一段
  const [pickAnchor, setPickAnchor] = useState<number | null>(null);

  // API设置相关状态
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [services, setServices] = useState<ProviderProfile[]>([]);
  const [activeServiceId, setActiveServiceId] = useState('');
  const [activeModelId, setActiveModelId] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const activeService = useMemo(
    () => services.find((service) => service.id === activeServiceId) ?? services[0] ?? null,
    [services, activeServiceId]
  );
  const activeModel = useMemo(
    () => activeService?.models.find((model) => model.id === activeModelId) ?? activeService?.models[0] ?? null,
    [activeService, activeModelId]
  );
  const { stream: useStream, thinkingEnabled } = getModelPreferences(activeModel);
  const endpoint: EndpointPayload = useMemo(
    () => activeService && activeModel
      ? { baseUrl: activeService.baseUrl, model: activeModel.model, caps: effectiveCaps(activeService, activeModel) }
      : { baseUrl: '', model: '' },
    [activeService, activeModel]
  );
  const [hasDeepseekReasoning, setHasDeepseekReasoning] = useState(false);
  const hasDeepseekReasoningRef = useRef(false);
  const reasoningTextStoreRef = useRef<ReasoningTextStore | null>(null);
  if (reasoningTextStoreRef.current === null) {
    reasoningTextStoreRef.current = new ReasoningTextStore();
  }
  const reasoningTextStore = reasoningTextStoreRef.current;
  const [deepseekReasoningDone, setDeepseekReasoningDone] = useState(true);
  const [deepseekReasoningSummaryHistory, setDeepseekReasoningSummaryHistory] = useState<string[]>([]);
  const [deepseekReasoningCompletionLabel, setDeepseekReasoningCompletionLabel] = useState(t("已深度思考"));
  const reasoningSummaryControllerRef = useRef<ReasoningSummaryController | null>(null);
  const analysisAbortControllerRef = useRef<AbortController | null>(null);
  const [speechSettings, setSpeechSettings] = useState<SpeechSettings>({ services: [{ ...SPEECH_PRESETS[0] }, { ...SPEECH_PRESETS[1] }], activeId: 'edge' });
  const [translationSettings, setTranslationSettings] = useState<TranslationServiceSettings>(() => {
    return readTranslationServiceSettings(null);
  });
  const activeSpeechService = speechSettings.services.find((service) => service.id === speechSettings.activeId) ?? speechSettings.services[0];

  // 密码验证相关状态
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authError, setAuthError] = useState('');

  const userApiKey = activeService?.apiKey || '';
  const analysisConfigKey = sentenceCacheKey('', endpoint, locale, userApiKey, thinkingEnabled);
  const learningModel = useMemo(() => ({ endpoint, apiKey: userApiKey }), [endpoint, userApiKey]);
  const { preferences, change: changePreference } = useReadingPreferences();
  const { showFurigana, showRomaji, viewMode } = preferences;
  const setShowFurigana = (value: boolean) => changePreference('showFurigana', value);
  const setShowRomaji = (value: boolean) => changePreference('showRomaji', value);
  const setViewMode = (value: 'lexical' | 'reading') => changePreference('viewMode', value);
  useEffect(() => { setEditRange(null); }, [locale, endpoint, editing.state.taskId, editing.state.revision]);

  // 选中词汇（右侧详情面板 / 移动端模态）
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isDesktop, setIsDesktop] = useState(true);

  // 语音播放与单词高亮联动状态
  const [playingTokenIndex, setPlayingTokenIndex] = useState<number | null>(null);
  const playingTokenIndexRef = useRef<number | null>(null);
  const playbackCuesRef = useRef<{ sentence: string; duration: number; cues: TokenTimeCue[] } | null>(null);
  const officialPlaybackCuesRef = useRef<{ sentence: string; cues: TokenTimeCue[] } | null>(null);

  const handleAudioCuesReady = useCallback((cues: TokenTimeCue[] | null) => {
    if (cues && cues.length > 0) {
      officialPlaybackCuesRef.current = { sentence: currentSentence, cues };
    } else {
      officialPlaybackCuesRef.current = null;
    }
  }, [currentSentence]);

  const handleAudioPlaybackUpdate = useCallback((state: { currentTime: number; duration: number } | null) => {
    if (!state || state.currentTime <= 0 || state.duration <= 0 || !currentSentence || analyzedTokens.length === 0) {
      if (playingTokenIndexRef.current !== null) {
        playingTokenIndexRef.current = null;
        setPlayingTokenIndex(null);
      }
      return;
    }

    let cues: TokenTimeCue[];
    // 优先使用官方真实 WordBoundary 毫秒级时间轴（方案 B）
    if (officialPlaybackCuesRef.current && officialPlaybackCuesRef.current.sentence === currentSentence) {
      cues = officialPlaybackCuesRef.current.cues;
    } else {
      // 无官方时间戳时使用方案 A（基于日语韵律声学的动力学时间轴）
      if (!playbackCuesRef.current || playbackCuesRef.current.sentence !== currentSentence || Math.abs(playbackCuesRef.current.duration - state.duration) > 0.05) {
        cues = calculateMoraTimeline(analyzedTokens, state.duration);
        playbackCuesRef.current = { sentence: currentSentence, duration: state.duration, cues };
      } else {
        cues = playbackCuesRef.current.cues;
      }
    }

    const index = getActiveTokenIndexAtTime(cues, state.currentTime);
    const target = index >= 0 ? index : null;
    if (playingTokenIndexRef.current !== target) {
      playingTokenIndexRef.current = target;
      setPlayingTokenIndex(target);
    }
  }, [currentSentence, analyzedTokens]);
  useEffect(() => {
    analysisAbortControllerRef.current?.abort('language-change');
    const cancelled = analysisSessionRef.current?.session.getSnapshot();
    if (cancelled && cancelled.status !== 'complete' && activeAnalysisTypeRef.current === 'model') setAnalyzedTokens(cancelled.confirmedTokens);
    analysisAbortControllerRef.current = null;
    analysisSessionRef.current = null;
    setAnalysisProgress(null);
    setLocalProgress(null);
    reasoningSummaryControllerRef.current?.cancel();
    setIsAnalyzing(false);
    setAnalysisError('');
    setAuthError('');
    setSelectedIndex(null);
    setSelectedRange(null);
    setPickAnchor(null);
    officialPlaybackCuesRef.current = null;
    reasoningTextStore.reset();
    hasDeepseekReasoningRef.current = false;
    setHasDeepseekReasoning(false);
    setDeepseekReasoningDone(true);
    setDeepseekReasoningSummaryHistory([]);
  }, [analysisConfigKey, reasoningTextStore, setAnalyzedTokens]);

  useEffect(() => {
    if (!currentSentence || !activeModel || analysisEngine !== 'model' || resultKind !== 'model') return;
    const key = sentenceCacheKey(currentSentence, endpoint, locale, userApiKey, thinkingEnabled);
    if (activeAnalysisKeyRef.current === key) return;
    const cached = analysisCache.get(key);
    if (!cached) return;
    activeAnalysisKeyRef.current = key;
    startAnalysisWorkspace(currentSentence, 'model', cached, { status: 'complete', validated: true, sourceKey: key, model: endpoint.model, fromCache: true });
    setEditNotice('');
  }, [analysisConfigKey, currentSentence, activeModel, endpoint, locale, userApiKey, thinkingEnabled, startAnalysisWorkspace, analysisEngine, resultKind]);

  // 侧栏在 lg(1024px) 以上显示，以下使用模态
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // 桌面端全局外链拦截与图片拖放默认行为阻止（防止 WebView 导航至 file:// 覆盖应用）
  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown }).__TAURI__ || (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

    const handleExternalLinkClick = (event: MouseEvent) => {
      if (!isTauri) return;
      const anchor = (event.target as HTMLElement)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href) return;
      if (/^https?:\/\//i.test(href)) {
        try {
          const url = new URL(href, window.location.href);
          if (url.origin !== window.location.origin) {
            event.preventDefault();
            // 在桌面端触发导航，由 Rust 端 on_navigation 统一拦截并调用系统默认浏览器打开
            window.location.href = url.href;
          }
        } catch {}
      }
    };

    const preventFileDropNavigation = (event: DragEvent) => {
      // 阻止浏览器默认将拖入的文件作为页面打开的行为
      event.preventDefault();
    };

    document.addEventListener('click', handleExternalLinkClick);
    window.addEventListener('dragover', preventFileDropNavigation);
    window.addEventListener('drop', preventFileDropNavigation);
    return () => {
      document.removeEventListener('click', handleExternalLinkClick);
      window.removeEventListener('dragover', preventFileDropNavigation);
      window.removeEventListener('drop', preventFileDropNavigation);
    };
  }, []);

  useEffect(() => () => {
    analysisAbortControllerRef.current?.abort('unmount');
    reasoningSummaryControllerRef.current?.cancel();
  }, []);

  // 检查是否需要密码验证
  useEffect(() => {
    const checkAuthRequirement = async () => {
      try {
        const response = await fetch('/api/auth');
        if (!response.ok) throw new Error('Authentication check failed');
        const data = await response.json();
        if (typeof data.requiresAuth !== 'boolean' || typeof data.authenticated !== 'boolean') throw new Error('Invalid authentication state');
        setRequiresAuth(data.requiresAuth);

        if (!data.requiresAuth || data.authenticated) {
          setIsAuthenticated(true);
          return;
        }

        browserStorage.removeItem('isAuthenticated');
        setIsAuthenticated(false);
      } catch (error) {
        console.error('检查认证状态失败:', error);
        // Fail closed, with the login form available for retry.
        setRequiresAuth(true);
        setIsAuthenticated(false);
      }
    };

    checkAuthRequirement();
  }, []);

  // 从本地存储加载用户API设置
  useEffect(() => {
    // Remove retired HTTP dictionary settings, including stored credentials.
    browserStorage.removeItem('japaneseAnalyzer:dictionary:v1');
    const storedAISettings = loadAISettingsFromStorage(browserStorage);

    setServices(storedAISettings.services);
    setActiveServiceId(storedAISettings.activeServiceId);
    setActiveModelId(storedAISettings.activeModelId);
    setGeminiApiKey(storedAISettings.geminiApiKey);
    setAnalysisEngine(browserStorage.getItem('japaneseAnalyzer:analysisEngine') === 'local' ? 'local' : 'model');
    setSpeechSettings(loadSpeechSettings(browserStorage));
    const storedTranslation = browserStorage.getItem(TRANSLATION_SERVICES_KEY);
    if (storedTranslation) {
      setTranslationSettings(readTranslationServiceSettings(storedTranslation));
    } else {
      setTranslationSettings(readTranslationServiceSettings(null));
    }

  }, []);

  // 切换模型 / 保存设置后都要清掉的解析与思考状态
  const resetAnalysisState = () => {
    analysisAbortControllerRef.current?.abort('settings-change');
    const cancelled = analysisSessionRef.current?.session.getSnapshot();
    if (cancelled && cancelled.status !== 'complete' && activeAnalysisTypeRef.current === 'model') setAnalyzedTokens(cancelled.confirmedTokens);
    analysisAbortControllerRef.current = null;
    analysisSessionRef.current = null;
    setAnalysisProgress(null);
    setLocalProgress(null);
    setIsAnalyzing(false);
    reasoningTextStore.reset();
    hasDeepseekReasoningRef.current = false;
    setHasDeepseekReasoning(false);
    setDeepseekReasoningDone(true);
    setDeepseekReasoningSummaryHistory([]);
    setDeepseekReasoningCompletionLabel(t("已深度思考"));
    reasoningSummaryControllerRef.current?.cancel();
    reasoningSummaryControllerRef.current = null;
  };

  // 保存用户API设置
  const handleSaveSettings = (settings: {
    translationSettings: TranslationServiceSettings;
    services: ProviderProfile[];
    activeServiceId: string;
    activeModelId: string;
    geminiApiKey: string;
    speechSettings: SpeechSettings;
  }) => {
    setTranslationSettings(settings.translationSettings);
    browserStorage.setItem(TRANSLATION_SERVICES_KEY, JSON.stringify(settings.translationSettings));
    saveAISettingsToStorage(browserStorage, {
      services: settings.services,
      activeServiceId: settings.activeServiceId,
      activeModelId: settings.activeModelId,
      geminiApiKey: settings.geminiApiKey,
    });
    browserStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(settings.speechSettings));
    setSpeechSettings(settings.speechSettings);

    setServices(settings.services);
    setActiveServiceId(settings.activeServiceId);
    setActiveModelId(settings.activeModelId);
    setGeminiApiKey(settings.geminiApiKey);
    resetAnalysisState();
  };

  // 顶栏快捷切换当前模型：更新选中项并立即持久化
  const handleSelectModel = (serviceId: string, modelId: string) => {
    setActiveServiceId(serviceId);
    setActiveModelId(modelId);
    saveAISettingsToStorage(browserStorage, {
      services,
      activeServiceId: serviceId,
      activeModelId: modelId,
      geminiApiKey,
    });
    resetAnalysisState();
  };

  const handleSpeechServiceChange = (activeId: string, voice?: string) => {
    const next = { services: voice?.trim() ? speechSettings.services.map((service) => service.id === activeId ? { ...service, voice: voice.trim() } : service) : speechSettings.services, activeId };
    setSpeechSettings(next);
    browserStorage.setItem(SPEECH_SETTINGS_KEY, JSON.stringify(next));
  };

  // 处理密码验证
  const handleLogin = async (password: string) => {
    try {
      setAuthError('');
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setIsAuthenticated(true);
        browserStorage.removeItem('isAuthenticated');
      } else {
        setAuthError(errorText(data.message || "验证失败"));
      }
    } catch (error) {
      console.error('验证过程中出错:', error);
      setAuthError(t("验证过程中发生错误，请重试"));
    }
  };

  // 添加函数，检查是否显示分析器
  const shouldShowAnalyzer = (): boolean => analyzedTokens.length > 0;

  const handleCloseWordDetail = useCallback(() => {
    setSelectedIndex(null);
    setSelectedRange(null);
    setPickAnchor(null);
  }, []);

  // 点击词汇 → 查询详情
  const handleWordClick = useCallback((_token: TokenData, index: number) => {
    if (selectedIndex === index) {
      handleCloseWordDetail();
      return;
    }
    setSelectedRange(null);
    setSelectedIndex(index);
  }, [selectedIndex, handleCloseWordDetail]);

  // 圈选多个词：拖动 / Shift 点击 / 手机长按后再点
  const handleRangeSelect = useCallback((a: number, b: number) => {
    // 不论用哪种方式完成圈选，都退出「再点一个词」的状态
    setPickAnchor(null);
    const range = normalizePhraseRange(analyzedTokens, a, b);
    if (!range) return;
    setSelectedIndex(null);
    setSelectedRange(range);
  }, [analyzedTokens]);

  // 详情里的「选中多个词」：以当前词为起点进入圈选。手机上先收起弹窗，露出句子
  const handleStartPick = useCallback(() => {
    if (selectedIndex === null) return;
    const anchor = selectedIndex;
    if (!isDesktop) handleCloseWordDetail();
    setPickAnchor(anchor);
  }, [handleCloseWordDetail, isDesktop, selectedIndex]);

  // AI 判断圈选的其实是一个被拆开的词时，合并回单个词项（只影响当前结果）
  const canMergePhrase = analysisValidated && analyzedTokens.map(token => token.word).join('') === currentSentence && !isAnalyzing && selectedRange !== null;
  const handleMergePhrase = useCallback((analysis: { pos: string; furigana: string }) => {
    if (!selectedRange) return;
    const replacements = mergePhraseTokens(analyzedTokens.slice(selectedRange.start, selectedRange.end + 1), { start: 0, end: selectedRange.end - selectedRange.start }, {
      pos: analysis.pos, furigana: analysis.furigana,
    });
    editing.edit(selectedRange, replacements, editing.state.taskId, editing.state.revision);
    handleCloseWordDetail();
  }, [selectedRange, analyzedTokens, editing, handleCloseWordDetail]);

  const handleLocalAnalyze = async (text: string) => {
    resetAnalysisState(); handleCloseWordDetail(); setEditRange(null);
    const controller = new AbortController();
    analysisAbortControllerRef.current = controller;
    activeAnalysisTypeRef.current = 'local';
    setAnalysisSignal(controller.signal);
    const current = () => analysisAbortControllerRef.current === controller && !controller.signal.aborted;
    activeAnalysisKeyRef.current = '';
    setLocalNotice(''); setEditNotice('');
    setDraft(text); setCurrentSentence(text);
    setTranslationTrigger(value => value + 1);
    editing.startWorkspace(text, 'local', [], { status: 'running', validated: false, model: 'Sudachi', fromCache: false });
    setIsAnalyzing(true); setIsEditingInput(false); setAnalysisError('');
    try {
      const tokens = await analyzeLocally(text, { signal: controller.signal,
        onProgress: progress => { if (current()) setLocalProgress(progress); },
        onPartial: tokens => { if (current()) editing.setVariantTokens('local', tokens); },
      });
      if (!current()) return;
      editing.setVariantTokens('local', tokens, true);
      editing.updateVariant('local', { status: 'complete', validated: true, model: 'Sudachi' }); history.record(text);
      const correctionKey = localCorrectionCacheKey(text, endpoint, locale, userApiKey, thinkingEnabled);
      const cachedCorrection = localCorrectionCache.get(correctionKey);
      if (cachedCorrection && cachedCorrection.length > 0) {
        editing.startVariant('local-corrected', cachedCorrection, { status: 'complete', validated: true, model: endpoint.model, fromCache: true }, true);
      }
    } catch (error) {
      if (current()) setAnalysisError(error instanceof Error ? error.message : '本地解析失败，请重试或切换模型解析。');
    } finally {
      if (current()) { setIsAnalyzing(false); setLocalProgress(null); analysisAbortControllerRef.current = null; }
    }
  };

  const handleCorrectLocal = async () => {
    const local = editing.variants.local;
    if (isAnalyzing || !local?.validated) return;
    if (!activeService || !activeModel) { setAnalysisError(t('请先在设置中配置模型服务')); setIsSettingsModalOpen(true); return; }
    resetAnalysisState(); handleCloseWordDetail(); setEditRange(null);
    const controller = new AbortController();
    analysisAbortControllerRef.current = controller;
    activeAnalysisTypeRef.current = 'correction';
    const frozenTokens = local.editing.tokens;
    const { taskId, revision } = local.editing;
    editing.startVariant('local-corrected', frozenTokens, { status: 'running', validated: false, sourceRevision: revision, model: endpoint.model, progress: null }, true);
    const current = () => analysisAbortControllerRef.current === controller && !controller.signal.aborted
      && editing.workspaceRef.current.variants.local?.editing.taskId === taskId
      && editing.workspaceRef.current.variants.local?.editing.revision === revision;
    setIsAnalyzing(true); setAnalysisError('');
    const finish = (result: AnalysisProgress) => {
      if (!current()) return;
      setIsAnalyzing(false);
      if (result.status === 'complete') {
        editing.setVariantTokens('local-corrected', result.confirmedTokens, true);
        editing.updateVariant('local-corrected', { status: 'complete', validated: true, model: endpoint.model, progress: null, sourceRevision: revision });
        const correctionKey = localCorrectionCacheKey(currentSentence, endpoint, locale, userApiKey, thinkingEnabled);
        localCorrectionCache.set(correctionKey, result.confirmedTokens);
        setAnalysisProgress(null);
        analysisAbortControllerRef.current = null; analysisSessionRef.current = null;
      } else if (result.status === 'failed') {
        editing.setVariantTokens('local-corrected', result.confirmedTokens, true);
        editing.updateVariant('local-corrected', { status: 'incomplete', validated: false, model: endpoint.model, progress: result, sourceRevision: revision });
        const error = result.chunks.find(chunk => chunk.error)?.error;
        setAnalysisError(t('模型校正未完成，已保留原有分词：{0}', errorText(error?.message ?? '未知错误')));
      }
    };
    try {
      const session = createLocalCorrectionSession(currentSentence, frozenTokens, learningModel, {
        signal: controller.signal, thinkingEnabled,
        onProgress: progress => { if (current()) { setAnalysisProgress(progress); editing.updateVariant('local-corrected', { progress, status: progress.status === 'failed' ? 'incomplete' : 'running' }); if (progress.confirmedTokens.length) editing.setVariantTokens('local-corrected', progress.confirmedTokens); } },
      });
      analysisSessionRef.current = { session, retry: async () => {
        if (!current()) return;
        setIsAnalyzing(true); setAnalysisError(''); finish(await session.retryFailed());
      } };
      finish(await session.run());
    } catch (error) {
      if (current()) { setIsAnalyzing(false); setAnalysisError(error instanceof Error ? error.message : '模型校正失败，请重试。'); }
    }
  };

  const handleAnalyze = async (text: string, usage?: AnalyzeUsageMetadata, force = false) => {
    if (!text.trim()) return;

    if (analysisEngine === 'local') { await handleLocalAnalyze(text); return; }

    if (!activeService || !activeModel) {
      setAnalysisError(t("请先在设置中配置模型服务"));
      setIsSettingsModalOpen(true);
      return;
    }

    const cacheKey = sentenceCacheKey(text, endpoint, locale, userApiKey, thinkingEnabled);
    setLocalProgress(null); activeAnalysisTypeRef.current = 'model';
    const cached = force ? undefined : analysisCache.get(cacheKey);
    if (cached) {
      analysisAbortControllerRef.current?.abort('cache-hit');
      analysisAbortControllerRef.current = null;
      resetAnalysisState();
      handleCloseWordDetail();
      setEditRange(null);
      setIsAnalyzing(false);
      setIsEditingInput(false);
      setAnalysisError('');
      setDraft(text);
      setCurrentSentence(text);
      setTranslationTrigger(value => value + 1);
      editing.startWorkspace(text, 'model', cached, { status: 'complete', validated: true, sourceKey: cacheKey, model: endpoint.model, fromCache: true });
      activeAnalysisKeyRef.current = cacheKey;
      setEditNotice('');
      history.record(text);
      return;
    }
    activeAnalysisKeyRef.current = cacheKey;
    editing.startWorkspace(text, 'model', [], { status: 'running', validated: false, sourceKey: cacheKey, model: endpoint.model, fromCache: false });
    setEditNotice('');
    analysisAbortControllerRef.current?.abort('superseded');
    const analysisAbortController = new AbortController();
    analysisAbortControllerRef.current = analysisAbortController;
    setAnalysisSignal(analysisAbortController.signal);
    analysisSessionRef.current = null;
    setAnalysisProgress(null);
    const isCurrentAnalysis = () => (
      analysisAbortControllerRef.current === analysisAbortController
      && !analysisAbortController.signal.aborted
    );

    const providerName = activeService?.id ?? '';
    trackAnalyzeUsage(providerName, usage, endpoint.model);
    let metrics = createRequestMetrics('analyze', providerName, endpoint.model, useStream, analysisAbortController.signal);
    setIsAnalyzing(true);
    setIsEditingInput(false);
    setAnalysisError('');
    setDraft(text);
    setCurrentSentence(text);
    setTranslationTrigger(value => value + 1);
    const deepseekThinkingActive = !!activeModel?.caps?.thinking && thinkingEnabled;
    reasoningTextStore.reset();
    hasDeepseekReasoningRef.current = false;
    setHasDeepseekReasoning(false);
    setDeepseekReasoningDone(!deepseekThinkingActive);
    setDeepseekReasoningSummaryHistory([]);
    setDeepseekReasoningCompletionLabel(t("已深度思考"));
    reasoningSummaryControllerRef.current?.cancel();
    const reasoningSummaryController = deepseekThinkingActive
      ? new ReasoningSummaryController({
          requestSummary: ({ reasoningSnippet, signal }) => (
            summarizeReasoningProgress({
              reasoningSnippet,
              endpoint,
              userApiKey,
              signal,
            })
          ),
          onSummary: (summary) => {
            if (!isCurrentAnalysis()) return;
            setDeepseekReasoningSummaryHistory((current) => [...current, summary]);
          },
          onError: (error) => {
            console.warn('DeepSeek reasoning summary skipped:', error);
          },
        })
      : null;
    reasoningSummaryControllerRef.current = reasoningSummaryController;
    if (reasoningSummaryController) {
      reasoningSummaryController.start();
    }
    let reasoningStatusEnded = !deepseekThinkingActive;
    const finishReasoningStatus = (summary: string) => {
      if (!isCurrentAnalysis() || reasoningStatusEnded || !deepseekThinkingActive) return;
      reasoningStatusEnded = true;
      reasoningSummaryController?.finish();
      if (reasoningSummaryControllerRef.current !== reasoningSummaryController) return;
      setDeepseekReasoningCompletionLabel(summary);
      setDeepseekReasoningDone(true);
    };
    handleCloseWordDetail();

    const reasoningOptions = {
      thinkingEnabled: deepseekThinkingActive,
      signal: analysisAbortController.signal,
      onReasoning: (reasoningText: string) => {
        if (!isCurrentAnalysis()) return;
        if (!reasoningStatusEnded) {
          reasoningSummaryController?.ingest(reasoningText);
        }
        reasoningTextStore.setText(reasoningText);
        if (reasoningText && !hasDeepseekReasoningRef.current) {
          hasDeepseekReasoningRef.current = true;
          setHasDeepseekReasoning(true);
        }
      },
      onContentStart: () => {
        if (isCurrentAnalysis()) finishReasoningStatus(t("已深度思考"));
      },
    };

    let previousTokens = '[]';
    const session = createAnalysisSession(text, userApiKey, endpoint, {
      ...reasoningOptions, stream: useStream,
      onProgress: progress => {
        if (!isCurrentAnalysis()) return;
        setAnalysisProgress(progress);
        const serialized = JSON.stringify(progress.tokens);
        if (serialized !== previousTokens) {
          previousTokens = serialized;
          if (progress.tokens.length) metrics.firstResult();
          editing.setVariantTokens('model', progress.tokens);
          handleCloseWordDetail();
        }
      },
    });
    const finish = (result: AnalysisProgress) => {
      if (!isCurrentAnalysis()) return;
      setIsAnalyzing(false);
      finishReasoningStatus(t(result.status === 'complete' ? '已深度思考' : '深度思考已中止'));
      if (result.status === 'complete') {
        editing.setVariantTokens('model', result.confirmedTokens, true);
        editing.updateVariant('model', { status: 'complete', validated: true, sourceKey: cacheKey, model: endpoint.model });
        metrics.firstResult();
        analysisCache.set(cacheKey, result.confirmedTokens);
        metrics.succeed();
        history.record(text);
        analysisAbortControllerRef.current = null;
      } else if (result.status === 'failed') {
        editing.updateVariant('model', { status: 'failed', validated: false, progress: result });
        const error = result.chunks.find(chunk => chunk.error)?.error ?? new Error(t('未知错误'));
        metrics.fail(error);
        setAnalysisError(error.message);
      }
    };
    analysisSessionRef.current = { session, retry: async () => {
      if (!isCurrentAnalysis()) return;
      setIsAnalyzing(true);
      setAnalysisError('');
      handleCloseWordDetail();
      metrics = createRequestMetrics('analyze', providerName, endpoint.model, useStream, analysisAbortController.signal);
      finish(await session.retryFailed());
    } };
    finish(await session.run());
  };

  const handleCancelAnalysis = () => {
    const controller = analysisAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;

    analysisAbortControllerRef.current = null;
    controller.abort('user');
    const cancelled = analysisSessionRef.current?.session.getSnapshot();
    if (cancelled) { setAnalysisProgress(cancelled); if (activeAnalysisTypeRef.current === 'model') editing.setVariantTokens('model', cancelled.confirmedTokens); }
    setLocalProgress(null);
    analysisSessionRef.current = null;
    handleCloseWordDetail();
    reasoningSummaryControllerRef.current?.cancel();
    reasoningSummaryControllerRef.current = null;
    setIsAnalyzing(false);
    setAnalysisError('');
    setDeepseekReasoningCompletionLabel(t("已终止思考"));
    setDeepseekReasoningDone(true);
  };

  const analysisIncomplete = !!currentSentence && (!analysisValidated || analyzedTokens.map(token => token.word).join('') !== currentSentence);
  const editingLocked = isAnalyzing || analysisIncomplete;
  const isReading = !isEditingInput && (isAnalyzing || analyzedTokens.length > 0 || analysisProgress !== null);
  // 解析中：原句里还没解析到的部分，以灰字流光占住结果位置
  const pendingText = (() => {
    if (!isAnalyzing && !analysisIncomplete) return '';
    const analyzed = analyzedTokens.map((token) => token.word).join('');
    return currentSentence.startsWith(analyzed) ? currentSentence.slice(analyzed.length) : '';
  })();
  // 首页：还没有解析任何句子，显示今日一句和最近记录
  const isHome = !isAnalyzing && !currentSentence;

  // 「新句子」：清空当前解析，回到首页
  const handleStartOver = () => {
    analysisSessionRef.current = null;
    setAnalysisProgress(null);
    setLocalProgress(null); setLocalNotice('');
    analysisAbortControllerRef.current?.abort();
    analysisAbortControllerRef.current = null;
    setIsAnalyzing(false);
    handleCloseWordDetail();
    reasoningSummaryControllerRef.current?.cancel();
    reasoningSummaryControllerRef.current = null;
    reasoningTextStore.reset();
    hasDeepseekReasoningRef.current = false;
    setHasDeepseekReasoning(false);
    setDeepseekReasoningDone(true);
    setDeepseekReasoningSummaryHistory([]);
    editing.clearWorkspace();
    setDraft('');
    setDictionaryDraft('');
    setCurrentSentence('');
    activeAnalysisKeyRef.current = '';
    setEditNotice('');
    setAnalysisError('');
    setIsEditingInput(true);
  };

  const hasWordDetail = mode === 'analyze' && (selectedIndex !== null || selectedRange !== null);

  const detailRange = selectedRange ?? (selectedIndex === null ? null : { start: selectedIndex, end: selectedIndex });
  const detailWord = detailRange ? getPhraseText(analyzedTokens, detailRange) : '';
  const detailContext = detailRange ? selectWordDetailContext(currentSentence, analyzedTokens, detailRange.start) : '';
  const detailReading = detailRange ? getPhraseReading(analyzedTokens, detailRange) : '';
  const canEdit = !!detailRange && !editingLocked && [...detailWord].length <= 120;
  const canGroup = !!detailRange && analyzedTokens.slice(detailRange.start, detailRange.end + 1).every(token => !isPunctuationToken(token) && !/\s/.test(token.word));
  const analysisUsesPreviousSettings = resultKind === 'model' && analysisSource.key !== sentenceCacheKey(currentSentence, endpoint, locale, userApiKey, thinkingEnabled);
  const localVariant = editing.variants.local;
  const correctedVariant = editing.variants['local-corrected'];
  const correctedStale = !!localVariant && !!correctedVariant && correctedVariant.sourceRevision !== localVariant.editing.revision;
  const detailTokens = detailRange ? analyzedTokens.slice(detailRange.start, detailRange.end + 1) : [];
  const wordDetailPanel = detailRange ? <SelectionDetailPanel
    selectedText={detailWord} pos={selectedRange ? '' : detailTokens[0]?.pos ?? ''} reading={detailReading}
    context={detailContext} tokens={detailTokens} selectionKind={selectedRange ? 'phrase' : 'word'}
    identity={`${editing.state.taskId}:${editing.state.revision}:${detailRange.start}:${detailRange.end}`}
    model={learningModel} onClose={handleCloseWordDetail}
    onMerge={canMergePhrase ? handleMergePhrase : undefined} onSelectMore={selectedIndex !== null ? handleStartPick : undefined}
    onEdit={() => { setEditRange({ range: detailRange, taskId: editing.state.taskId, revision: editing.state.revision }); handleCloseWordDetail(); }}
    onGroup={selectedRange ? () => { editing.group(selectedRange); handleCloseWordDetail(); } : undefined}
    onUngroup={selectedRange ? () => { editing.ungroup(selectedRange); handleCloseWordDetail(); } : undefined}
    canEdit={canEdit} canGroup={!editingLocked && canGroup} hideClose={!isDesktop}
  /> : null;

  // 如果需要认证但未认证，只显示登录界面
  if (requiresAuth && !isAuthenticated) {
    return (
      <>
        <div className="flex min-h-screen flex-col items-center justify-center p-4 transition-colors duration-200">
          <div className="mb-8 text-center">
            <h1 className="mb-3 text-3xl font-semibold tracking-wide" style={{ color: 'var(--ink)' }}>
              {t("日本語文章解析")}
            </h1>
            <p className="text-base" style={{ color: 'var(--ink-3)' }}>
              {t("AI驱动・深入理解日语句子结构与词义")}
            </p>
          </div>
        </div>
        <LoginModal
          isOpen={true}
          onLogin={handleLogin}
          error={authError}
        />
      </>
    );
  }

  return (
    <>
      <div className="flex min-h-screen flex-col">
        <Header
          thinking={isAnalyzing}
          services={services}
          activeServiceId={activeService?.id ?? ''}
          activeModelId={activeModel?.id ?? ''}
          onSelectModel={handleSelectModel}
          onSettingsClick={() => setIsSettingsModalOpen(true)}
        />

        {/* 阅读列居中；点词后详情栏从右侧展开，主列随之左移。 */}
        <main
          className="app-main mx-auto flex w-full max-w-[1240px] flex-1 items-start justify-center px-4 pb-6 pt-2 sm:px-9"
          data-detail-open={isDesktop && hasWordDetail}
        >
          {/* 主列 */}
          <div className="app-column relative flex w-full min-w-0 max-w-[780px] flex-col gap-[22px]" data-home={isHome}>
            <nav className="learning-actions" aria-label={t('功能模式')}>
              <button className="display-chip" aria-pressed={mode === 'analyze'} onClick={() => { setMode('analyze'); handleCloseWordDetail(); }}>{t('句子解析')}</button>
              <button className="display-chip" aria-pressed={mode === 'dictionary'} disabled={isAnalyzing} onClick={() => { if (!currentSentence && !dictionaryDraft) setDictionaryDraft(draft); setMode('dictionary'); setEditRange(null); handleCloseWordDetail(); }}>{t('查词')}</button>
            </nav>
            <div className={mode === 'dictionary' ? undefined : 'hidden'}>
              <DictionaryLookup
                draft={dictionaryDraft}
                onDraftChange={setDictionaryDraft}
                model={learningModel}
                active={mode === 'dictionary'}
                sentence={currentSentence}
                tokens={isAnalyzing ? [] : analyzedTokens}
                analysisId={editing.state.taskId}
                onGoToAnalyze={text => {
                  setDraft(text);
                  setDictionaryDraft(text);
                  setMode('analyze');
                  setEditRange(null);
                  handleCloseWordDetail();
                }}
              />
            </div>
            {/* Keep completed output and pending translation mounted when visiting dictionary mode. */}
            <div className={mode === 'analyze' ? 'flex flex-col gap-[22px]' : 'hidden'}>
            <AnalysisEngineControl value={analysisEngine} disabled={isAnalyzing} onChange={value => {
              resetAnalysisState();
              setAnalysisEngine(value);
              setLocalNotice('');
              browserStorage.setItem('japaneseAnalyzer:analysisEngine', value);
              handleCloseWordDetail();
              setEditRange(null);

              const text = currentSentence || draft;
              if (!text.trim()) return;

              if (value === 'local') {
                if (editing.variants.local && editing.variants.local.editing.tokens.length > 0) {
                  const targetVariant = editing.variants['local-corrected'] ? 'local-corrected' : 'local';
                  editing.selectVariant(targetVariant);
                } else {
                  void handleLocalAnalyze(text);
                }
              } else if (value === 'model') {
                if (editing.variants.model && editing.variants.model.editing.tokens.length > 0) {
                  editing.selectVariant('model');
                } else {
                  const cacheKey = sentenceCacheKey(text, endpoint, locale, userApiKey, thinkingEnabled);
                  const cached = analysisCache.get(cacheKey);
                  if (cached) {
                    editing.startVariant('model', cached, { status: 'complete', validated: true, sourceKey: cacheKey, model: endpoint.model, fromCache: true }, true);
                  }
                }
              }
            }} onClear={() => { void clearLocalDictionaryCache().then(() => { setLocalNoticeIsError(false); setLocalNotice('已清除词典缓存。'); }).catch(error => { setLocalNoticeIsError(true); setLocalNotice(error.message); }); }} />
            {analysisEngine === 'local' && localNotice && <p className="tool-note" role={localNoticeIsError ? 'alert' : 'status'}>{errorText(localNotice)}</p>}
            <InputSection
              originalText={currentSentence || draft}
              draft={draft}
              onDraftChange={handleDraftChange}
              compact={isReading}
              showSuggestions={isHome}
              onNewSentence={handleStartOver}
              onExpand={() => { setEditRange(null); setIsEditingInput(true); }}
              onCancelEdit={currentSentence && (analyzedTokens.length > 0 || isAnalyzing || analysisProgress !== null) ? () => {
                setDraft(currentSentence);
                setEditRange(null);
                setIsEditingInput(false);
              } : undefined}
              history={history}
              onAnalyze={handleAnalyze}
              onCancelAnalyze={handleCancelAnalysis}
                userApiKey={userApiKey}
                activeService={activeService}
                services={services}
                activeServiceId={activeService?.id ?? ''}
                activeModelId={activeModel?.id ?? ''}
                onSelectModel={handleSelectModel}
                onOpenSettings={() => setIsSettingsModalOpen(true)}
                endpoint={endpoint}
                speechService={activeSpeechService}
                speechServices={speechSettings.services}
               useStream={useStream}
              onSpeechServiceChange={handleSpeechServiceChange}
              isAnalyzing={isAnalyzing}
              analysisError={analysisError}
              tokens={analyzedTokens}
              onAudioCuesReady={handleAudioCuesReady}
              onAudioPlaybackUpdate={handleAudioPlaybackUpdate}
              compactExtras={shouldShowAnalyzer() && (
                <DisplayOptions
                  variant="chips"
                  showFurigana={showFurigana}
                  onShowFuriganaChange={setShowFurigana}
                  showRomaji={showRomaji}
                  onShowRomajiChange={setShowRomaji}
                />
              )}
            />

            {localProgress && <p className="tool-note" role="status">{localProgress.stage === 'download'
              ? t('正在准备本地词典：{0}/{1} MB', (localProgress.loaded / 1e6).toFixed(1), (localProgress.total / 1e6).toFixed(1))
              : t(localProgress.stage === 'load' ? '正在加载本地词典…' : '正在本地解析…')}</p>}

            {!!activeModel?.caps?.thinking
              && thinkingEnabled
              && activeAnalysisTypeRef.current === 'model' && (isAnalyzing || hasDeepseekReasoning) && (
                <ReasoningStream
                  store={reasoningTextStore}
                  done={deepseekReasoningDone}
                  summaryHistory={deepseekReasoningSummaryHistory}
                  completionLabel={deepseekReasoningCompletionLabel}
                />
              )}

            {analysisProgress && <AnalysisProgressView progress={analysisProgress} onRetry={() => void analysisSessionRef.current?.retry()} />}

            {analysisError && (
              <div className="nd-card">
                <div
                  className="flex items-start gap-2 rounded-[10px] p-3 text-sm"
                  role="alert"
                  style={{
                    background: 'color-mix(in oklab, var(--pos-p) 10%, transparent)',
                    color: 'var(--error-text)',
                  }}
                >
                  <span
                    className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[12px] font-bold leading-none"
                    style={{ background: 'var(--pos-p)', color: '#fff' }}
                    aria-hidden="true"
                  >
                    !
                  </span>
                  <span>{t("解析错误：")}{errorText(analysisError)}</span>
                </div>
              </div>
            )}

            {(shouldShowAnalyzer() || currentSentence) && (
              <div className="reading-surface">
                {analysisEngine === 'local' && localVariant && <div className="analysis-variant-bar" role="group" aria-label={t('解析结果版本')}>
                  <button className="display-chip" aria-pressed={resultKind === 'local'} onClick={() => { editing.selectVariant('local'); handleCloseWordDetail(); setEditRange(null); }}>{t('本地解析')}</button>
                  {correctedVariant && <button className="display-chip" aria-pressed={resultKind === 'local-corrected'} onClick={() => { editing.selectVariant('local-corrected'); handleCloseWordDetail(); setEditRange(null); }}>
                    {t('模型校正版')}{correctedVariant.status === 'running' ? ` · ${t('进行中')}` : correctedVariant.status === 'incomplete' ? ` · ${t('未完成')}` : ''}
                  </button>}
                  <button className="nd-ghost-btn flex items-center gap-1.5" disabled={isAnalyzing || !localVariant.validated} onClick={() => void handleCorrectLocal()}>{Icon.refresh}<span>{t(correctedVariant ? '重新用模型校正' : '用模型校正')}</span></button>
                </div>}
                {analysisEngine === 'local' && resultKind !== 'model' && shouldShowAnalyzer() && <div className="local-draft-status" role="status">
                  <span>{t(resultKind === 'local-corrected' ? correctedVariant?.status === 'complete' ? '已由模型校正：{0}' : '模型校正未完成，当前显示已确认的连续部分。' : '本地初稿：读音和词性尚未经过模型校正。', analysisSource.model)}</span>
                  {resultKind === 'local-corrected' && correctedStale && <span>{t('基于较早的本地版本')}</span>}
                </div>}
                {shouldShowAnalyzer() && <div className="learning-actions reading-tools">
                  <button className="display-chip" aria-pressed={viewMode === 'lexical'} onClick={() => setViewMode('lexical')}>{t('词法视图')}</button>
                  <button className="display-chip" aria-pressed={viewMode === 'reading'} onClick={() => setViewMode('reading')}>{t('阅读视图')}</button>
                  <button className="nd-ghost-btn flex items-center gap-1.5" disabled={isAnalyzing} onClick={() => void handleAnalyze(currentSentence, undefined, true)}>{Icon.refresh}<span>{t('重新解析')}</span></button>
                  <button className="nd-ghost-btn" disabled={editingLocked || !editing.state.history.length} title={!editing.state.history.length ? t('尚无可撤销的调整') : t('撤销最近一次分词或阅读分组调整')} onClick={() => { editing.undo(); handleCloseWordDetail(); setEditNotice('已撤销最近一次调整'); }}>{t('撤销')}</button>
                  <button className="nd-ghost-btn" disabled={editingLocked || !editing.canRestore} title={!editing.canRestore ? t('当前已经是初始分词') : t('恢复本次解析的初始分词并清除手动阅读分组')} onClick={() => { editing.restore(); handleCloseWordDetail(); setEditNotice('已恢复初始分词'); }}>{t('恢复初始分词')}</button>
                </div>}
                {shouldShowAnalyzer() && <p className="tool-note" role="status">{t('分词：{0} 项', analyzedTokens.length)}{editNotice ? ` · ${t(editNotice)}` : ''}{analysisFromCache ? ` · ${t('已使用缓存')}` : ''}</p>}
                {shouldShowAnalyzer() && analysisUsesPreviousSettings && <p className="tool-note">{t('当前分词来自先前设置（{0}），点击重新解析可更新。', analysisSource.model)}</p>}
                {(shouldShowAnalyzer() || pendingText) && (
                  <AnalysisResult
                    key={currentSentence}
                    tokens={analyzedTokens}
                    readingGroups={viewMode === 'reading' && !isAnalyzing ? readingGroups : undefined}
                    pendingText={pendingText}
                    pendingActive={isAnalyzing}
                    showFurigana={showFurigana}
                    onShowFuriganaChange={setShowFurigana}
                    showRomaji={showRomaji}
                    onShowRomajiChange={setShowRomaji}
                    onWordClick={handleWordClick}
                    selectedIndex={selectedIndex}
                    selectedRange={selectedRange}
                    onRangeSelect={handleRangeSelect}
                    pickAnchor={pickAnchor}
                    onPickAnchorChange={setPickAnchor}
                    playingTokenIndex={playingTokenIndex}
                    showDisplayOptions={!isReading}
                  />
                )}

                {currentSentence && (
                  <TranslationSection
                    japaneseText={currentSentence}
                    userApiKey={userApiKey}
                    endpoint={endpoint}
                    useStream={useStream}
                    trigger={translationTrigger}
                    analysisReady={!isAnalyzing && analysisValidated}
                    onConfigureModel={() => setIsSettingsModalOpen(true)}
                    analysisSignal={analysisSignal}
                    settings={translationSettings}
                    onProviderChange={(provider: TranslationProviderId) => {
                      const next = { ...translationSettings, preferredProvider: provider };
                      setTranslationSettings(next); browserStorage.setItem(TRANSLATION_SERVICES_KEY, JSON.stringify(next));
                    }}
                    thinkingEnabled={thinkingEnabled}
                    active={mode === 'analyze'}
                  />
                )}
              </div>
            )}
            {editRange && <ResegmentEditor key={`${editRange.taskId}:${editRange.revision}`} tokens={analyzedTokens.slice(editRange.range.start, editRange.range.end + 1)} context={selectWordDetailContext(currentSentence, analyzedTokens, editRange.range.start)} model={learningModel} onClose={() => setEditRange(null)} onApply={tokens => { editing.edit(editRange.range, tokens, editRange.taskId, editRange.revision); setEditNotice('已应用分词调整'); setEditRange(null); handleCloseWordDetail(); }} />}
            </div>
          </div>

          {/* 侧栏：词汇详情（桌面端），未选词时收起不占位 */}
          <aside className="detail-rail sticky top-4 hidden self-start lg:block">
            <div className="detail-rail-inner">
              {isDesktop && hasWordDetail && wordDetailPanel}
            </div>
          </aside>
        </main>

        <footer className="px-4 pb-6 pt-1 text-center text-xs sm:px-9" style={{ color: 'var(--ink-3)' }}>
          {t("AI也可能会犯错，请核查重要信息。")}
        </footer>

        {/* 设置模态框 */}
        <SettingsModal
          translationSettings={translationSettings}
          services={services}
          activeServiceId={activeServiceId}
          activeModelId={activeModelId}
          geminiApiKey={geminiApiKey}
          speechSettings={speechSettings}
          onSaveSettings={handleSaveSettings}
          isModalOpen={isSettingsModalOpen}
          onModalClose={() => setIsSettingsModalOpen(!isSettingsModalOpen)}
        />
      </div>

      {/* 移动端词汇详情模态 */}
      {!isDesktop && hasWordDetail && typeof document !== 'undefined' && createPortal(
        <div
          id="wordDetailModal"
          className="word-detail-modal"
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseWordDetail();
          }}
        >
          <div className="word-detail-modal-content">
            <button
              type="button"
              className="modal-close-button"
              title={t("关闭详情")}
              aria-label={t("关闭详情")}
              onClick={handleCloseWordDetail}
            >
              &times;
            </button>
            {wordDetailPanel}
          </div>
        </div>,
        document.body
      )}

      {/* AI聊天助手 */}
      <AIChat
        hidden={isSettingsModalOpen}
        userApiKey={userApiKey}
        activeService={activeService}
        endpoint={endpoint}
        currentSentence={currentSentence}
      />
    </>
  );
}
