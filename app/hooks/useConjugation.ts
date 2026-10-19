'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n';
import { validateConjugation, type ConjugationResult } from '../lib/learningTools';
import { postLearning, type LearningModel } from '../services/learning';
import { LatestRequest } from '../utils/latestRequest';
import { credentialScope, ResultCache } from '../utils/sentenceCache';

const conjugationCache = new ResultCache<ConjugationResult>(40);

export function useConjugation({ surface, context, model, locale, identity = '' }: {
  surface: string; context: string; model: LearningModel; locale: Locale; identity?: string;
}) {
  // The inferred dictionary form is a request hint; updating it must not cancel
  // the request started with that same analysis result.
  const cacheKey = JSON.stringify([surface, context, locale, model.endpoint, credentialScope(model.apiKey)]);
  const [result, setResult] = useState<ConjugationResult | null>(() => conjugationCache.get(cacheKey) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(new LatestRequest());
  const inFlight = useRef<Promise<ConjugationResult | null> | null>(null);

  useEffect(() => {
    const manager = request.current;
    manager.cancel(); inFlight.current = null;
    setResult(conjugationCache.get(cacheKey) ?? null);
    setLoading(false); setError('');
    return () => manager.cancel();
  }, [identity, cacheKey]);

  const load = useCallback((dictionaryForm: string, force = false): Promise<ConjugationResult | null> => {
    if (inFlight.current) return inFlight.current;
    const cached = force ? undefined : conjugationCache.get(cacheKey);
    if (cached) { setResult(cached); setError(''); return Promise.resolve(cached); }
    const ticket = request.current.start();
    setLoading(true); setError('');
    const pending = (async () => {
      try {
        const value = validateConjugation(await postLearning('/api/conjugation', {
          surface, dictionaryForm, context,
        }, ticket.signal, model), surface);
        if (!ticket.isCurrent()) return null;
        conjugationCache.set(cacheKey, value); setResult(value);
        return value;
      } catch (error) {
        if (ticket.isCurrent()) setError(error instanceof Error ? error.message : '学习工具请求失败');
        return null;
      } finally {
        if (ticket.isCurrent()) { setLoading(false); inFlight.current = null; }
      }
    })();
    inFlight.current = pending;
    return pending;
  }, [cacheKey, surface, context, model]);

  return { result, loading, error, load };
}
