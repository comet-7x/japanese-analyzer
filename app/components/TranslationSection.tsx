'use client';

import { useLanguage } from '../contexts/LanguageContext';
import { useState, useEffect, useMemo } from 'react';
import { useSentenceTranslation } from '../hooks/useSentenceTranslation';
import type { EndpointPayload } from '../services/api';
import ThinkingIndicator from './ThinkingIndicator';
import { Icon } from './Icons';
import SparklesActivity from './SparklesActivity';
import { AutoAnimateHeight } from '@/components/ui/auto-animate-height';
import { FlowAnimatedMarkdown } from '@/components/ui/flow-animated-markdown';
import { escapeHtmlForMarkdown, preserveLineBreaksForMarkdown } from '../utils/markdown';
import type { TranslationProviderId, TranslationServiceSettings } from '../lib/translationServices';

interface TranslationSectionProps {
  japaneseText: string;
  userApiKey?: string;
  endpoint: EndpointPayload;
  useStream?: boolean;
  trigger?: number;
  analysisSignal?: AbortSignal;
  onConfigureModel?: () => void;
  settings: TranslationServiceSettings;
  onProviderChange: (provider: TranslationProviderId) => void;
  thinkingEnabled?: boolean;
  active?: boolean;
  analysisReady?: boolean;
}

