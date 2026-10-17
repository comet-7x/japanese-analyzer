'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { postLearning, type LearningModel } from '../services/learning';
import { LatestRequest } from '../utils/latestRequest';
import { credentialScope } from '../utils/sentenceCache';
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

const translationCache = new Map<string, string>();
const analysisCache = new Map<string, SelectionAnalysis>();

export function useSelectionTools({ identity, word, pos, sentence, furigana, kind, model, locale = 'zh-CN' }: {
  identity: string; word: string; pos: string; sentence: string; furigana: string;
  kind: 'word' | 'phrase'; model: LearningModel; locale?: Locale;
}) {
  const [translation, setTranslation] = useState('');
  const [analysis, setAnalysis] = useState<SelectionAnalysis | null>(null);
  const [translationLoading, setTranslationLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [analysisError, setAnalysisError] = useState('');
  const translationRequest = useRef(new LatestRequest());
  const analysisRequest = useRef(new LatestRequest());
  const key = JSON.stringify([identity, word, pos, sentence, furigana, kind, locale, model.endpoint, credentialScope(model.apiKey)]);

  useEffect(() => {
    const tr = translationRequest.current; const ar = analysisRequest.current;
    tr.cancel(); ar.cancel(); setTranslation(''); setAnalysis(null); setTranslationError(''); setAnalysisError('');
    setTranslationLoading(false); setAnalysisLoading(false);
    return () => { tr.cancel(); ar.cancel(); };
  }, [key]);

  const loadTranslation = useCallback(async (force = false) => {
    const cached = force ? undefined : translationCache.get(key);
    if (cached !== undefined) { setTranslation(cached); setTranslationError(''); return; }
    const ticket = translationRequest.current.start(); setTranslationLoading(true); setTranslationError('');
    try {
      const value = await postLearning<{ translation: string }>('/api/word-detail', { word, pos, sentence, furigana, kind, task: 'translate' }, ticket.signal, model);
      if (!ticket.isCurrent()) return; translationCache.set(key, value.translation); setTranslation(value.translation);
    } catch (error) { if (ticket.isCurrent()) setTranslationError(error instanceof Error ? error.message : '翻译失败'); }
    finally { if (ticket.isCurrent()) setTranslationLoading(false); }
  }, [key, word, pos, sentence, furigana, kind, model]);

  const loadAnalysis = useCallback(async (force = false) => {
    const cached = force ? undefined : analysisCache.get(key);
    if (cached !== undefined) { setAnalysis(cached); setAnalysisError(''); return; }
    const ticket = analysisRequest.current.start(); setAnalysisLoading(true); setAnalysisError('');
    try {
      const value = await postLearning<SelectionAnalysis>('/api/word-detail', { word, pos, sentence, furigana, kind, task: 'analyze' }, ticket.signal, model);
      if (!ticket.isCurrent()) return; analysisCache.set(key, value); setAnalysis(value);
    } catch (error) { if (ticket.isCurrent()) setAnalysisError(error instanceof Error ? error.message : '用法解析失败'); }
    finally { if (ticket.isCurrent()) setAnalysisLoading(false); }
  }, [key, word, pos, sentence, furigana, kind, model]);

  return { translation, analysis, translationLoading, analysisLoading, translationError, analysisError, loadTranslation, loadAnalysis };
}
