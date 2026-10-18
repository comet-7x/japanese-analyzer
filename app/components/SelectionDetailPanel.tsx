'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import type { TokenData } from '../services/api';
import type { LearningModel } from '../services/learning';
import type { DictionaryProvider } from '../lib/dictionary';
import { isMultiWordLookup } from '../lib/dictionary';
import { getPosGroup, getJapaneseTtsAudioUrl, speakJapanese } from '../utils/helpers';
import { loadSpeechSettings } from '../lib/speechServices';
import { browserStorage } from '../utils/storage';
import { trackTtsUsage } from '../utils/analytics';
import { Icon, I } from './Icons';
import CopyTextButton from './CopyTextButton';
import DictionaryPanel from './DictionaryPanel';
import ExternalDictionaryLookup from './ExternalDictionaryLookup';
import ConjugationPanel from './ConjugationPanel';
import { useConjugation } from '../hooks/useConjugation';
import { useSelectionTools } from '../hooks/useSelectionTools';
import { LatestRequest } from '../utils/latestRequest';
import { credentialScope } from '../utils/sentenceCache';

function LazyDisclosure({ label, open, onToggle, onFirstOpen, children }: {
  label: string; open: boolean; onToggle: (open: boolean) => void; onFirstOpen?: () => void; children: React.ReactNode;
}) {
  const loaded = useRef(false);

  return <details className="detail-disclosure" open={open} onToggle={event => {
    const nextOpen = event.currentTarget.open;
    onToggle(nextOpen);
    if (nextOpen && !loaded.current) { loaded.current = true; onFirstOpen?.(); }
  }}><summary>{label}</summary>{children}</details>;
}

