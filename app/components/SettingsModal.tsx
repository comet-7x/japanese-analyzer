'use client';

import { useLanguage } from '../contexts/LanguageContext';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PRESETS,
  createCustomModelId,
  createCustomProfileId,
  resolveModelSelection,
  sanitizeProfiles,
  type ModelConfig,
  type ProviderProfile,
} from '../lib/aiModels';
import ModelConfigDialog from './ModelConfigDialog';
import ProviderConfigDialog from './ProviderConfigDialog';
import { Icon } from './Icons';
import { ProviderLogo } from './ProviderLogo';
import { Switch } from '@/components/ui/switch';
import SpeechServices from './SpeechServices';
import DictionarySettings from './DictionarySettings';
import TranslationSettings from './TranslationSettings';
import { isValidMyMemoryEmail, readTranslationServiceSettings, type TranslationServiceSettings } from '../lib/translationServices';
import SettingsConfigLayer from './SettingsConfigLayer';
import type { DictionarySettings as DictionarySettingsValue } from '../lib/dictionary';
import { sanitizeSpeechSettings, type SpeechSettings } from '../lib/speechServices';

export type SettingsTabId = 'models' | 'analysis' | 'translation' | 'dictionary' | 'speech';

interface SettingsPayload {
  translationSettings: TranslationServiceSettings;
  dictionarySettings: DictionarySettingsValue;
  services: ProviderProfile[];
  activeServiceId: string;
  activeModelId: string;
  geminiApiKey: string;
  speechSettings: SpeechSettings;
  thinkingEnabled: boolean;
  useStream: boolean;
}

interface SettingsModalProps {
  translationSettings: TranslationServiceSettings;
  dictionarySettings: DictionarySettingsValue;
  services: ProviderProfile[];
  activeServiceId: string;
  activeModelId: string;
  geminiApiKey: string;
  speechSettings: SpeechSettings;
  thinkingEnabled: boolean;
  useStream: boolean;
  onSaveSettings: (settings: SettingsPayload) => void;
  isModalOpen: boolean;
  onModalClose: () => void;
}

function emptyService(): ProviderProfile {
  return {
    id: createCustomProfileId(),
    name: '',
    baseUrl: '',
    apiKey: '',
    models: [{ id: createCustomModelId(), name: '', model: '', caps: { structuredOutput: 'json_object' } }],
  };
}

function fromPreset(presetId: string): ProviderProfile | null {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  return {
    id: createCustomProfileId(),
    name: preset.name,
    baseUrl: preset.baseUrl,
    apiKey: '',
    models: preset.models.map((m) => ({ ...m, id: createCustomModelId(), caps: m.caps ? { ...m.caps } : undefined })),
  };
}

interface SettingsSignatureInput {
  translation: TranslationServiceSettings;
  services: ProviderProfile[];
  activeServiceId: string;
  activeModelId: string;
  dictionary: DictionarySettingsValue;
  speech: SpeechSettings;
  thinking: boolean;
  stream: boolean;
}

const getSettingsSignature = (input: SettingsSignatureInput) => {
  return JSON.stringify({
    services: sanitizeProfiles(input.services),
    activeServiceId: input.activeServiceId,
    activeModelId: input.activeModelId,
    dictionary: input.dictionary,
    translation: input.translation,
    speech: sanitizeSpeechSettings(input.speech),
    thinking: input.thinking,
    stream: input.stream,
  });
};

