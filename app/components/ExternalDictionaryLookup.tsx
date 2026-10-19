'use client';

import { useLanguage } from '../contexts/LanguageContext';
import { useExternalLookupSettings } from '../contexts/ExternalLookupContext';
import { externalDictionaryLinks } from '../lib/dictionary';
import IchiMoeOptionsPanel from './IchiMoeOptionsPanel';
import { I } from './Icons';

export default function ExternalDictionaryLookup({
  word,
  lemma = '',
  multiWord = false,
}: {
  word: string;
  lemma?: string;
  multiWord?: boolean;
}) {
  const { t, locale } = useLanguage();
  const { services, ichiOptions, updateIchiOptions } = useExternalLookupSettings();

  const enabled = services.enabled;
  const hasAnyEnabled = enabled.ichi || enabled.google || enabled.baidu || enabled.wiktionary || enabled.jisho || enabled.weblio;
  if (!word.trim() || !hasAnyEnabled) return null;

  const links = externalDictionaryLinks(word, lemma, {
    multiWord,
    ichiOptions,
    locale,
  });

  return (
    <details className="detail-disclosure external-dictionary">
      <summary>{t('外部查询')}</summary>
      <div className="external-dictionary-links">
        {enabled.ichi && (
          <a href={links.ichi} target="_blank" rel="noreferrer">
            ichi.moe<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
        {enabled.google && (
          <a href={links.google} target="_blank" rel="noreferrer">
            {t('Google 翻译')}<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
        {enabled.baidu && (
          <a href={links.baidu} target="_blank" rel="noreferrer">
            {t('百度翻译')}<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
        {enabled.wiktionary && (
          <a href={links.wiktionary} target="_blank" rel="noreferrer">
            Wiktionary<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
        {enabled.jisho && (
          <a href={links.jisho} target="_blank" rel="noreferrer">
            Jisho<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
        {enabled.weblio && (
          <a href={links.weblio} target="_blank" rel="noreferrer">
            Weblio<I w={14}><path d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7" /></I>
          </a>
        )}
      </div>
      {multiWord && enabled.ichi && (
        <IchiMoeOptionsPanel value={ichiOptions} onChange={updateIchiOptions} />
      )}
    </details>
  );
}
