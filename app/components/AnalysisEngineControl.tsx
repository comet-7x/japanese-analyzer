'use client';
import { useState, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import type { AnalysisEngine } from '../lib/localAnalyzerTypes';
import { isLocalDictionaryCached } from '../services/localAnalyzer';
import SettingsConfigLayer from './SettingsConfigLayer';
import { Icon } from './Icons';
import { browserStorage } from '../utils/storage';

export const LOCAL_CONFIRMED_KEY = 'japaneseAnalyzer:localEngineConfirmed';

export default function AnalysisEngineControl({ value, disabled, onChange, onClear }: {
  value: AnalysisEngine; disabled: boolean; onChange: (value: AnalysisEngine) => void; onClear: () => void;
}) {
  const { t } = useLanguage();
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isCached, setIsCached] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void isLocalDictionaryCached().then((cached) => {
      if (active) setIsCached(cached);
    });
    return () => { active = false; };
  }, [value]);

  const handleSelectChange = async (nextValue: AnalysisEngine) => {
    if (nextValue === 'local' && value !== 'local') {
      const confirmed = browserStorage.getItem(LOCAL_CONFIRMED_KEY) === 'true';
      const cached = await isLocalDictionaryCached();
      setIsCached(cached);
      if (!confirmed && !cached) {
        setShowConfirmModal(true);
        return;
      }
    }
    onChange(nextValue);
  };

  const handleConfirmLocal = () => {
    browserStorage.setItem(LOCAL_CONFIRMED_KEY, 'true');
    setShowConfirmModal(false);
    onChange('local');
  };

  return (
    <div className="analysis-engine-control">
      <label className="analysis-engine-label">{t('解析方式')}
        <select
          className="nd-input"
          aria-label={t('解析方式')}
          value={value}
          disabled={disabled}
          onChange={(e) => handleSelectChange(e.target.value as AnalysisEngine)}
        >
          <option value="model">{t('模型解析')}</option>
          <option value="local">{t('本地解析')}</option>
        </select>
      </label>

      {value === 'local' && (
        <div className="analysis-engine-help">
          <button
            type="button"
            className="nd-ghost-btn text-xs"
            disabled={disabled}
            onClick={() => {
              browserStorage.removeItem(LOCAL_CONFIRMED_KEY);
              onClear();
              setIsCached(false);
            }}
          >
            {t('清除词典缓存')}
          </button>
        </div>
      )}

      {showConfirmModal && (
        <SettingsConfigLayer onClose={() => setShowConfirmModal(false)}>
          <div
            className="settings-config-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowConfirmModal(false);
            }}
          >
            <div
              className="settings-config-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t('启用本地解析')}
              style={{ maxWidth: '440px', width: '92%' }}
            >
              <button
                type="button"
                className="settings-modal-close-button"
                onClick={() => setShowConfirmModal(false)}
                aria-label={t('关闭')}
              >
                {Icon.x}
              </button>

              <div className="flex items-center gap-2.5 mb-3">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                </span>
                <h3 className="m-0 text-base font-semibold" style={{ color: 'var(--ink)' }}>
                  {t('启用本地解析')}
                </h3>
              </div>

              <div className="text-sm leading-6 space-y-3 mb-5" style={{ color: 'var(--ink-2)' }}>
                <p className="m-0">
                  {isCached
                    ? t('本地词典已就绪，可直接在浏览器内解析原文，无需消耗模型额度。')
                    : t('首次启用本地解析需要下载约 77 MB 的词典文件，下载完成后将保存在浏览器本地缓存中。后续无需联网下载，原文完全在浏览器内离线分词解析，无需配置模型密钥。')}
                </p>
                <p className="m-0">{t('本地分词不联网；整句自动翻译是独立的联网功能，会按所选翻译来源发送原文。')}</p>
                <div
                  className="p-3 rounded-lg text-xs"
                  style={{
                    background: 'var(--bg-2)',
                    border: '1px solid var(--line)',
                    color: 'var(--ink-3)',
                  }}
                >
                  <p className="m-0 font-medium mb-1" style={{ color: 'var(--ink-2)' }}>
                    Sudachi (Wasm) & SudachiDict Core
                  </p>
                  <p className="m-0">
                    Apache License 2.0 · Works Applications
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--line)]">
                <a
                  className="text-xs text-[var(--primary)] hover:underline flex items-center gap-1"
                  href="/local-analyzer/NOTICE.txt"
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{t('来源与许可')}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="nd-ghost-btn"
                    onClick={() => setShowConfirmModal(false)}
                  >
                    {t('取消')}
                  </button>
                  <button
                    type="button"
                    className="nd-primary-btn"
                    onClick={handleConfirmLocal}
                  >
                    {isCached ? t('确认启用') : t('确认下载并启用')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </SettingsConfigLayer>
      )}
    </div>
  );
}
