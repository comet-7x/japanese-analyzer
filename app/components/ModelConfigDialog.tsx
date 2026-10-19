'use client';

import { useEffect, useRef, useState } from 'react';
import SettingsConfigLayer from './SettingsConfigLayer';
import { useLanguage } from '../contexts/LanguageContext';
import { getModelPreferences, isTokenLimit, supportsImageInput, type ModelCaps, type ModelConfig, type ProviderProfile, type StructuredOutputMode } from '../lib/aiModels';
import { ConfigAdvanced, ConfigInputTypes, ConfigField, ConfigToggle } from './ModelConfigFields';
import { Icon } from './Icons';
import { testProviderConnection, type ProviderConnectionResult } from '../lib/providerConnection';
import { LatestRequest } from '../utils/latestRequest';

interface ModelConfigDialogProps {
  service: ProviderProfile;
  model: ModelConfig;
  onSave: (serviceId: string, modelId: string, patch: Partial<ModelConfig>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ModelConfigDialog({ service, model, onSave, onDelete, onClose }: ModelConfigDialogProps) {
  const { t, locale, errorText } = useLanguage();
  const initial = () => ({
    name: model.name, model: model.model,
    contextWindow: model.caps?.contextWindow?.toString() ?? '',
    maxOutputTokens: model.caps?.maxOutputTokens?.toString() ?? '',
    vision: supportsImageInput(model.model, model.caps),
    thinking: model.caps?.thinking === true,
    structuredOutput: model.caps?.structuredOutput ?? 'json_object' as StructuredOutputMode,
    reasoningEffort: model.caps?.reasoningEffort ?? '',
    ...getModelPreferences(model),
  });
  const [draft, setDraft] = useState(initial);
  const [detecting, setDetecting] = useState(false);
  const [detection, setDetection] = useState<ProviderConnectionResult | null>(null);
  const [detectionError, setDetectionError] = useState('');
  const detectionRequest = useRef(new LatestRequest());
  useEffect(() => {
    setDetection(null); setDetectionError(''); setDetecting(false);
    const request = detectionRequest.current;
    return () => request.cancel();
  }, [service.baseUrl, service.apiKey, locale]);
  const resetDetection = () => {
    detectionRequest.current.cancel(); setDetection(null); setDetectionError(''); setDetecting(false);
  };
  const update = (patch: Partial<typeof draft>) => {
    if (patch.model !== undefined && patch.model.trim() !== draft.model.trim()) resetDetection();
    setDraft(previous => ({ ...previous, ...patch }));
  };
  const limitValid = (value: string) => value === '' || /^\d+$/.test(value) && isTokenLimit(Number(value));
  const validLimits = limitValid(draft.contextWindow) && limitValid(draft.maxOutputTokens);
  const validRange = !draft.contextWindow || !draft.maxOutputTokens || Number(draft.maxOutputTokens) < Number(draft.contextWindow);
  const valid = Boolean(draft.model.trim() && validLimits && validRange);

  const getDraftCaps = (): ModelCaps => {
    const caps: ModelCaps = { thinking: draft.thinking, structuredOutput: draft.structuredOutput, vision: draft.vision };
    if (draft.contextWindow) caps.contextWindow = Number(draft.contextWindow);
    if (draft.maxOutputTokens) caps.maxOutputTokens = Number(draft.maxOutputTokens);
    if (draft.thinking && draft.reasoningEffort.trim()) caps.reasoningEffort = draft.reasoningEffort.trim();
    return caps;
  };
  const handleSave = () => {
    if (!valid || detecting || detection?.structuredOutput === 'unsupported') return;
    const caps = getDraftCaps();
    onSave(service.id, model.id, {
      model: draft.model.trim(), name: draft.name.trim() || draft.model.trim(), caps,
      preferences: { stream: draft.stream, thinkingEnabled: draft.thinking && draft.thinkingEnabled },
    });
    onClose();
  };

  const detectSupport = async () => {
    const ticket = detectionRequest.current.start();
    setDetecting(true); setDetection(null); setDetectionError('');
    try {
      const result = await testProviderConnection({ ...service, models: [{ ...model, model: draft.model.trim(), caps: getDraftCaps() }] }, draft.model, locale, ticket.signal);
      if (!ticket.isCurrent()) return;
      setDetection(result);
      if (result.structuredOutput !== 'unsupported') setDraft(previous => ({ ...previous, structuredOutput: result.structuredOutput as StructuredOutputMode }));
    } catch (error) {
      if (ticket.isCurrent()) setDetectionError(errorText(error instanceof Error ? error.message : '暂时无法完成，请重试。'));
    } finally {
      if (ticket.isCurrent()) setDetecting(false);
    }
  };

  return <SettingsConfigLayer onClose={onClose}>
    <div className="settings-config-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="settings-config-dialog model-config-dialog" role="dialog" aria-modal="true" aria-label={t('模型设置')}
        onSubmit={event => { event.preventDefault(); handleSave(); }}>
        <header className="model-config-header">
          <button type="button" className="settings-modal-close-button" onClick={onClose} aria-label={t('关闭设置')}>{Icon.x}</button>
          <h3>{t('模型设置')}</h3>
          <p className="model-config-hint">{t('属于「{0}」下的模型。', service.name || service.id)}</p>
        </header>
        <div className="model-config-body model-config-fields">
          <ConfigField id="modelCfgDisplayName" label={t('显示名称')}>
            <input id="modelCfgDisplayName" className="nd-input" value={draft.name} placeholder={draft.model}
              onChange={event => update({ name: event.target.value })} />
          </ConfigField>
          <ConfigField id="modelCfgName" label={t('模型 ID')} hint={t('填写服务商提供的模型标识，展示名称可自行设置。')}>
            <input id="modelCfgName" className="nd-input" value={draft.model} placeholder="deepseek-chat" required
              onChange={event => update({ model: event.target.value,
                ...(event.target.value.trim() !== draft.model.trim() ? { vision: supportsImageInput(event.target.value.trim()), structuredOutput: 'json_object' } : {}),
              })} />
          </ConfigField>
          <div className="model-config-grid">
            <ConfigField id="modelCfgContext" label={t('上下文窗口')} hint={t('可选，按模型文档填写 token 数。')}>
              <input id="modelCfgContext" className="nd-input" type="number" min="1" step="1" value={draft.contextWindow}
                placeholder={t('服务商默认')} onChange={event => update({ contextWindow: event.target.value })} aria-invalid={!limitValid(draft.contextWindow)} />
            </ConfigField>
            <ConfigField id="modelCfgMaxOutput" label={t('最大输出 Token')} hint={t('作为请求上限；短任务仍会使用更小的额度。')}>
              <input id="modelCfgMaxOutput" className="nd-input" type="number" min="1" step="1" value={draft.maxOutputTokens}
                placeholder={t('服务商默认')} onChange={event => update({ maxOutputTokens: event.target.value })} aria-invalid={!limitValid(draft.maxOutputTokens) || !validRange} />
            </ConfigField>
          </div>
          {(!validLimits || !validRange) && <p className="model-config-error" role="alert">{t('Token 数须为正整数，最大输出须小于上下文窗口。')}</p>}
          <ConfigAdvanced>
            <ConfigInputTypes vision={draft.vision} onVisionChange={vision => update({ vision })} />
            <section className="model-output-support" aria-label={t('结构化输出')}>
              <div className="model-output-heading">
                <span className="model-config-label">{t('结构化输出')}</span>
                <button type="button" className="nd-soft-btn" onClick={detectSupport} disabled={detecting || !valid || !service.baseUrl.trim() || !service.apiKey.trim()}>
                  {detecting ? t('检测中…') : t('检测接口支持')}
                </button>
              </div>
              <p className="model-config-hint">{t('自动识别接口支持的格式，无需手动选择。')}</p>
              {detection?.structuredOutput === 'unsupported' ? <p role="alert" className="model-config-error">{t('此接口未检测到结构化输出支持，请更换模型或接口。')}</p>
                : <div className="model-output-result" role="status">
                  <span>{detection ? t('检测通过') : t('当前配置')}</span>
                  <strong>{draft.structuredOutput === 'json_schema' ? t('严格格式') : t('兼容格式')}</strong>
                  <p>{draft.structuredOutput === 'json_schema' ? t('接口约束结果字段和类型，应用再检查内容。') : t('接口返回 JSON 格式，应用检查结果字段和内容。')}</p>
                </div>}
              {detectionError && <p role="alert" className="model-config-error">{detectionError}</p>}
              <p className="model-config-hint">{t('检测会发送少量测试请求，可能产生少量费用。')}</p>
              {(!service.baseUrl.trim() || !service.apiKey.trim()) && <p className="model-config-hint">{t('填写基础地址、API 密钥和模型后即可测试。')}</p>}
            </section>
            <ConfigToggle label={t('流式输出')} hint={t('实时显示解析结果，网络不稳定时可关闭。')} checked={draft.stream} onChange={stream => update({ stream })} />
            <ConfigToggle label={t('支持思考 / 推理参数')} hint={t('开启后该模型可启用「深度思考」。')} checked={draft.thinking}
              onChange={thinking => update({ thinking, ...(!thinking ? { thinkingEnabled: false } : {}) })} />
            {draft.thinking && <>
              <ConfigToggle label={t('深度思考')} hint={t('解析前先让模型展开推理。')} checked={draft.thinkingEnabled} onChange={thinkingEnabled => update({ thinkingEnabled })} />
              <ConfigField id="modelCfgEffort" label={t('思考强度（reasoning_effort，可选）')} hint={t('不同服务商接受的值不同，请按该服务商文档填写。')}>
                <input id="modelCfgEffort" className="nd-input" value={draft.reasoningEffort} placeholder={t('如 xhigh / medium / low；留空用服务商默认')}
                  onChange={event => update({ reasoningEffort: event.target.value })} />
              </ConfigField>
            </>}
            <p className="model-config-hint">{t('以上选项仅作用于此模型，切换模型时自动切换。')}</p>
          </ConfigAdvanced>
        </div>
        <footer className="settings-actions model-config-actions">
          <button type="button" className="nd-ghost-btn model-config-reset" onClick={() => { resetDetection(); setDraft(initial()); }}>{t('重置表单')}</button>
          {onDelete && <button type="button" className="nd-ghost-btn provider-danger" onClick={onDelete}>{t('删除此模型')}</button>}
          <button type="button" className="nd-ghost-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="nd-primary-btn" disabled={!valid || detecting || detection?.structuredOutput === 'unsupported'}>{t('保存')}</button>
        </footer>
      </form>
    </div>
  </SettingsConfigLayer>;
}
