'use client';

import { useLanguage } from '../contexts/LanguageContext';
import type { IchiMoeOptions, IchiRomanizationMethod } from '../lib/dictionary';

export default function IchiMoeOptionsPanel({ value, onChange, defaultOpen = false }: {
  value: IchiMoeOptions;
  onChange: (value: IchiMoeOptions) => void;
  defaultOpen?: boolean;
}) {
  const { t } = useLanguage();
  return <details className="ichi-options-disclosure" open={defaultOpen || undefined}>
    <summary className="ichi-options-summary">{t('ichi.moe 选项')}</summary>
    <div className="ichi-options-panel">
      <label className="ichi-option-row">
        <span className="ichi-option-label">{t('罗马字格式')}</span>
        <select className="learning-input ichi-select" aria-label={t('罗马字格式')} value={value.r || 'htr'}
          onChange={e => onChange({ ...value, r: e.target.value as IchiRomanizationMethod })}>
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
          <input type="checkbox" checked={Boolean(value.hira)} onChange={e => onChange({ ...value, hira: e.target.checked })} />
          <span>{t('片假名转平假名')}</span>
        </label>
        <label className="ichi-option-checkbox">
          <input type="checkbox" checked={Boolean(value.noseg)} onChange={e => onChange({ ...value, noseg: e.target.checked })} />
          <span>{t('不分词（仅假名）')}</span>
        </label>
      </div>
    </div>
  </details>;
}
