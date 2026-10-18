'use client';
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { queryDictionary } from '../services/learning';
import { type DictionarySettings as Settings, type ExternalServiceId, type DictionaryLocalizationInfo } from '../lib/dictionary';
import { useExternalLookupSettings } from '../contexts/ExternalLookupContext';
import IchiMoeOptionsPanel from './IchiMoeOptionsPanel';
import { LatestRequest } from '../utils/latestRequest';

export default function DictionarySettings({ value, onChange }: { value: Settings; onChange: (s: Settings) => void }) {
  const { t } = useLanguage();
  const [metadata, setMetadata] = useState('');
  const [infoOpen, setInfoOpen] = useState(false);
  const infoTriggerRef = useRef<HTMLDivElement | null>(null);
  const request = useRef(new LatestRequest());
  const [datasets, setDatasets] = useState<DictionaryLocalizationInfo[]>([]);
  const { services, ichiOptions, updateServices, updateIchiOptions } = useExternalLookupSettings();

  const updateService = (id: ExternalServiceId, enabled: boolean) => {
    updateServices({ ...services, enabled: { ...services.enabled, [id]: enabled } });
  };

  useEffect(() => {
    if (!infoOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (infoTriggerRef.current && !infoTriggerRef.current.contains(e.target as Node)) {
        setInfoOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInfoOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [infoOpen]);

  useEffect(() => {
    const manager = request.current;
    const controller = new AbortController();
    setMetadata('');
    setDatasets([]);
    void queryDictionary({ query: '駅' }, value.providers[0], controller.signal)
      .then((r) => {
        if (!controller.signal.aborted) {
          setMetadata(`${r.source.name} · ${r.source.date} · ${r.source.version}`);
          setDatasets(r.datasets ?? []);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setMetadata(t('词典数据不可用，请重新准备词典数据'));
        }
      });
    return () => {
      controller.abort();
      manager.cancel();
    };
  }, [value.providers, t]);

  const displayMetadata = metadata || t('正在获取词典版本…');

  return (
    <section className="dictionary-settings">
      <div className="flex items-center gap-1.5 mb-3">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
          {t('词典服务')}
        </h3>
        <div className="dictionary-info-trigger-wrap" ref={infoTriggerRef}>
          <button
            type="button"
            className="dictionary-purple-dot-btn"
            aria-label={t('词典版本信息')}
            aria-expanded={infoOpen}
            title={t('词典版本信息')}
            onClick={() => setInfoOpen((v) => !v)}
          >
            <span className="dictionary-purple-dot" />
          </button>
          <div className={`dictionary-info-popover ${infoOpen ? 'open' : ''}`} role="tooltip">
            <p className="dictionary-info-title">{displayMetadata}</p>
            <p className="dictionary-info-sub">
              {t('内置解释按界面语言显示；AI 翻译仅在点击后生成。')}
            </p>
            {datasets.length > 0 && (
              <div className="dictionary-info-datasets">
                {datasets.map((data) => (
                  <div className="dictionary-info-dataset-item" key={data.language}>
                    <p className="dictionary-info-dataset-name">
                      <a href={data.source.url} target="_blank" rel="noreferrer">
                        {data.source.name}
                      </a>{' '}
                      · {data.language} · {data.source.version}
                      {data.conversion && ` · ${t('简转繁')}`}
                    </p>
                    <p className="dictionary-info-dataset-meta">
                      {t('发布：{0} · 上游数据：{1}', data.source.date, data.upstreamDate)} ·{' '}
                      {t(
                        data.origin === 'community-machine-translation'
                          ? '社区机器译文'
                          : '词典原文'
                      )}
                      {(Date.now() - Date.parse(data.source.date) > 90 * 86400_000 ||
                        Date.now() - Date.parse(data.upstreamDate) > 180 * 86400_000) && (
                        <span> · {t('数据较旧，请通过应用更新词典。')}</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
            <p className="dictionary-info-footer">
              {t('内置词典随应用更新，运行时不下载数据。')}
            </p>
          </div>
        </div>
      </div>

      <div className="settings-card-group mb-5">
        <div className="settings-card-row">
          <div className="settings-card-row-info">
            <span className="settings-card-row-title">{value.providers[0]?.name || 'JMdict'}</span>
            <span className="settings-card-row-desc">
              {t('内置词典随应用更新，运行时不下载数据。')}
            </span>
          </div>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--ink) 6%, transparent)',
              color: 'var(--ink-3)',
            }}
          >
            {t('内置')}
          </span>
        </div>
      </div>

      <details open className="external-lookup-disclosure">
        <summary>{t('外部查询')}</summary>
        <div className="learning-fields" style={{ paddingTop: '8px' }}>
          <p className="tool-note" style={{ margin: '0 0 8px' }}>
            {t('在词卡中显示的外部服务')}
          </p>
          <div className="ichi-option-checkboxes" style={{ paddingBottom: '10px' }}>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.google)}
                onChange={(e) => updateService('google', e.target.checked)}
              />
              <span>{t('Google 翻译')}</span>
            </label>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.baidu)}
                onChange={(e) => updateService('baidu', e.target.checked)}
              />
              <span>{t('百度翻译')}</span>
            </label>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.wiktionary)}
                onChange={(e) => updateService('wiktionary', e.target.checked)}
              />
              <span>Wiktionary</span>
            </label>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.jisho)}
                onChange={(e) => updateService('jisho', e.target.checked)}
              />
              <span>Jisho</span>
            </label>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.weblio)}
                onChange={(e) => updateService('weblio', e.target.checked)}
              />
              <span>Weblio</span>
            </label>
            <label className="ichi-option-checkbox">
              <input
                type="checkbox"
                checked={Boolean(services.enabled.ichi)}
                onChange={(e) => updateService('ichi', e.target.checked)}
              />
              <span>ichi.moe</span>
            </label>
          </div>

          {services.enabled.ichi && (
            <IchiMoeOptionsPanel value={ichiOptions} onChange={updateIchiOptions} defaultOpen />
          )}
        </div>
      </details>
      <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer" className="tool-note mt-3 inline-block">
        JMdict / EDRDG · CC BY-SA 4.0
      </a>
    </section>
  );
}
