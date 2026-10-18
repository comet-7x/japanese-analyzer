'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamTranslateText, translateText, type EndpointPayload } from '../services/api';
import type { Locale } from '../i18n';
import { credentialScope, ResultCache, sentenceCacheKey, sentenceTranslationCache } from '../utils/sentenceCache';
import { LatestRequest } from '../utils/latestRequest';
import { getCachedMachineTranslation, translateWithMyMemory } from '../services/machineTranslationClient';
import type {
  TranslationProviderId, TranslationReview,
} from '../lib/translationServices';

const translationReviewCache = new ResultCache<TranslationReview>();

export function useSentenceTranslation({ text, endpoint, apiKey, locale, useStream, trigger, analysisSignal,
  provider = 'model', myMemoryEmail = '', thinkingEnabled = false, active = true }: {
  text: string; endpoint: EndpointPayload; apiKey?: string; locale: Locale;
  useStream: boolean; trigger?: number; analysisSignal?: AbortSignal;
  provider?: TranslationProviderId; myMemoryEmail?: string; thinkingEnabled?: boolean; active?: boolean;
}) {
  const [translation, setTranslation] = useState('');
  const [review, setReview] = useState<TranslationReview | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [error, setError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [reviewFromCache, setReviewFromCache] = useState(false);
  const request = useRef(new LatestRequest());
  const reviewRequest = useRef(new LatestRequest());
  const lastAutomaticRequest = useRef<string | null>(null);
  const modelKey = sentenceCacheKey(text, endpoint, locale, apiKey, thinkingEnabled);

  const translate = useCallback(async (force = false) => {
    const ticket = request.current.start();
    reviewRequest.current.cancel();
    setError(''); setReviewError(''); setReview(null); setShowReview(false); setFromCache(false); setIsLoading(false); setIsReviewing(false);
    if (!text || (provider === 'model' && !endpoint.model)) { setTranslation(''); return; }
    const cached = force ? undefined : provider === 'model'
      ? sentenceTranslationCache.get(modelKey) : getCachedMachineTranslation(text, locale);
    if (cached !== undefined) {
      setTranslation(cached);
      setFromCache(true);
      if (provider !== 'model') {
        const reviewCacheKey = JSON.stringify([text, cached, provider, endpoint, locale, credentialScope(apiKey), thinkingEnabled]);
        const cachedReview = translationReviewCache.get(reviewCacheKey);
        if (cachedReview) {
          setReview(cachedReview);
          setShowReview(true);
          setReviewFromCache(true);
        } else {
          setReviewFromCache(false);
        }
      } else {
        setReviewFromCache(false);
      }
      return;
    }
    const signal = analysisSignal && !analysisSignal.aborted
      ? AbortSignal.any([ticket.signal, analysisSignal]) : ticket.signal;
    const isCurrent = () => ticket.isCurrent() && !signal.aborted;
    setIsLoading(true); setTranslation('');
    const save = (value: string) => {
      if (!isCurrent()) return;
      if (!value.trim()) throw new Error('译文为空，请重试。');
      if (provider === 'model') sentenceTranslationCache.set(modelKey, value);
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
        const value = await translateWithMyMemory({ text, locale, email: myMemoryEmail, signal, force });
        save(value.translation);
        if (isCurrent()) setFromCache(value.fromCache);
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : '未知错误');
    } finally {
      if (ticket.isCurrent()) setIsLoading(false);
    }
  }, [text, provider, endpoint, apiKey, modelKey, useStream, analysisSignal, locale, thinkingEnabled, myMemoryEmail]);

  const reviewTranslation = useCallback(async (force = false) => {
    if (provider === 'model' || !translation || !endpoint.model) return;
    const cacheKey = JSON.stringify([text, translation, provider, endpoint, locale, credentialScope(apiKey), thinkingEnabled]);
    const cached = force ? undefined : translationReviewCache.get(cacheKey);
    if (cached) { setReview(cached); setShowReview(true); setReviewFromCache(true); setReviewError(''); return; }
    const ticket = reviewRequest.current.start(); setIsReviewing(true); setReviewError('');
    try {
      const response = await fetch('/api/translate/review', {
        method: 'POST', signal: ticket.signal,
        headers: { 'Content-Type': 'application/json', 'X-App-Locale': locale, ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({ text, draft: translation, provider, ...endpoint, thinkingEnabled }),
      });
      const value = await response.json().catch(() => null) as (TranslationReview & { error?: { message?: string } }) | null;
      if (!response.ok || !value || typeof value.translation !== 'string' || typeof value.summary !== 'string') {
        throw new Error(value?.error?.message || `译文校正请求失败（HTTP ${response.status}）`);
      }
      if (!ticket.isCurrent()) return;
      translationReviewCache.set(cacheKey, value); setReview(value); setShowReview(true); setReviewFromCache(false);
    } catch (error) {
      if (ticket.isCurrent()) setReviewError(error instanceof Error ? error.message : '译文校正失败。');
    } finally { if (ticket.isCurrent()) setIsReviewing(false); }
  }, [provider, translation, endpoint, text, locale, apiKey, thinkingEnabled]);

  useEffect(() => {
    const manager = request.current; const reviewer = reviewRequest.current;
    manager.cancel(); reviewer.cancel();
    setError(''); setReviewError(''); setIsLoading(false); setIsReviewing(false);

    if (!text || (provider === 'model' && !endpoint.model)) {
      setTranslation(''); setReview(null); setShowReview(false); setFromCache(false);
      return;
    }

    const cachedTranslation = provider === 'model'
      ? sentenceTranslationCache.get(modelKey)
      : getCachedMachineTranslation(text, locale);

    if (cachedTranslation !== undefined) {
      setTranslation(cachedTranslation);
      setFromCache(true);
      if (provider !== 'model') {
        const reviewCacheKey = JSON.stringify([text, cachedTranslation, provider, endpoint, locale, credentialScope(apiKey), thinkingEnabled]);
        const cachedReview = translationReviewCache.get(reviewCacheKey);
        if (cachedReview) {
          setReview(cachedReview);
          setShowReview(true);
          setReviewFromCache(true);
        } else {
          setReview(null);
          setShowReview(false);
          setReviewFromCache(false);
        }
      } else {
        setReview(null);
        setShowReview(false);
        setReviewFromCache(false);
      }
    } else {
      setTranslation('');
      setReview(null);
      setShowReview(false);
      setFromCache(false);
      setReviewFromCache(false);
    }

    return () => { manager.cancel(); reviewer.cancel(); lastAutomaticRequest.current = null; };
  }, [text, provider, endpoint, apiKey, locale, modelKey, thinkingEnabled, myMemoryEmail]);

  useEffect(() => {
    if (!active || !trigger || !text) return;
    const key = JSON.stringify([trigger, text, provider, locale, myMemoryEmail]);
    if (lastAutomaticRequest.current === key) return;
    lastAutomaticRequest.current = key;
    void translate();
  }, [active, trigger, text, provider, locale, myMemoryEmail, translate]);

  const effectiveFromCache = showReview && review ? reviewFromCache : fromCache;

  return {
    translation, review, displayedTranslation: showReview && review ? review.translation : translation,
    showReview, setShowReview, error, reviewError, isLoading, isReviewing, fromCache: effectiveFromCache,
    translate, reviewTranslation,
  };
}
