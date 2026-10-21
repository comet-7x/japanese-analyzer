'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { localizeError } from '../../i18n';
import { Icon } from '../../components/Icons';
import Live2DSlider from './Live2DSlider';
import Live2DScrollFeedback from './Live2DScrollFeedback';
import './workbench.css';
import Live2DActionEditor from './Live2DActionEditor';
import type { Live2DCapabilities } from './capabilities';
import {
  importLive2DModel,
  getLive2DModelCapabilities,
  listLive2DModels,
  removeLive2DModel,
  type StoredLive2DModel,
} from './modelLibrary';
import { LIVE2D_SCALE, LIVE2D_SENSITIVITY, selectLive2DModel, updateLive2DModelConfig, removeLive2DModelConfig, type Live2DSettings } from './settings';

interface Props {
  value: Live2DSettings;
  onChange: (settings: Live2DSettings) => void;
  onModelDeleted: (id: string) => void;
}

function modelPaths(error: unknown): string[] {
  if (!error || typeof error !== 'object' || !('modelPaths' in error)) return [];
  const paths = (error as { modelPaths?: unknown }).modelPaths;
  return Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [];
}

function Toggle({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void;
}) {
  return <label className="live2d-settings-switch">
    <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
    <span className="live2d-toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="live2d-toggle-track" aria-hidden="true" />
    </span>
  </label>;
}


