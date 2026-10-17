'use client';
import { useLanguage } from '../contexts/LanguageContext';
import type { AnalysisEngine } from '../lib/localAnalyzerTypes';

export default function AnalysisEngineControl({ value, disabled, onChange, onClear }: {
  value: AnalysisEngine; disabled: boolean; onChange: (value: AnalysisEngine) => void; onClear: () => void;
}) {
  const { t } = useLanguage();
  return <div className="analysis-engine-control">
    <label className="analysis-engine-label">{t('解析方式')}
      <select className="nd-input" aria-label={t('解析方式')} value={value} disabled={disabled} onChange={e => onChange(e.target.value as AnalysisEngine)}>
        <option value="model">{t('模型解析')}</option>
        <option value="local">{t('本地解析')}</option>
      </select>
    </label>
    {value === 'local' && <div className="analysis-engine-help">
      <span className="tool-note">{t('首次使用下载约 77 MB 词典，之后使用本地缓存。原文在浏览器内解析，无需模型密钥。')}</span>
      <button type="button" className="nd-ghost-btn" disabled={disabled} onClick={onClear}>{t('清除词典缓存')}</button>
      <a className="nd-ghost-btn" href="/local-analyzer/NOTICE.txt" target="_blank" rel="noreferrer">{t('来源与许可')}</a>
    </div>}
  </div>;
}
