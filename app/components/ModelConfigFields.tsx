'use client';

import type { ReactNode } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Switch } from '@/components/ui/switch';
import { Icon } from './Icons';

/** Shared form hierarchy for analysis models and speech models. */
export function ConfigField({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return <div className="model-config-field">
    <label htmlFor={id}>{label}</label>
    {children}
    {hint && <p className="model-config-hint" id={`${id}-hint`}>{hint}</p>}
  </div>;
}

export function ConfigAdvanced({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  return <details className="model-config-advanced" open>
    <summary>{t('高级配置')}</summary>
    <div className="model-config-fields">{children}</div>
  </details>;
}

export function ConfigToggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="model-config-toggle">
    <div><span className="model-config-label">{label}</span><p className="model-config-hint">{hint}</p></div>
    <Switch aria-label={label} checked={checked} onCheckedChange={onChange} />
  </div>;
}

export function ConfigInputTypes({ vision, onVisionChange }: { vision?: boolean; onVisionChange?: (value: boolean) => void }) {
  const { t } = useLanguage();
  return <fieldset className="model-input-types">
    <legend className="model-config-label">{t('输入类型')}</legend>
    <div className="model-input-list">
      <div className="model-input-row" data-enabled="true">
        <span className="model-input-icon" aria-hidden="true">{Icon.text}</span>
        <div className="model-input-info"><span className="model-config-label">{t('文本')}</span><p className="model-config-hint">{t('输入或粘贴日语原文。')}</p></div>
        <span className="model-input-status">{Icon.check}{t('默认支持')}</span>
      </div>
      {onVisionChange && <div className="model-input-row" data-enabled={vision === true}>
        <span className="model-input-icon" aria-hidden="true">{Icon.photo}</span>
        <div className="model-input-info"><span className="model-config-label">{t('图片')}</span><p id="model-input-image-hint" className="model-config-hint">{t('识别截图与照片中的日文，仅限多模态模型。')}</p></div>
        <Switch aria-label={t('支持图片输入（多模态）')} aria-describedby="model-input-image-hint" checked={vision === true} onCheckedChange={onVisionChange} />
      </div>}
    </div>
  </fieldset>;
}