export default function Live2DSettingsPanel({ value, onChange, onModelDeleted }: Props) {
  const { t, locale } = useLanguage();
  const valueRef = useRef(value);
  valueRef.current = value;
  const [models, setModels] = useState<StoredLive2DModel[]>([]);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'role' | 'resources' | 'rules'>('role');
  const manageButton = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState<{ file: File; paths: string[] } | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [detection, setDetection] = useState<{ id: string; report: Live2DCapabilities | null; error: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [scrollTarget, setScrollTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setScrollTarget(panelRef.current?.closest<HTMLElement>('.settings-tab-pane') ?? null); }, []);

  const reload = useCallback(async () => {
    try {
      setModels(await listLive2DModels());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('无法读取本地角色模型。'));
    }
  }, [t]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const id = value.modelId;
    if (!id) return;
    let cancelled = false;
    void getLive2DModelCapabilities(id).then(report => {
      if (!cancelled) setDetection({ id, report, error: !report });
    }).catch(() => { if (!cancelled) setDetection({ id, report: null, error: true }); });
    return () => { cancelled = true; };
  }, [value.modelId]);

  const update = (patch: Partial<Live2DSettings>) => onChange({ ...valueRef.current, ...patch });

  const importFile = async (file: File, path?: string) => {
    setBusy(true);
    setError('');
    try {
      const model = await importLive2DModel(file, path ? { modelPath: path } : undefined);
      await reload();
      onChange({ ...selectLive2DModel(valueRef.current, model.id), enabled: true });
      setCandidate(null);
      setSelectedPath('');
      window.dispatchEvent(new Event('live2d:models-changed'));
    } catch (cause) {
      const paths = modelPaths(cause);
      if (paths.length > 1) {
        setCandidate({ file, paths });
        setSelectedPath(paths[0]);
      } else {
        setError(cause instanceof Error ? cause.message : t('导入角色模型失败。'));
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (model: StoredLive2DModel) => {
    if (!window.confirm(t('删除此角色模型及其本地文件？'))) return;
    setBusy(true);
    setError('');
    try {
      await removeLive2DModel(model.id);
      onModelDeleted(model.id);
      onChange(removeLive2DModelConfig(valueRef.current, model.id));
      await reload();
      window.dispatchEvent(new Event('live2d:models-changed'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('删除角色模型失败。'));
    } finally {
      setBusy(false);
    }
  };

  const navigation = <nav className="live2d-workbench-nav" aria-label={t('角色工作台')}>
    {(['role', 'resources', 'rules'] as const).map((id, index) => <button key={id} type="button" className="nd-ghost-btn" aria-current={view === id ? 'page' : undefined} disabled={id !== 'role' && (!value.modelId || !detection?.report || detection.id !== value.modelId)} onClick={() => setView(id)}>{t(['角色', '动作与表情', '互动设置'][index])}</button>)}
  </nav>;

  if (view !== 'role' && value.modelId && detection?.id === value.modelId && detection.report) return <div className="live2d-workbench" data-open="true">
    <div className="live2d-workbench-top"><button type="button" className="nd-ghost-btn" onClick={() => setView('role')}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>{t('返回角色设置')}</button>
    <label>{t('当前角色')}<select className="nd-input" value={value.modelId} onChange={event => onChange(selectLive2DModel(valueRef.current, event.target.value))}>{models.map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label></div>
    {navigation}<Live2DActionEditor
    view={view} key={value.modelId} modelId={value.modelId} capabilities={detection.report}
    value={value.modelConfigs[value.modelId]?.interaction}
    onChange={interaction => onChange(updateLive2DModelConfig(valueRef.current, value.modelId, { interaction }))}
    onBack={() => { setView('role'); requestAnimationFrame(() => manageButton.current?.focus()); }}
  /></div>;

  return (
    <div className="live2d-settings" ref={panelRef}>
      {scrollTarget && <Live2DScrollFeedback target={scrollTarget} ownerId="live2d-settings-scroll" label={t('滚动 Live2D 设置')} />}
      <div className="live2d-settings-heading">
        <h3>{t('虚拟角色服务')}</h3>
        <p>{t('模型文件仅保存在此设备的浏览器存储中。')}</p>
      </div>

      <Toggle label={t('启用看板娘')} description={t('直接拖动角色调整位置，脚下的胶囊可聊天、朗读和设置。')}
        checked={value.enabled} onChange={enabled => update({ enabled })} />

      <section className="live2d-settings-section">
        <h4>{t('角色模型')}</h4>
        <p>{t('导入包含 .model3.json、.moc3 和纹理的 ZIP 文件。')}</p>
        <label className="live2d-import-button">
          {Icon.plus}
          {busy ? t('正在处理…') : t('导入模型 ZIP')}
          <input
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
        </label>
        {candidate && (
          <div className="live2d-model-choice">
            <label htmlFor="live2d-model-path">{t('压缩包包含多个模型，请选择主模型：')}</label>
            <select id="live2d-model-path" value={selectedPath} onChange={(event) => setSelectedPath(event.target.value)}>
              {candidate.paths.map((path) => <option key={path} value={path}>{path}</option>)}
            </select>
            <button type="button" className="nd-ghost-btn" disabled={busy} onClick={() => void importFile(candidate.file, selectedPath)}>{t('导入所选模型')}</button>
          </div>
        )}
        {models.length > 0 ? (
          <div className="live2d-model-list">
            {models.map((model) => (
              <div className="live2d-model-row" key={model.id}>
                <label>
                  <input
                    type="radio"
                    name="live2d-model"
                    checked={value.modelId === model.id}
                    onChange={() => onChange(selectLive2DModel(valueRef.current, model.id))}
                  />
                  <span><strong>{model.name}</strong><small>{model.modelPath}</small></span>
                </label>
                <button type="button" className="nd-ghost-btn" disabled={busy} onClick={() => void remove(model)}>{Icon.trash}{t('删除')}</button>
              </div>
            ))}
          </div>
        ) : <p className="live2d-settings-empty">{t('尚未导入角色模型。')}</p>}
        {error && <p className="live2d-settings-error" role="alert">{localizeError(error, locale)}</p>}
      </section>

      {navigation}
      {value.modelId && <section className="live2d-settings-section">
        {detection?.id !== value.modelId ? <p role="status">{t('正在检测模型能力…')}</p>
          : detection.report ? <><p>{t('已发现 {0} 个动作、{1} 个表情', detection.report.actions.filter(item => item.kind === 'motion').length, detection.report.expressions.length)}</p>
            <button ref={manageButton} type="button" className="nd-ghost-btn" onClick={() => setView('resources')}>{t('管理角色')}</button>
            <p>{t('先预览效果，再设置平时播放、点击互动和伴学反馈。')}</p></>
          : <p className="live2d-settings-error" role="status">{t('无法检测模型能力，请重新选择模型。')}</p>}
      </section>}

      <section className="live2d-settings-section">
        <h4>{t('朗读联动')}</h4>
        <Toggle label={t('口型跟随语音')} description={t('朗读时按实际音量驱动嘴部开合。')}
          checked={value.lipSync} onChange={lipSync => update({ lipSync })} />
        <label className="live2d-settings-slider">
          <span>{t('口型灵敏度')} <strong>{value.sensitivity.toFixed(1)}×</strong></span>
          <Live2DSlider min={LIVE2D_SENSITIVITY.min} max={LIVE2D_SENSITIVITY.max} step="0.1" value={value.sensitivity} onValueChange={sensitivity => onChange(updateLive2DModelConfig(valueRef.current, valueRef.current.modelId, { sensitivity }))} />
        </label>
      </section>

      <section className="live2d-settings-section">
        <h4>{t('显示')}</h4>
        <Toggle label={t('闲置时暂停动画')} description={t('闲置 8 秒后保持静止，操作或朗读时恢复。')}
          checked={value.pauseWhenIdle} onChange={pauseWhenIdle => update({ pauseWhenIdle })} />
        <Toggle label={t('视线跟随指针')} checked={value.trackPointer} onChange={trackPointer => update({ trackPointer })} />
        <label className="live2d-settings-slider">
          <span>{t('角色大小')} <strong>{value.scale.toFixed(2)}×</strong></span>
          <small>{t('窗口随角色大小调整，最大不超过当前屏幕。')}</small>
          <Live2DSlider min={LIVE2D_SCALE.min} max={LIVE2D_SCALE.max} step="0.01" value={value.scale} onValueChange={scale => onChange(updateLive2DModelConfig(valueRef.current, valueRef.current.modelId, { scale }))} />
        </label>
        <label className="live2d-settings-slider">
          <span>{t('透明度')} <strong>{Math.round(value.opacity * 100)}%</strong></span>
          <Live2DSlider min={0.3} max={1} step="0.05" value={value.opacity} onValueChange={opacity => update({ opacity })} />
        </label>
      </section>
    </div>
  );
}
