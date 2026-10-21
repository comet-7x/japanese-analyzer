'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { getPosClass } from '../utils/helpers';
import {
  getJstDateKey,
  isCompleteDailySentence,
  secondsUntilJstMidnight,
  type DailySentence as DailySentenceData,
} from '../utils/dailySentences';
import { Icon } from './Icons';
import { createDailySentencePool } from '../services/dailySentenceClient';
import { bundledSentencePack } from '../utils/bundledSentencePack';

interface DailySentenceProps {
  onAnalyze: (text: string) => void;
  disabled?: boolean;
}

/** 首页「今日一句」：用解析结果的样子展示一句日语，点击即解析 */
export default function DailySentence({ onAnalyze, disabled = false }: DailySentenceProps) {
  const { t, locale, localeReady } = useLanguage();
  const [sentence, setSentence] = useState<DailySentenceData | null>(null);
  const currentSentence = useRef<DailySentenceData | null>(null);
  const manualBusy = useRef(false);
  const pool = useRef<ReturnType<typeof createDailySentencePool> | null>(null);
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
    const previous = currentSentence.current;
    const initial = (previous?.date === dateKey && isCompleteDailySentence(previous, locale) ? previous : null)
      ?? deck.current(dateKey, locale) ?? deck.take(dateKey, locale);
    display(initial);
  }, [dateKey, locale, localeReady, display]);

  const refreshSentence = () => {
    const previous = currentSentence.current;
    if (disabled || manualBusy.current || !previous || !pool.current) return;
    manualBusy.current = true;
    try {
      const date = getJstDateKey();
      if (date !== dateKey) setDateKey(date);
      display(pool.current.take(date, locale, previous.text));
    } finally {
      // Collapse duplicate clicks from the same event turn so each user action selects just one sentence.
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
    </div>
  );
}
