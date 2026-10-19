'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getPosClass } from '../utils/helpers';
import { getApiEndpoint } from '../services/api';
import {
  getJstDateKey,
  isCompleteDailySentence,
  secondsUntilJstMidnight,
  sentenceLicenseUrl,
  type DailySentence as DailySentenceData,
} from '../utils/dailySentences';
import { Icon } from './Icons';
import { LatestRequest } from '../utils/latestRequest';
import type { Locale } from '../i18n';
import { createDailySentencePool } from '../services/dailySentenceClient';
import { DAILY_SENTENCE_CLIENT_TIMEOUT_MS } from '../utils/dailySentencePolicy';
import { bundledSentencePack } from '../utils/bundledSentencePack';

interface DailySentenceProps {
  onAnalyze: (text: string) => void;
  disabled?: boolean;
}

/** Background-only fetch; the candidate pool owns validation and persistence. */
async function fetchOnlineBatch(date: string, locale: Locale, signal: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DAILY_SENTENCE_CLIENT_TIMEOUT_MS);
  const abort = () => { clearTimeout(timer); controller.abort(); };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    if (controller.signal.aborted) return null;
    const response = await fetch(getApiEndpoint(`/daily-sentence?locale=${locale}&refresh=1`), { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (controller.signal.aborted || getJstDateKey() !== date) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

/** 首页「今日一句」：用解析结果的样子展示一句日语，点击即解析 */
export default function DailySentence({ onAnalyze, disabled = false }: DailySentenceProps) {
  const { t, locale, localeReady } = useLanguage();
  const [sentence, setSentence] = useState<DailySentenceData | null>(null);
  const currentSentence = useRef<DailySentenceData | null>(null);
  const requests = useRef(new LatestRequest());
  const manualBusy = useRef(false);
  const pool = useRef<ReturnType<typeof createDailySentencePool> | null>(null);
  const syncInBackground = useRef(() => {});
  const display = useCallback((next: DailySentenceData) => {
    currentSentence.current = next;
    setSentence(next);
  }, []);

  const [dateKey, setDateKey] = useState(getJstDateKey);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refreshDate = () => {
      clearTimeout(timer);
      setDateKey(getJstDateKey());
      timer = setTimeout(refreshDate, (secondsUntilJstMidnight() + 1) * 1000);
    };
    refreshDate();
    window.addEventListener('focus', refreshDate);
    document.addEventListener('visibilitychange', refreshDate);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refreshDate);
      document.removeEventListener('visibilitychange', refreshDate);
    };
  }, []);

  useEffect(() => {
    if (!localeReady) return;
    const deck = pool.current ??= createDailySentencePool();
    deck.installPack(bundledSentencePack, dateKey);
    const requestManager = requests.current;
    const previous = currentSentence.current;
    const initial = (previous?.date === dateKey && isCompleteDailySentence(previous, locale) ? previous : null)
      ?? deck.current(dateKey, locale) ?? deck.take(dateKey, locale);
    display(initial);
    let disposed = false;
    let pending = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      if (disposed || pending || navigator.onLine === false || getJstDateKey() !== dateKey) return;
      clearTimeout(retryTimer);
      const delay = deck.syncDelay(dateKey, locale);
      if (delay > 0) { retryTimer = setTimeout(() => { void load(); }, delay); return; }
      pending = true;
      const ticket = requestManager.start();
      try {
        const batch = await fetchOnlineBatch(dateKey, locale, ticket.signal);
        if (disposed || !ticket.isCurrent() || getJstDateKey() !== dateKey) return;
        if (!deck.addBatch(batch, dateKey, locale)) deck.failed(locale);
        // Keep the displayed sentence stable. New candidates are consumed only on the next selection.
      } finally {
        pending = false;
        if (!disposed && ticket.isCurrent()) {
          retryTimer = setTimeout(() => { void load(); }, Math.max(1_000, deck.syncDelay(dateKey, locale)));
        }
      }
    };
    const sync = () => { void load(); };
    syncInBackground.current = sync;
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('focus', sync);
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      window.removeEventListener('online', sync);
      window.removeEventListener('focus', sync);
      syncInBackground.current = () => {};
      requestManager.cancel();
    };
  }, [dateKey, locale, localeReady, display]);

  const refreshSentence = () => {
    const previous = currentSentence.current;
    if (disabled || manualBusy.current || !previous || !pool.current) return;
    manualBusy.current = true;
    try {
      const date = getJstDateKey();
      if (date !== dateKey) setDateKey(date);
      display(pool.current.take(date, locale, previous.text));
      syncInBackground.current();
    } finally {
      // Collapse duplicate clicks from the same event turn without waiting for the network.
      queueMicrotask(() => { manualBusy.current = false; });
    }
  };

  if (!localeReady || !sentence || !isCompleteDailySentence(sentence, locale)) {
    return (
      <div className="daily-sentence-placeholder" aria-hidden="true">
        <span className="daily-label">{t("今日一句")}</span>
        <span className="daily-skeleton daily-skeleton-lg" />
        <span className="daily-skeleton daily-skeleton-sm" />
      </div>
    );
  }

  const translation = sentence.translation[locale];
  const source = sentence.source;
  const translatedSource = source?.translations[locale];

  return (
    <div className="daily-sentence-card">
      <div className="daily-heading">
        <button type="button" className="daily-label daily-analyze" disabled={disabled} onClick={() => onAnalyze(sentence.text)} aria-label={`${t('解析这句')}：${sentence.text}`}>
          {t('今日一句')}
          <span className="daily-go" aria-hidden="true">{Icon.arrowRight}</span>
        </button>
        <button
          type="button"
          className="daily-refresh"
          disabled={disabled}
          aria-label={t('换一句')}
          aria-busy={false}
          onClick={refreshSentence}
        >
          <span className="daily-refresh-icon" aria-hidden="true">{Icon.refresh}</span>
          {t('换一句')}
        </button>
      </div>
      <button
        type="button"
        className="daily-sentence"
        onClick={() => onAnalyze(sentence.text)}
        disabled={disabled}
        aria-label={`${t("解析这句")}：${sentence.text}`}
      >
        <span className="daily-tokens" lang="ja" aria-hidden="true">
          {sentence.tokens.map((token, index) => {
            const isPunct = token.pos === '記号';
            const furigana = token.furigana && token.furigana !== token.word
              ? token.furigana
              : ' ';
            return (
              <span key={index} className={`word-unit-wrapper ${isPunct ? 'is-punct' : ''}`}>
                {!isPunct && <span className="furigana-text">{furigana}</span>}
                <span className="word-token no-click">{token.word}</span>
                {!isPunct && <span className={`pos-underline ${getPosClass(token.pos)}`} />}
              </span>
            );
          })}
        </span>
        {translation && <span className="daily-translation">{translation}</span>}
      </button>
      {source && <div className="daily-source">
        <a href={`https://tatoeba.org/en/sentences/show/${source.id}`} target="_blank" rel="noopener noreferrer">Tatoeba</a>
        <span aria-hidden="true"> · </span>
        <a href={sentenceLicenseUrl(source.license)} target="_blank" rel="noopener noreferrer">{source.license}</a>
        {translation && translatedSource && !('provider' in translatedSource) && <>
          <span aria-hidden="true"> · </span>
          <a href={`https://tatoeba.org/en/sentences/show/${translatedSource.id}`} target="_blank" rel="noopener noreferrer">{t('译文来源')}</a>
          <span aria-hidden="true"> · </span>
          <a href={sentenceLicenseUrl(translatedSource.license)} target="_blank" rel="noopener noreferrer">{translatedSource.license}</a>
        </>}
      </div>}
    </div>
  );
}
