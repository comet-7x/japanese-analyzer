'use client';

import { useEffect, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  DEFAULT_EXTERNAL_SERVICES,
  DEFAULT_ICHI_OPTIONS,
  externalDictionaryLinks,
  EXTERNAL_SERVICES_KEY,
  ICHI_OPTIONS_KEY,
  readExternalServicesSettings,
  readIchiOptions,
  type ExternalServicesSettings,
  type IchiMoeOptions,
  type IchiRomanizationMethod,
} from '../lib/dictionary';
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
  const [services, setServices] = useState<ExternalServicesSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_EXTERNAL_SERVICES;
    return readExternalServicesSettings(localStorage.getItem(EXTERNAL_SERVICES_KEY));
  });
  const [ichiOptions, setIchiOptions] = useState<IchiMoeOptions>(() => {
    if (typeof window === 'undefined') return DEFAULT_ICHI_OPTIONS;
    return readIchiOptions(localStorage.getItem(ICHI_OPTIONS_KEY));
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === EXTERNAL_SERVICES_KEY) {
        setServices(readExternalServicesSettings(e.newValue));
      } else if (e.key === ICHI_OPTIONS_KEY) {
        setIchiOptions(readIchiOptions(e.newValue));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const updateIchiOptions = (next: IchiMoeOptions) => {
    setIchiOptions(next);
    try {
      localStorage.setItem(ICHI_OPTIONS_KEY, JSON.stringify(next));
    } catch {
      // Storage might not be available
    }
  };

  const enabled = services.enabled;
  const hasAnyEnabled = enabled.ichi || enabled.google || enabled.baidu || enabled.wiktionary;
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
      </div>
      {multiWord && enabled.ichi && (
        <details className="ichi-options-disclosure">
          <summary className="ichi-options-summary">{t('ichi.moe 选项')}</summary>
          <div className="ichi-options-panel">
            <label className="ichi-option-row">
              <span className="ichi-option-label">{t('罗马字格式')}</span>
              <select
                className="learning-input ichi-select"
                aria-label={t('罗马字格式')}
                value={ichiOptions.r || 'htr'}
                onChange={e => updateIchiOptions({ ...ichiOptions, r: e.target.value as IchiRomanizationMethod })}
              >
                <option value="htr">{t('赫本式（传统）')}</option>
                <option value="kana">{t('假名标音')}</option>
                <option value="text">{t('仅原文分词')}</option>
                <option value="hb">{t('赫本式（基础）')}</option>
                <option value="hm">{t('赫本式（修正）')}</option>
                <option value="ks">{t('训令式')}</option>
              </select>
            </label>
            <div className="ichi-option-checkboxes">
              <label className="ichi-option-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(ichiOptions.hira)}
                  onChange={e => updateIchiOptions({ ...ichiOptions, hira: e.target.checked })}
                />
                <span>{t('片假名转平假名')}</span>
              </label>
              <label className="ichi-option-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(ichiOptions.noseg)}
                  onChange={e => updateIchiOptions({ ...ichiOptions, noseg: e.target.checked })}
                />
                <span>{t('不分词（仅假名）')}</span>
              </label>
            </div>
          </div>
        </details>
      )}
    </details>
  );
}