export default function SelectionDetailPanel({ selectedText, pos, reading, context, tokens, selectionKind,
  identity, provider, model, onClose, onMerge, onSelectMore, onEdit, onGroup, onUngroup, canEdit, canGroup, hideClose = false,
}: {
  selectedText: string; pos: string; reading: string; context: string; tokens: readonly TokenData[];
  selectionKind: 'word' | 'phrase'; identity: string; provider: DictionaryProvider; model: LearningModel;
  onClose: () => void; onMerge?: (analysis: { pos: string; furigana: string }) => void; onSelectMore?: () => void;
  onEdit: () => void; onGroup?: () => void; onUngroup?: () => void; canEdit: boolean; canGroup: boolean; hideClose?: boolean;
}) {
  const { t, errorText, locale } = useLanguage();
  const multiWord = isMultiWordLookup(selectedText, { kind: selectionKind, tokenCount: tokens.length });
  const { translation, analysis, translationLoading, analysisLoading, translationError, analysisError, loadTranslation, loadAnalysis } = useSelectionTools({
    identity, word: selectedText, pos, sentence: context, furigana: reading, kind: selectionKind, model, locale,
  });
  const [dictionaryOpen, setDictionaryOpen] = useState(false);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [conjugationOpen, setConjugationOpen] = useState(false);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const conjugation = useConjugation({ surface: selectedText, context, model, locale, identity });
  const batchRequest = useRef(new LatestRequest());
  const batchScope = JSON.stringify([identity, selectedText, context, locale, model.endpoint, credentialScope(model.apiKey)]);
  const speechCleanup = useRef<() => void>(() => undefined);

  useEffect(() => {
    const manager = batchRequest.current;
    manager.cancel();
    setDictionaryOpen(false);
    setTranslationOpen(false);
    setAnalysisOpen(false);
    setConjugationOpen(false);
    setIsBatchGenerating(false);
    return () => manager.cancel();
  }, [batchScope]);

  useEffect(() => () => speechCleanup.current(), []);

  const conjugatable = !multiWord && tokens.some(token => ['v', 'adj', 'adjv', 'aux'].includes(getPosGroup(token.pos)));
  const hasTranslation = !!translation;
  const hasAnalysis = !!analysis;
  const totalCount = conjugatable ? 3 : 2;
  const doneCount = (hasTranslation ? 1 : 0) + (hasAnalysis ? 1 : 0) + (conjugatable && !!conjugation.result ? 1 : 0);
  const isAllDone = doneCount === totalCount;

  const handleBatchAnalyze = async (force = false) => {
    const ticket = batchRequest.current.start();
    setTranslationOpen(true);
    setAnalysisOpen(true);
    if (conjugatable) setConjugationOpen(true);
    setIsBatchGenerating(true);
    const promises: Promise<unknown>[] = [];

    if (force || !hasTranslation) {
      promises.push(loadTranslation(force));
    }
    let analysisPromise = Promise.resolve(analysis);
    if (force || !hasAnalysis) {
      analysisPromise = loadAnalysis(force);
      promises.push(analysisPromise);
    }
    if (conjugatable && (force || !conjugation.result)) {
      promises.push(
        analysisPromise.then(result => {
          if (!ticket.isCurrent() || !result) return null;
          return conjugation.load(result.dictionaryForm, force);
        })
      );
    }

    try {
      await Promise.allSettled(promises);
    } finally {
      if (ticket.isCurrent()) setIsBatchGenerating(false);
    }
  };

  const speak = async () => {
    speechCleanup.current();
    const controller = new AbortController(); let audio: HTMLAudioElement | undefined; let url: string | undefined;
    const cleanup = () => { controller.abort(); if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } if (url) URL.revokeObjectURL(url); };
    speechCleanup.current = cleanup;
    try {
      const settings = loadSpeechSettings(browserStorage); const service = settings.services.find(item => item.id === settings.activeId) ?? settings.services[0];
      url = await getJapaneseTtsAudioUrl(selectedText, service.apiKey, service.provider, { baseUrl: service.baseUrl, model: service.model, voice: service.voice, speed: service.speed, signal: controller.signal });
      if (controller.signal.aborted) return; audio = new Audio(url); audio.onended = cleanup; audio.onerror = cleanup; await audio.play(); trackTtsUsage(service.provider, service.model);
    } catch { if (!controller.signal.aborted) { cleanup(); speakJapanese(selectedText); } }
  };
  const lemma = analysis?.dictionaryForm ?? '';

  return <section className="word-detail-panel selection-tools-panel">
    <header className="word-detail-headword relative px-5 pb-3.5 pt-4">
      <div className={`dictionary-heading flex items-start gap-3${hideClose ? ' has-modal-close' : ''}`}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <h2 lang="ja" className="jp m-0 min-w-0 text-[26px] font-medium leading-snug">{selectedText}</h2>
          <button type="button" className="dictionary-icon-btn" title={t('朗读发音')} aria-label={t('朗读发音')} onClick={() => void speak()}>{Icon.speaker}</button>
          <CopyTextButton text={selectedText} label="复制选中文本" iconOnly />
        </div>
        {!hideClose && <button type="button" className="dictionary-icon-btn" title={t('关闭')} aria-label={t('关闭')} onClick={onClose}><I w={16}><path d="M6 6l12 12M18 6L6 18" /></I></button>}
      </div>
      {(reading || pos) && <p className="tool-note mb-0 mt-1.5">{reading && <span lang="ja">{reading}</span>}{reading && pos ? ' · ' : ''}{pos}</p>}
      <div className="batch-analyze-bar mt-3 flex items-center justify-between gap-2 border-t border-[var(--line-2)] pt-2.5">
        <button
          type="button"
          className={`batch-analyze-btn${isBatchGenerating ? ' is-generating' : ''}`}
          disabled={isBatchGenerating || !model.apiKey}
          onClick={() => void handleBatchAnalyze(isAllDone)}
        >
          {isBatchGenerating ? (
            <>
              <span className="batch-icon animate-spin text-[var(--primary)]" aria-hidden="true">{Icon.refresh}</span>
              <span>{t('正在生成全部… ({0}/{1})', doneCount, totalCount)}</span>
            </>
          ) : isAllDone ? (
            <>
              <span className="batch-icon text-[var(--primary)]" aria-hidden="true">{Icon.refresh}</span>
              <span>{t('重新解析')}</span>
            </>
          ) : (
            <>
              <span className="batch-icon text-[var(--primary)]" aria-hidden="true">{Icon.sparkles}</span>
              <span>{t('一键完整解析')}</span>
            </>
          )}
        </button>
      </div>
    </header>
    <div className="word-detail-body px-5 pb-5">
      <LazyDisclosure key={`${batchScope}:translation`} label={t('翻译')} open={translationOpen} onToggle={setTranslationOpen} onFirstOpen={() => void loadTranslation()}>
        {translationLoading && <p role="status">{t('翻译中…')}</p>}
        {translation && <p className="dictionary-definition">{translation}</p>}
        {translationError && <p role="alert">{errorText(translationError)} <button className="nd-ghost-btn" onClick={() => void loadTranslation(true)}>{t('重试')}</button></p>}
      </LazyDisclosure>
      <LazyDisclosure key={`${batchScope}:analysis`} label={t('用法解析')} open={analysisOpen} onToggle={setAnalysisOpen} onFirstOpen={() => void loadAnalysis()}>
        {analysisLoading && <p role="status">{t('解析中…')}</p>}
        {analysis && <div className="selection-analysis-content">
          {analysis.dictionaryForm && <p><strong>{t('原形')}</strong> <span lang="ja">{analysis.dictionaryForm}</span></p>}
          {analysis.category && <p><strong>{t('类别')}</strong> {analysis.category}</p>}
          {analysis.explanation && <p>{analysis.explanation}</p>}
          {analysis.breakdown && <p><strong>{t('构成')}</strong> {analysis.breakdown}</p>}
          {analysis.example && <div className="dictionary-example"><p lang="ja">{analysis.example}</p><p>{analysis.exampleTranslation}</p></div>}
          {onMerge && analysis.category === '単語' && <button className="nd-soft-btn" onClick={() => onMerge({ pos: analysis.pos || pos, furigana: analysis.furigana || reading })}>{t('合并为一个词')}</button>}
        </div>}
        {analysisError && <p role="alert">{errorText(analysisError)} <button className="nd-ghost-btn" onClick={() => void loadAnalysis(true)}>{t('重试')}</button></p>}
      </LazyDisclosure>
      {!multiWord && <LazyDisclosure label={t('词典解释')} open={dictionaryOpen} onToggle={setDictionaryOpen}>
        {dictionaryOpen && <DictionaryPanel word={selectedText} lemma={lemma} reading={reading} provider={provider} model={model} standalone />}
      </LazyDisclosure>}
      {conjugatable && <ConjugationPanel tool={conjugation} onLoad={() => conjugation.load(lemma)} open={conjugationOpen} onOpenChange={setConjugationOpen} />}
      <ExternalDictionaryLookup word={selectedText} lemma={!multiWord ? lemma : ''} multiWord={multiWord} />
      <div className="learning-actions selection-edit-actions">
        <button className="nd-soft-btn" disabled={!canEdit} onClick={onEdit}>{t('调整分词')}</button>
        {selectionKind === 'phrase' && <><button className="nd-ghost-btn" disabled={!canGroup} onClick={onGroup}>{t('设为阅读组')}</button><button className="nd-ghost-btn" disabled={!canGroup} onClick={onUngroup}>{t('取消阅读组')}</button></>}
        {selectionKind === 'word' && onSelectMore && <button className="nd-ghost-btn" onClick={onSelectMore}>{t('选中多个词一起解析')}</button>}
      </div>
    </div>
  </section>;
}