export default function TranslationSection({
  japaneseText,
  userApiKey,
  endpoint,
  useStream = true, // 默认为true，保持向后兼容
  trigger,
  analysisSignal,
  onConfigureModel,
  settings,
  onProviderChange,
  thinkingEnabled = false,
  active = true,
  analysisReady = true,
}: TranslationSectionProps) {
  const { t, locale, errorText } = useLanguage();
  const provider = settings.preferredProvider;
  const currentService = settings.services?.find((s) => s.id === provider);
  const myMemoryEmail = currentService?.email ?? settings.myMemoryEmail;
  const resolvedProvider = (currentService?.provider || provider) as TranslationProviderId;
  const { translation, review, displayedTranslation, showReview, setShowReview, error, reviewError,
    isLoading, isReviewing, fromCache, translate, reviewTranslation } = useSentenceTranslation({
    text: japaneseText, endpoint, apiKey: userApiKey, locale, useStream, analysisSignal,
    trigger: resolvedProvider === 'model' && !analysisReady ? 0 : trigger,
    provider: resolvedProvider, myMemoryEmail, thinkingEnabled, active,
  });
  const [isVisible, setIsVisible] = useState(true);
  const [copied, setCopied] = useState(false);
  const [canAnimateTranslation, setCanAnimateTranslation] = useState(false);

  useEffect(() => {
    import('flowtoken').catch(() => {});
  }, []);

  const handleCopy = () => {
    if (!displayedTranslation) return;
    navigator.clipboard?.writeText(displayedTranslation).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const toggleVisibility = () => {
    setIsVisible(!isVisible);
  };

  const animatedTranslation = useMemo(() => {
    return preserveLineBreaksForMarkdown(escapeHtmlForMarkdown(displayedTranslation));
  }, [displayedTranslation]);

  useEffect(() => {
    if (!displayedTranslation) {
      setCanAnimateTranslation(false);
      return;
    }

    if (!isLoading || displayedTranslation.length >= 16 || /[。！？.!?，,\n]/.test(displayedTranslation)) {
      setCanAnimateTranslation(true);
    }
  }, [isLoading, displayedTranslation]);

  const actions = (
    <div className="translation-actions flex items-center gap-1">
      <label className="sr-only" htmlFor="translationProvider">{t('翻译服务')}</label>
      <select id="translationProvider" className="translation-provider-select" value={provider}
        onChange={event => onProviderChange(event.target.value as TranslationProviderId)} disabled={isLoading || isReviewing}>
        <option value="model">{t('当前模型')}</option>
        {settings.services?.map((svc) => (
          <option key={svc.id} value={svc.id}>{svc.name}</option>
        )) ?? <option value="mymemory">MyMemory</option>}
      </select>
      <button
        id="translateSentenceButton"
        className="nd-ghost-btn"
        onClick={() => { if (provider === 'model' && !endpoint.model) { onConfigureModel?.(); return; } setIsVisible(true); setCanAnimateTranslation(false); void translate(true); }}
        disabled={isLoading}
      >
        {Icon.refresh}
        <span>{isLoading ? t("翻译中") : translation ? t("重新翻译") : t("翻译")}</span>
      </button>
      {provider !== 'model' && translation && (
        <button className="nd-ghost-btn translation-review-button" disabled={isReviewing || !endpoint.model}
          aria-busy={isReviewing} data-review-state={isReviewing ? 'loading' : review ? 'retry' : 'initial'}
          onClick={() => { if (!endpoint.model) { onConfigureModel?.(); return; } setIsVisible(true); void reviewTranslation(true); }}>
          <span className="translation-review-icon" aria-hidden="true">
            {isReviewing ? <SparklesActivity /> : review ? Icon.refreshSparkles : Icon.sparkles}
          </span>
          <span>{t(isReviewing ? '润色中…' : review ? '重新用模型润色' : '用模型润色')}</span>
        </button>
      )}
      <button
        onClick={handleCopy}
        className="nd-ghost-btn"
        style={copied ? { color: 'var(--primary)' } : undefined}
        disabled={!displayedTranslation}
      >
        {Icon.copy}<span>{copied ? t("已复制") : t("复制")}</span>
      </button>
      <button
        id="toggleFullTranslationButton"
        className="nd-ghost-btn"
        onClick={toggleVisibility}
        aria-expanded={isVisible}
        aria-controls="translationContent"
      >
        <span>{isVisible ? t("收起") : t("展开")}</span>
      </button>
    </div>
  );

  return (
    <section id="fullTranslationCard" className="translation-section" data-provider={resolvedProvider} data-reviewing={isReviewing} data-collapsed={!isVisible}>
      {/* 译文紧跟原句，标题只留给读屏；操作按钮悬停时出现 */}
      <h2 className="sr-only">{t("中文译文")}</h2>

      <div id="translationContent">
        {/* 包含子元素的外边距，避免高度测量遗漏译文顶部间距。 */}
        <AutoAnimateHeight duration={300} contentClassName="flow-root">
          {isVisible ? (
            <div className="translation-scroll-region flow-root" role="region" aria-label={t("中文译文正文")} tabIndex={0}>
              {review && provider !== 'model' && <div className="translation-version-tabs" role="tablist" aria-label={t('译文版本')}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!showReview}
                  className={`display-chip${!showReview ? ' is-active' : ''}`}
                  onClick={() => setShowReview(false)}
                >
                  {t('机器译文')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={showReview}
                  className={`display-chip${showReview ? ' is-active' : ''}`}
                  onClick={() => setShowReview(true)}
                >
                  {t('模型润色版')}
                </button>
              </div>}
              {isLoading && !displayedTranslation ? (
                <ThinkingIndicator label={t("翻译中")} />
              ) : displayedTranslation ? (
                <div className="flow-markdown full-translation-markdown translation-text">
                  {canAnimateTranslation ? (
                    <FlowAnimatedMarkdown
                      content={animatedTranslation}
                      animation="fadeIn"
                      sep="word"
                      animationDuration="0.35s"
                      animationTimingFunction="ease-out"
                    />
                  ) : (
                    <span className="whitespace-pre-wrap">{displayedTranslation}</span>
                  )}
                </div>
              ) : (
                <p className="translation-text mb-0 whitespace-pre-wrap">
                  {translation || <span style={{ color: 'var(--ink-3)' }}>{t(provider === 'model'
                    ? '点击翻译将调用当前模型。'
                    : '点击翻译以使用所选翻译服务。')}</span>}
                </p>
              )}
              {showReview && review?.summary && <p className="tool-note">{t('模型润色说明：{0}', review.summary)}</p>}
              {provider === 'mymemory' && !showReview && (
                <p className="tool-note translation-attribution">{t('MyMemory 翻译需联网，原文会发送至该服务。')}</p>
              )}
            </div>
          ) : null}
        </AutoAnimateHeight>
      </div>

      {error && <p role="alert">{errorText(error, '翻译未完成，请重试。')}</p>}
      {reviewError && <p role="alert">{errorText(reviewError, '模型润色未完成，请重试。')}</p>}
      {fromCache && <p className="tool-note">{t('已使用缓存')}</p>}
      {actions}
    </section>
  );
}
