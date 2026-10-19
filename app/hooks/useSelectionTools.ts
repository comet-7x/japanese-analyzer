'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postLearning, type LearningModel } from '../services/learning';
import { LatestRequest } from '../utils/latestRequest';
import { credentialScope, ResultCache } from '../utils/sentenceCache';
import type { Locale } from '../i18n';

export interface SelectionAnalysis {
  dictionaryForm: string;
  explanation: string;
  example: string;
  exampleTranslation: string;
  pos: string;
  furigana: string;
  category?: string;
  breakdown?: string;
}

const translationCache = new ResultCache<string>(80);
const analysisCache = new ResultCache<SelectionAnalysis>(80);

export function useSelectionTools({ identity, word, pos, sentence, furigana, kind, model, locale = 'zh-CN' }: {
  identity: string; word: string; pos: string; sentence: string; furigana: string;
  kind: 'word' | 'phrase'; model: LearningModel; locale?: Locale;
}) {
  const cacheKey = JSON.stringify([word, pos, sentence, furigana, kind, locale, model.endpoint, credentialScope(model.apiKey)]);

  const [translation, setTranslation] = useState(() => translationCache.get(cacheKey) ?? '');
  const [analysis, setAnalysis] = useState<SelectionAnalysis | null>(() => analysisCache.get(cacheKey) ?? null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const translationRequest = useRef(new LatestRequest());
  const analysisRequest = useRef(new LatestRequest());
  const pendingTranslation = useRef<Promise<string | null> | null>(null);
  const pendingAnalysis = useRef<Promise<SelectionAnalysis | null> | null>(null);

  useEffect(() => {
    const tr = translationRequest.current; const ar = analysisRequest.current;
    tr.cancel(); ar.cancel();
    pendingTranslation.current = null; pendingAnalysis.current = null;
    setTranslation(translationCache.get(cacheKey) ?? '');
    setAnalysis(analysisCache.get(cacheKey) ?? null);
    setTranslationError(''); setAnalysisError('');
    setTranslationLoading(false); setAnalysisLoading(false);
    return () => { tr.cancel(); ar.cancel(); };
  }, [identity, cacheKey]);

  const loadTranslation = useCallback((force = false): Promise<string | null> => {
    if (pendingTranslation.current) return pendingTranslation.current;
    const cached = force ? undefined : translationCache.get(cacheKey);
    if (cached !== undefined) { setTranslation(cached); setTranslationError(''); return Promise.resolve(cached); }
    const ticket = translationRequest.current.start(); setTranslationLoading(true); setTranslationError('');
    const pending = (async () => {
      try {
        const value = await postLearning<{ translation: string }>('/api/word-detail', { word, pos, sentence, furigana, kind, task: 'translate' }, ticket.signal, model);
        if (!ticket.isCurrent()) return null;
        if (typeof value.translation !== 'string' || !value.translation.trim()) throw new Error('译文为空，请重试。');
        translationCache.set(cacheKey, value.translation); setTranslation(value.translation);
        return value.translation;
      } catch (error) { if (ticket.isCurrent()) setTranslationError(error instanceof Error ? error.message : '翻译失败'); }
      finally { if (ticket.isCurrent()) { setTranslationLoading(false); pendingTranslation.current = null; } }
      return null;
    })();
    pendingTranslation.current = pending;
    return pending;
  }, [cacheKey, word, pos, sentence, furigana, kind, model]);

  const loadAnalysis = useCallback((force = false): Promise<SelectionAnalysis | null> => {
    if (pendingAnalysis.current) return pendingAnalysis.current;
    const cached = force ? undefined : analysisCache.get(cacheKey);
    if (cached !== undefined) { setAnalysis(cached); setAnalysisError(''); return Promise.resolve(cached); }
    const ticket = analysisRequest.current.start(); setAnalysisLoading(true); setAnalysisError('');
    const pending = (async () => {
      try {
        const value = await postLearning<SelectionAnalysis>('/api/word-detail', { word, pos, sentence, furigana, kind, task: 'analyze' }, ticket.signal, model);
        if (!ticket.isCurrent()) return null;
        analysisCache.set(cacheKey, value); setAnalysis(value);
        return value;
      } catch (error) { if (ticket.isCurrent()) setAnalysisError(error instanceof Error ? error.message : '用法解析失败'); }
      finally { if (ticket.isCurrent()) { setAnalysisLoading(false); pendingAnalysis.current = null; } }
      return null;
    })();
    pendingAnalysis.current = pending;
    return pending;
  }, [cacheKey, word, pos, sentence, furigana, kind, model]);

  return { translation, analysis, translationLoading, analysisLoading, translationError, analysisError, loadTranslation, loadAnalysis };
}
