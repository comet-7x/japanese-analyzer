'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTranslateText, translateText, type EndpointPayload } from '../services/api';
import type { Locale } from '../i18n';
import { credentialScope, ResultCache, sentenceCacheKey, sentenceTranslationCache } from '../utils/sentenceCache';
import { LatestRequest } from '../utils/latestRequest';
import type {
  MachineTranslationProviderId, MachineTranslationResponse, TranslationProviderId,
  TranslationReview, TranslationServiceSettings,
} from '../lib/translationServices';
import { DEFAULT_TRANSLATION_SERVICE_SETTINGS } from '../lib/translationServices';

const machineTranslationCache = new ResultCache<string>();
const translationReviewCache = new ResultCache<TranslationReview>();

function machineCredentialScope(provider: MachineTranslationProviderId, settings: TranslationServiceSettings): number {
  return provider === 'google'
    ? credentialScope(`google:${settings.google.apiKey}`)
    : credentialScope(`baidu:${settings.baidu.appId}:${settings.baidu.secret}`);
}

export function useSentenceTranslation({ text, endpoint, apiKey, locale, useStream, trigger, analysisSignal,
  provider = 'model', settings = DEFAULT_TRANSLATION_SERVICE_SETTINGS, thinkingEnabled = false }: {
  text: string; endpoint: EndpointPayload; apiKey?: string; locale: Locale;
  useStream: boolean; trigger?: number; analysisSignal?: AbortSignal;
  provider?: TranslationProviderId; settings?: TranslationServiceSettings; thinkingEnabled?: boolean;
}) {
  const [translation, setTranslation] = useState('');
  const [review, setReview] = useState<TranslationReview | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const request = useRef(new LatestRequest());
  const reviewRequest = useRef(new LatestRequest());
  const modelKey = sentenceCacheKey(text, endpoint, locale, apiKey, thinkingEnabled);
  const machineKey = provider === 'model' ? '' : JSON.stringify([
    text, locale, provider, machineCredentialScope(provider, settings),
  ]);

  const translate = useCallback(async (force = false) => {
    const ticket = request.current.start();
    reviewRequest.current.cancel();
    setError(''); setReviewError(''); setReview(null); setShowReview(false); setFromCache(false); setIsLoading(false);
    if (!text || (provider === 'model' && !endpoint.model)) { setTranslation(''); return; }
    const cached = force ? undefined : provider === 'model'
      ? sentenceTranslationCache.get(modelKey) : machineTranslationCache.get(machineKey);
    if (cached !== undefined) { setTranslation(cached); setFromCache(true); return; }
    const signal = analysisSignal && !analysisSignal.aborted
      ? AbortSignal.any([ticket.signal, analysisSignal]) : ticket.signal;
    const isCurrent = () => ticket.isCurrent() && !signal.aborted;
    setIsLoading(true); setTranslation('');
    const save = (value: string) => {
      if (!isCurrent()) return;
      if (!value.trim()) throw new Error('译文为空，请重试。');
      if (provider === 'model') sentenceTranslationCache.set(modelKey, value);
      else machineTranslationCache.set(machineKey, value);
      setTranslation(value);
    };
    try {
      if (provider === 'model') {
        if (useStream) {
          await streamTranslateText(text, (chunk, done) => {
            if (!isCurrent()) return;
            setTranslation(chunk);
            if (done) save(chunk);
          }, e => { if (isCurrent()) setError(e.message); }, apiKey, endpoint, signal);
        } else save(await translateText(text, apiKey, endpoint, signal));
      } else {
        const translationKey = provider === 'google' ? settings.google.apiKey : settings.baidu.secret;
        const translationAppId = provider === 'baidu' ? settings.baidu.appId : '';
        const response = await fetch('/api/machine-translate', {
          method: 'POST', signal,
          headers: {
            'Content-Type': 'application/json', 'X-App-Locale': locale,
            'X-Translation-Api-Key': translationKey,
            ...(provider === 'baidu' ? { 'X-Translation-App-Id': translationAppId } : {}),
          },
          body: JSON.stringify({ provider, text }),
        });
        const value = await response.json().catch(() => null) as (MachineTranslationResponse & { error?: { message?: string } }) | null;
        if (!response.ok || !value) throw new Error(value?.error?.message || `机器翻译请求失败（HTTP ${response.status}）`);
        save(value.translation);
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      if (ticket.isCurrent()) setIsLoading(false);
    }
  }, [text, provider, endpoint, apiKey, modelKey, machineKey, useStream, analysisSignal, settings, locale]);

  const reviewTranslation = useCallback(async (force = false) => {
    if (provider === 'model' || !translation || !endpoint.model) return;
    const cacheKey = JSON.stringify([text, translation, provider, endpoint, locale, credentialScope(apiKey), thinkingEnabled]);
    const cached = force ? undefined : translationReviewCache.get(cacheKey);
    if (cached) { setReview(cached); setShowReview(true); setReviewError(''); return; }
    const ticket = reviewRequest.current.start(); setIsReviewing(true); setReviewError('');
    try {
      const response = await fetch('/api/translate/review', {
        method: 'POST', signal: ticket.signal,
        headers: { 'Content-Type': 'application/json', 'X-App-Locale': locale, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ text, draft: translation, provider, ...endpoint, thinkingEnabled }),
      });
      const value = await response.json().catch(() => null) as (TranslationReview & { error?: { message?: string } }) | null;
      if (!response.ok || !value || typeof value.translation !== 'string' || typeof value.summary !== 'string') {
        throw new Error(value?.error?.message || `译文复核请求失败（HTTP ${response.status}）`);
      }
      if (!ticket.isCurrent()) return;
      translationReviewCache.set(cacheKey, value); setReview(value); setShowReview(true);
    } catch (error) {
      if (ticket.isCurrent()) setReviewError(error instanceof Error ? error.message : '译文复核失败。');
    } finally { if (ticket.isCurrent()) setIsReviewing(false); }
  }, [provider, translation, endpoint, text, locale, apiKey, thinkingEnabled]);

  useEffect(() => {
    const manager = request.current; const reviewer = reviewRequest.current;
    manager.cancel(); reviewer.cancel(); setTranslation(''); setReview(null); setShowReview(false);
    setError(''); setReviewError(''); setIsLoading(false); setIsReviewing(false); setFromCache(false);
    return () => { manager.cancel(); reviewer.cancel(); };
  }, [text, provider, endpoint, apiKey, locale]);

  useEffect(() => {
    if (trigger && text && provider === 'model') void translate();
  }, [trigger, text, provider, translate]);

  return {
    translation, review, displayedTranslation: showReview && review ? review.translation : translation,
    showReview, setShowReview, error, reviewError, isLoading, isReviewing, fromCache,
    translate, reviewTranslation,
  };
}
