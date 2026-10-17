'use client';

import { useLanguage } from '../contexts/LanguageContext';
import { useState, useEffect, useMemo } from 'react';
import { useSentenceTranslation } from '../hooks/useSentenceTranslation';
import type { EndpointPayload } from '../services/api';
import ThinkingIndicator from './ThinkingIndicator';
import { Icon } from './Icons';
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
  automatic?: boolean;
  onConfigureModel?: () => void;
  settings: TranslationServiceSettings;
  onProviderChange: (provider: TranslationProviderId) => void;
  thinkingEnabled?: boolean;
}

export default function TranslationSection({
  japaneseText,
  userApiKey,
  endpoint,
  useStream = true, // 默认为true，保持向后兼容
  trigger,
  analysisSignal,
  automatic = true,
  onConfigureModel,
  settings,
  onProviderChange,
  thinkingEnabled = false,
}: TranslationSectionProps) {
  const { t, locale, errorText } = useLanguage();
  const provider = settings.preferredProvider;
  const { translation, review, displayedTranslation, showReview, setShowReview, error, reviewError,
    isLoading, isReviewing, fromCache, translate, reviewTranslation } = useSentenceTranslation({
    text: japaneseText, endpoint, apiKey: userApiKey, locale, useStream, trigger: automatic ? trigger : 0, analysisSignal,
    provider, settings, thinkingEnabled,
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

    if (!isLoading || displayedTranslation.length >= 16 || /[。！？.!?，,、\n]/.test(displayedTranslation)) {
      setCanAnimateTranslation(true);
    }
  }, [isLoading, displayedTranslation]);

  const actions = (
    <div className="translation-actions flex items-center gap-1">
      <label className="sr-only" htmlFor="translationProvider">{t('翻译来源')}</label>
      <select id="translationProvider" className="translation-provider-select" value={provider}
        onChange={event => onProviderChange(event.target.value as TranslationProviderId)} disabled={isLoading || isReviewing}>
        <option value="model">{t('当前模型')}</option>
        <option value="google">Google</option>
        <option value="baidu">{t('百度')}</option>
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
        <button className="nd-ghost-btn" disabled={isReviewing || !endpoint.model}
          onClick={() => { if (!endpoint.model) { onConfigureModel?.(); return; } void reviewTranslation(true); }}>
          {Icon.refresh}<span>{t(isReviewing ? '复核中…' : review ? '重新用模型复核' : '用当前模型复核')}</span>
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
    <section id="fullTranslationCard" className="translation-section" data-collapsed={!isVisible}>
      {/* 译文紧跟原句，标题只留给读屏；操作按钮悬停时出现 */}
      <h2 className="sr-only">{t("中文译文")}</h2>

      <div id="translationContent">
        {/* 包含子元素的外边距，避免高度测量遗漏译文顶部间距。 */}
        <AutoAnimateHeight duration={300} contentClassName="flow-root">
          {isVisible ? (
            <div className="translation-scroll-region flow-root" role="region" aria-label={t("中文译文正文")} tabIndex={0}>
              {review && provider !== 'model' && <div className="translation-version-tabs" role="tablist" aria-label={t('译文版本')}>
                <button role="tab" aria-selected={!showReview} className="display-chip" onClick={() => setShowReview(false)}>{t('机器译文')}</button>
                <button role="tab" aria-selected={showReview} className="display-chip" onClick={() => setShowReview(true)}>{t('模型复核版')}</button>
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
                  {translation || <span style={{ color: 'var(--ink-3)' }}>{t(automatic && provider === 'model'
                    ? '解析后将自动翻译。'
                    : provider === 'model' ? '点击翻译时将调用当前模型。' : '点击翻译以使用所选翻译来源。')}</span>}
                </p>
              )}
              {showReview && review?.summary && <p className="tool-note">{t('模型复核说明：{0}', review.summary)}</p>}
            </div>
          ) : null}
        </AutoAnimateHeight>
      </div>

      {error && <p role="alert">{t("翻译时发生错误: {0}。", errorText(error))}</p>}
      {reviewError && <p role="alert">{t('模型复核失败：{0}', errorText(reviewError))}</p>}
      {fromCache && <p className="tool-note">{t('已使用缓存')}</p>}
      {actions}
    </section>
  );
}