export default function SettingsModal({
  translationSettings: initialTranslationSettings,
  dictionarySettings: initialDictionarySettings,
  services: initialServices,
  activeServiceId: initialActiveServiceId,
  activeModelId: initialActiveModelId,
  geminiApiKey,
  speechSettings: initialSpeechSettings,
  thinkingEnabled: initialThinkingEnabled,
  useStream,
  onSaveSettings,
  isModalOpen,
  onModalClose
}: SettingsModalProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<SettingsTabId>('models');
  const [dictionarySettings, setDictionarySettings] = useState(initialDictionarySettings);
  const [translationSettings, setTranslationSettings] = useState(initialTranslationSettings);
  const [services, setServices] = useState<ProviderProfile[]>(initialServices);
  const [activeServiceId, setActiveServiceId] = useState(initialActiveServiceId);
  const [activeModelId, setActiveModelId] = useState(initialActiveModelId);
  const [collapsedServiceIds, setCollapsedServiceIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [speechSettings, setSpeechSettings] = useState(initialSpeechSettings);
  const [thinkingEnabled, setThinkingEnabled] = useState(initialThinkingEnabled);
  const [streamEnabled, setStreamEnabled] = useState(useStream);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [defaultMenuOpen, setDefaultMenuOpen] = useState(false);
  const [editingService, setEditingService] = useState<ProviderProfile | null>(null);
  const [editingServiceMode, setEditingServiceMode] = useState<'create' | 'edit'>('edit');
  const [editingModel, setEditingModel] = useState<{ serviceId: string; model: ModelConfig; isNew: boolean } | null>(null);
  const [menuServiceId, setMenuServiceId] = useState<string | null>(null);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [savedSignature, setSavedSignature] = useState('');
  const defaultMenuRef = useRef<HTMLDivElement | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);


  const { service: activeService, model: activeModel } = useMemo(
    () => resolveModelSelection(services, activeServiceId, activeModelId),
    [services, activeServiceId, activeModelId]
  );
  const editingModelItem = useMemo(() => {
    if (!editingModel) return null;
    const service = services.find((s) => s.id === editingModel.serviceId);
    const model = editingModel.model;
    return service && model ? { service, model } : null;
  }, [services, editingModel]);

  const currentSignature = useMemo(() => {
    return getSettingsSignature({
      services,
      activeServiceId,
      activeModelId,
      dictionary: dictionarySettings,
      translation: translationSettings,
      speech: speechSettings,
      thinking: thinkingEnabled,
      stream: streamEnabled,
    });
  }, [services, activeServiceId, activeModelId, dictionarySettings, translationSettings, speechSettings, thinkingEnabled, streamEnabled]);

  const hasUnsavedChanges = Boolean(savedSignature && currentSignature !== savedSignature);

  // 打开弹窗时重置本地编辑态：默认展开当前服务商
  useEffect(() => {
    if (!isModalOpen) return;
    setDictionarySettings(initialDictionarySettings);
    setTranslationSettings(initialTranslationSettings);
    setServices(initialServices);
    setActiveServiceId(initialActiveServiceId);
    setActiveModelId(initialActiveModelId);
    const first = initialServices.find((s) => s.id === initialActiveServiceId) ?? initialServices[0] ?? null;
    setCollapsedServiceIds(initialServices.filter((s) => first && s.id !== first.id).map((s) => s.id));
    setSearchQuery('');
    setSpeechSettings(initialSpeechSettings);
    setThinkingEnabled(initialThinkingEnabled);
    setStreamEnabled(useStream);
    setStatus('');
    setError('');
    setDefaultMenuOpen(false);
    setEditingService(null);
    setEditingModel(null);
    setMenuServiceId(null);
    setShowUnsavedPrompt(false);
    setSavedSignature(
      getSettingsSignature({
        services: initialServices,
        activeServiceId: initialActiveServiceId,
        activeModelId: initialActiveModelId,
        dictionary: initialDictionarySettings,
        translation: initialTranslationSettings,
        speech: initialSpeechSettings,
        thinking: initialThinkingEnabled,
        stream: useStream,
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen]);

  // 点击外部 / Esc 关闭默认模型菜单与行内菜单
  useEffect(() => {
    if (!defaultMenuOpen && !menuServiceId) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (defaultMenuRef.current && !defaultMenuRef.current.contains(e.target as Node)) setDefaultMenuOpen(false);
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target as Node)) setMenuServiceId(null);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDefaultMenuOpen(false);
        setMenuServiceId(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [defaultMenuOpen, menuServiceId]);

  const requestClose = () => {
    if (hasUnsavedChanges) {
      setShowUnsavedPrompt(true);
    } else {
      onModalClose();
    }
  };

  // 弹窗层级的 Esc 键拦截处理
  useEffect(() => {
    if (!isModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (editingService || editingModel || menuServiceId || defaultMenuOpen) return;
      if (showUnsavedPrompt) {
        setShowUnsavedPrompt(false);
        return;
      }
      requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModalOpen, editingService, editingModel, menuServiceId, defaultMenuOpen, showUnsavedPrompt, hasUnsavedChanges]);

  const handleOutsideClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) requestClose();
  };

  const updateService = (id: string, patch: Partial<ProviderProfile>) => {
    setServices((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const updateModel = (serviceId: string, modelId: string, patch: Partial<ModelConfig>) => {
    setServices((list) => list.map((s) => s.id === serviceId
      ? { ...s, models: s.models.map((m) => (m.id === modelId ? { ...m, ...patch } : m)) }
      : s));
  };

  const removeService = (id: string) => {
    const remaining = services.filter((s) => s.id !== id);
    setServices(remaining);
    if (activeServiceId === id) {
      const next = remaining[0] ?? null;
      setActiveServiceId(next?.id ?? '');
      setActiveModelId(next?.models[0]?.id ?? '');
    }
    setError('');
  };

  const addService = (service: ProviderProfile, mode: 'create' | 'edit') => {
    setEditingService(service);
    setEditingServiceMode(mode);
    setError('');
  };

  const removeModel = (serviceId: string, modelId: string) => {
    const target = services.find((s) => s.id === serviceId);
    if (!target) return;
    const remaining = target.models.filter((m) => m.id !== modelId);
    updateService(serviceId, { models: remaining });
    if (activeServiceId === serviceId && activeModelId === modelId) {
      setActiveModelId(remaining[0]?.id ?? '');
    }
    setMenuServiceId(null);
    setError('');
  };

  const addModel = (serviceId: string) => {
    const target = services.find((s) => s.id === serviceId);
    if (!target) return;
    const model = { id: createCustomModelId(), name: '', model: '' };
    setEditingModel({ serviceId, model, isNew: true });
    setError('');
  };

  const setModelActive = (serviceId: string, modelId: string) => {
    setActiveServiceId(serviceId);
    setActiveModelId(modelId);
    setError('');
  };

  const toggleCollapse = (serviceId: string) => {
    setCollapsedServiceIds((ids) => ids.includes(serviceId) ? ids.filter((id) => id !== serviceId) : [...ids, serviceId]);
  };

  const handleSaveSettings = (closeImmediately?: boolean) => {
    const invalidEmailService = translationSettings.services?.find(
      (s) => s.provider === 'mymemory' && s.email && !isValidMyMemoryEmail(s.email)
    );
    if (invalidEmailService) {
      setError(t('请输入有效的电子邮箱地址，或留空使用匿名配额。'));
      setStatus(''); setActiveTab('translation'); return;
    }
    const normalizedTranslation = readTranslationServiceSettings(JSON.stringify(translationSettings));
    const valid = sanitizeProfiles(services);
    const { service, model } = resolveModelSelection(valid, activeServiceId, activeModelId);

    onSaveSettings({
      translationSettings: normalizedTranslation,
      dictionarySettings,
      services: valid,
      activeServiceId: service?.id ?? '',
      activeModelId: model?.id ?? '',
      geminiApiKey: speechSettings.services.find((item) => item.id === 'gemini')?.apiKey ?? geminiApiKey,
      speechSettings: sanitizeSpeechSettings(speechSettings)!,
      thinkingEnabled,
      useStream: streamEnabled,
    });

    const newSig = getSettingsSignature({
      services: valid,
      activeServiceId: service?.id ?? '',
      activeModelId: model?.id ?? '',
      dictionary: dictionarySettings,
      translation: normalizedTranslation,
      speech: speechSettings,
      thinking: thinkingEnabled,
      stream: streamEnabled,
    });
    setSavedSignature(newSig);
    setStatus(t('设置已保存'));
    if (closeImmediately) {
      onModalClose();
    } else {
      setTimeout(() => onModalClose(), 900);
    }
  };

  const isThinkingAvailable = !!activeModel?.caps?.thinking;

  const query = searchQuery.trim().toLowerCase();
  const matchesService = (service: ProviderProfile) => {
    if (!query) return true;
    const haystack = [
      service.name,
      service.id,
      ...service.models.map((m) => `${m.name} ${m.model}`),
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  };
  const visibleServices = services.filter(matchesService);

  const presetExists = (presetId: string) => services.some((s) => s.name.trim().toLowerCase() === (PRESETS.find((p) => p.id === presetId)?.name ?? '').toLowerCase());

  const handlePresetClick = (presetId: string) => {
    const existing = services.find((s) => s.name.trim().toLowerCase() === (PRESETS.find((p) => p.id === presetId)?.name ?? '').toLowerCase());
    if (existing) {
      setCollapsedServiceIds((ids) => ids.filter((id) => id !== existing.id));
      setEditingService(existing);
      setEditingServiceMode('edit');
      return;
    }
    const service = fromPreset(presetId);
    if (service) addService(service, 'create');
  };

  const selectableServices = services.filter((service) => service.models.length > 0);
  const defaultLabel = activeService && activeModel
    ? `${activeService.name || activeService.id} · ${activeModel.name || activeModel.model}`
    : t('未配置模型');

  const tabs: Array<{ id: SettingsTabId; label: string; icon: React.ReactNode; desc: string }> = [
    {
      id: 'models',
      label: t('模型服务'),
      icon: Icon.desktop,
      desc: t('配置解析、翻译与朗读服务。'),
    },
    {
      id: 'analysis',
      label: t('解析与输出'),
      icon: Icon.translate,
      desc: t('配置流式输出与深度推理。'),
    },
    {
      id: 'translation',
      label: t('翻译服务'),
      icon: Icon.translate,
      desc: t('配置机器翻译服务与本地缓存。'),
    },
    {
      id: 'dictionary',
      label: t('词典与查询'),
      icon: Icon.book,
      desc: t('内置词典与外部查询服务。'),
    },
    {
      id: 'speech',
      label: t('语音服务'),
      icon: Icon.speaker,
      desc: t('独立配置朗读使用的模型、密钥和音色。'),
    },
  ];

  const currentTab = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div
      id="settingsModal"
      className="settings-modal"
      style={{ display: isModalOpen ? 'flex' : 'none' }}
      onClick={handleOutsideClick}
    >
      <div className="settings-modal-content settings-modular-layout">
        {/* 左侧功能模块边栏 */}
        <aside className="settings-sidebar">
          <div className="settings-sidebar-header">
            <div className="settings-sidebar-title-row">
              <span className="settings-sidebar-title">{t('设置')}</span>
            </div>
            <div className="settings-sidebar-search">
              <span className="settings-sidebar-search-icon" aria-hidden="true">{Icon.search}</span>
              <input
                type="search"
                className="settings-sidebar-search-input"
                placeholder={t('搜索...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('搜索...')}
              />
            </div>
          </div>

          <nav className="settings-nav-list" role="tablist" aria-label={t('功能模块')}>
            <span className="settings-nav-section-label">{t('功能模块')}</span>
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`settings-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="settings-nav-icon">{tab.icon}</span>
                  <span className="settings-nav-label">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* 右侧主视口内容区 */}
        <main className="settings-content-viewport">
          <header className="settings-content-header">
            <div>
              <h2 className="settings-content-title">{currentTab.label}</h2>
              <p className="m-0 mt-1 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>
                {currentTab.desc}
              </p>
              {(activeTab === 'models' || activeTab === 'speech') && (
                <p className="m-0 mt-0.5 text-xs leading-5" style={{ color: 'var(--ink-3)' }}>
                  {t('密钥保存在此浏览器中，随请求发送用于调用模型。')}
                </p>
              )}
            </div>
            <button
              id="closeSettingsModal"
              type="button"
              className="settings-modal-close-button"
              onClick={requestClose}
              aria-label={t('关闭设置')}
            >
              {Icon.x}
            </button>
          </header>

          <div className="settings-tab-pane">
            {/* 模块 1：模型服务 */}
            <div style={{ display: activeTab === 'models' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
              {/* 工具栏：新增服务商 */}
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
                  {t('模型服务')}
                </span>
                <button
                  type="button"
                  className="nd-soft-btn"
                  onClick={() => addService(emptyService(), 'create')}
                >
                  {Icon.plus}<span>{t('新增服务商')}</span>
                </button>
              </div>

              {/* 默认模型卡片 */}
              <div>
                <span className="settings-card-group-label">{t('默认模型')}</span>
                <div className="settings-card-group" ref={defaultMenuRef}>
                  <div className="settings-card-row">
                    <div className="settings-card-row-info">
                      <span className="settings-card-row-title">{t('默认模型')}</span>
                      <span className="settings-card-row-desc">{t('解析与翻译时使用的模型。')}</span>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        className="nd-soft-btn settings-row-trigger"
                        aria-haspopup="menu"
                        aria-expanded={defaultMenuOpen && selectableServices.length > 0}
                        disabled={selectableServices.length === 0}
                        onClick={() => setDefaultMenuOpen((v) => !v)}
                      >
                        <span className="min-w-0 truncate">{defaultLabel}</span>
                        <span style={{ transform: defaultMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} aria-hidden="true">
                          {Icon.chev}
                        </span>
                      </button>
                      {defaultMenuOpen && selectableServices.length > 0 && (
                        <div className="settings-row-menu" role="menu" aria-label={t('默认模型')}>
                          {selectableServices.map((service) => (
                            <div key={service.id} className="model-switch-group">
                              <div className="model-switch-group-label">
                                <ProviderLogo profile={service} className="h-3.5 w-3.5" />
                                <span>{service.name || service.id}</span>
                              </div>
                              {service.models.map((model) => {
                                const isActive = service.id === activeService?.id && model.id === activeModel?.id;
                                return (
                                  <button
                                    key={model.id}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={isActive}
                                    className="model-switch-item"
                                    style={isActive ? { color: 'var(--primary)', background: 'var(--primary-soft)' } : undefined}
                                    onClick={() => { setModelActive(service.id, model.id); setDefaultMenuOpen(false); }}
                                  >
                                    <span className="min-w-0 flex-1 truncate">{model.name || model.model || t('未命名模型')}</span>
                                    {isActive && <span aria-hidden="true">✓</span>}
                                  </button>
                                );
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 预设图标墙 */}
              <div>
                <span className="settings-card-group-label">{t('从预设添加')}</span>
                <div className="preset-icon-wall" role="group" aria-label={t('从预设创建…')}>
                  {PRESETS.map((preset) => {
                    const exists = presetExists(preset.id);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        className="preset-icon"
                        title={preset.name}
                        aria-label={`${preset.name}${exists ? ` · ${t('已添加')}` : ''}`}
                        onClick={() => handlePresetClick(preset.id)}
                      >
                        <ProviderLogo profile={{ id: preset.id, name: preset.name }} className="h-5 w-5" />
                        <span>{preset.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 服务商分组列表 */}
              <div className="settings-group mt-0" role="group" aria-label={t('模型配置')}>
                <span className="settings-card-group-label">{t('配置服务商')}</span>

                {visibleServices.length === 0 ? (
                  <div className="rounded-[10px] p-4 text-sm" style={{ background: 'var(--bg-2)', border: '1px dashed var(--line)', color: 'var(--ink-3)' }}>
                    {query ? t('没有匹配「{0}」的服务商或模型。', searchQuery.trim()) : t('还没有模型服务，点「新增服务商」或从预设创建。')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {visibleServices.map((service) => {
                      const isCollapsed = collapsedServiceIds.includes(service.id);
                      return (
                        <section key={service.id} className="provider-group-card" aria-label={service.name || service.id}>
                          <header className="provider-group-header">
                            <button
                              type="button"
                              className="provider-group-title"
                              aria-expanded={!isCollapsed}
                              onClick={() => toggleCollapse(service.id)}
                            >
                              <ProviderLogo profile={service} className="h-4 w-4" />
                              <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                                {service.name || t('未命名服务商')}
                              </span>
                              {service.baseUrl && (
                                <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--ink-3)' }}>{service.baseUrl}</span>
                              )}
                              <span className="provider-group-count">{t('{0} 个模型', service.models.length)}</span>
                              <span
                                className="provider-group-chevron"
                                aria-hidden="true"
                                style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                              >
                                {Icon.chev}
                              </span>
                            </button>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                className="nd-ghost-btn"
                                onClick={() => { setEditingService(service); setEditingServiceMode('edit'); }}
                              >
                                {Icon.pencil}<span>{t('编辑配置')}</span>
                              </button>
                              <button
                                type="button"
                                className="nd-ghost-btn"
                                onClick={() => addModel(service.id)}
                              >
                                {Icon.plus}<span>{t('新增模型')}</span>
                              </button>
                              <button
                                type="button"
                                className="nd-ghost-btn provider-danger"
                                onClick={() => removeService(service.id)}
                              >
                                {t('删除此服务')}
                              </button>
                            </div>
                          </header>

                          {!isCollapsed && (
                            <div className="provider-model-list">
                              {service.models.length === 0 ? (
                                <div className="rounded-[10px] p-3 text-sm" style={{ background: 'var(--bg-2)', border: '1px dashed var(--line)', color: 'var(--ink-3)' }}>
                                  {t('还没有模型，点「新增模型」添加。')}
                                </div>
                              ) : (
                                service.models.map((model) => {
                                  const modelIsCurrent = service.id === activeService?.id && model.id === activeModel?.id;
                                  const menuOpen = menuServiceId === model.id;
                                  return (
                                    <div key={model.id} className="model-row" ref={menuOpen ? rowMenuRef : undefined}>
                                      <div className="flex min-w-0 flex-1 items-center gap-2">
                                        <span className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>
                                          {model.name || model.model || t('未命名模型')}
                                        </span>
                                        {model.caps?.thinking === true && (
                                          <span className="model-row-cap-badge">{t('深度思考')}</span>
                                        )}
                                        {modelIsCurrent && (
                                          <span
                                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                            style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                                          >
                                            {t('当前')}
                                          </span>
                                        )}
                                      </div>
                                      {!modelIsCurrent && (
                                        <button
                                          type="button"
                                          className="nd-ghost-btn shrink-0"
                                          onClick={() => setModelActive(service.id, model.id)}
                                        >
                                          {t('设为当前')}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="nd-ghost-btn shrink-0"
                                        onClick={() => { setMenuServiceId(null); setEditingModel({ serviceId: service.id, model, isNew: false }); }}
                                      >
                                        {Icon.pencil}<span>{t('模型设置')}</span>
                                      </button>
                                      <div className="relative">
                                        <button
                                          type="button"
                                          className="nd-ghost-btn shrink-0"
                                          style={{ padding: '6px 8px' }}
                                          aria-haspopup="menu"
                                          aria-expanded={menuOpen}
                                          aria-label={t('更多操作')}
                                          onClick={() => setMenuServiceId(menuOpen ? null : model.id)}
                                        >
                                          {Icon.more}
                                        </button>
                                        {menuOpen && (
                                          <div className="model-row-menu" role="menu" aria-label={t('更多操作')}>
                                            {!modelIsCurrent && (
                                              <button
                                                type="button"
                                                role="menuitem"
                                                className="model-row-menu-item"
                                                onClick={() => { setModelActive(service.id, model.id); setMenuServiceId(null); }}
                                              >
                                                {t('设为当前')}
                                              </button>
                                            )}
                                            <button
                                              type="button"
                                              role="menuitem"
                                              className="model-row-menu-item"
                                              style={{ color: 'var(--pos-p)' }}
                                              onClick={() => removeModel(service.id, model.id)}
                                            >
                                              {t('删除此模型')}
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </section>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* 模块 2：解析与输出 */}
            <div style={{ display: activeTab === 'analysis' ? 'flex' : 'none', flexDirection: 'column', gap: '20px' }}>
              <div>
                <span className="settings-card-group-label">{t('输出方式')}</span>
                <div className="settings-card-group">
                  <div className="settings-card-row">
                    <div className="settings-card-row-info">
                      <label htmlFor="useStreamToggle" className="settings-card-row-title cursor-pointer">
                        {t('流式输出')}
                      </label>
                      <span className="settings-card-row-desc">
                        {t('实时显示解析结果，网络不稳定时可关闭。')}
                      </span>
                    </div>
                    <div className="settings-card-row-control">
                      <Switch
                        id="useStreamToggle"
                        aria-label={t('流式输出')}
                        checked={streamEnabled}
                        onCheckedChange={setStreamEnabled}
                      />
                    </div>
                  </div>

                  <div className="settings-card-row">
                    <div className="settings-card-row-info">
                      <span className="settings-card-row-title">{t('深度思考')}</span>
                      <span className="settings-card-row-desc">{t('解析前先让模型展开推理。')}</span>
                    </div>
                    <div className="settings-card-row-control">
                      {isThinkingAvailable ? (
                        <Switch
                          aria-label={t('深度思考')}
                          checked={thinkingEnabled}
                          onCheckedChange={setThinkingEnabled}
                        />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
                          {t('暂不可用')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 模块 3：词典与查询 */}
            <div style={{ display: activeTab === 'translation' ? 'block' : 'none' }}>
              {isModalOpen && <TranslationSettings value={translationSettings} onChange={value => { setTranslationSettings(value); setError(''); setStatus(''); }} />}
            </div>

            <div style={{ display: activeTab === 'dictionary' ? 'block' : 'none' }}>
              {isModalOpen && <DictionarySettings value={dictionarySettings} onChange={setDictionarySettings} />}
            </div>

            {/* 模块 4：语音服务 */}
            <div style={{ display: activeTab === 'speech' ? 'block' : 'none' }}>
              {isModalOpen && <SpeechServices settings={speechSettings} onChange={setSpeechSettings} />}
            </div>
          </div>

          {/* 底部吸底操作栏 */}
          <footer className="settings-content-footer">
            <div className="settings-footer-left">
              {status ? (
                <span className="settings-footer-status success">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>{t(status)}</span>
                </span>
              ) : error ? (
                <span className="settings-footer-status error">
                  {t(error)}
                </span>
              ) : hasUnsavedChanges ? (
                <span className="settings-footer-status unsaved">
                  <span className="settings-unsaved-dot" />
                  <span>{t('有未保存的修改')}</span>
                </span>
              ) : null}
            </div>
            <div className="settings-footer-actions">
              <button
                type="button"
                className="nd-ghost-btn"
                onClick={requestClose}
              >
                {t('取消')}
              </button>
              <button
                id="saveSettingsButton"
                type="button"
                className={`settings-save-button ${hasUnsavedChanges ? 'primary' : 'saved'}`}
                onClick={() => handleSaveSettings(false)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
                  <polyline points="17 21 17 13 7 13 7 21"/>
                  <polyline points="7 3 7 8 15 8"/>
                </svg>
                <span>{t('保存设置')}</span>
              </button>
            </div>
          </footer>
        </main>
      </div>

      {isModalOpen && showUnsavedPrompt && (
        <SettingsConfigLayer onClose={() => setShowUnsavedPrompt(false)}>
          <div
            className="settings-config-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowUnsavedPrompt(false);
            }}
          >
            <div
              className="settings-config-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-label={t('未保存的更改')}
              style={{ maxWidth: '420px', width: '92%' }}
            >
              <button
                type="button"
                className="settings-modal-close-button"
                onClick={() => setShowUnsavedPrompt(false)}
                aria-label={t('关闭')}
              >
                {Icon.x}
              </button>
              <div className="flex items-center gap-2.5 mb-2">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'color-mix(in srgb, #f59e0b 16%, transparent)', color: '#d97706' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </span>
                <h3 className="m-0 text-base font-semibold" style={{ color: 'var(--ink)' }}>
                  {t('未保存的更改')}
                </h3>
              </div>
              <p className="m-0 mb-5 text-sm leading-6" style={{ color: 'var(--ink-2)' }}>
                {t('您在设置中有尚未保存的修改，是否在离开前保存？')}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  className="nd-ghost-btn"
                  onClick={() => setShowUnsavedPrompt(false)}
                >
                  {t('继续编辑')}
                </button>
                <button
                  type="button"
                  className="nd-ghost-btn provider-danger"
                  onClick={() => {
                    setShowUnsavedPrompt(false);
                    onModalClose();
                  }}
                >
                  {t('不保存')}
                </button>
                <button
                  type="button"
                  className="nd-primary-btn"
                  onClick={() => {
                    setShowUnsavedPrompt(false);
                    handleSaveSettings(true);
                  }}
                >
                  {t('保存并退出')}
                </button>
              </div>
            </div>
          </div>
        </SettingsConfigLayer>
      )}

      {isModalOpen && editingService && (
        <ProviderConfigDialog
          key={editingService.id}
          service={editingService}
          mode={editingServiceMode}
          onSave={(id, patch) => {
            if (editingServiceMode === 'create') {
              setServices((list) => [{ ...editingService, ...patch }, ...list]);
              setCollapsedServiceIds((ids) => ids.filter((value) => value !== id));
              setSearchQuery('');
            } else updateService(id, patch);
          }}
          onClose={() => { setEditingService(null); setEditingServiceMode('edit'); }}
        />
      )}

      {isModalOpen && editingModelItem && (
        <ModelConfigDialog
          key={`${editingModelItem.service.id}:${editingModelItem.model.id}`}
          serviceId={editingModelItem.service.id}
          serviceName={editingModelItem.service.name || editingModelItem.service.id}
          model={editingModelItem.model}
          onSave={(serviceId, modelId, patch) => {
            if (editingModel?.isNew) {
              updateService(serviceId, { models: [...editingModelItem.service.models, { ...editingModelItem.model, ...patch }] });
              setCollapsedServiceIds((ids) => ids.filter((id) => id !== serviceId));
              setSearchQuery('');
            } else updateModel(serviceId, modelId, patch);
          }}
          onDelete={editingModel?.isNew ? undefined : () => {
            removeModel(editingModelItem.service.id, editingModelItem.model.id);
            setEditingModel(null);
          }}
          onClose={() => setEditingModel(null)}
        />
      )}
    </div>
  );
}
