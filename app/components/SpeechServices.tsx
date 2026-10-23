'use client';

import SettingsConfigLayer from './SettingsConfigLayer';
import { ConfigAdvanced, ConfigInputTypes, ConfigField } from './ModelConfigFields';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  createSpeechProvider,
  createSpeechVoice,
  buildFlatSpeechServices,
  sanitizeSpeechSettings,
  SPEECH_PROVIDER_PRESETS,
  SPEECH_VOICES,
  EDGE_VOICE_DEFINITIONS,
  formatSpeechServiceName,
  getLocalizedSpeechVoiceName,
  type SpeechProviderProfile,
  type SpeechVoice,
  type SpeechSettings,
  type SpeechProtocol,
} from '../lib/speechServices';
import { getJapaneseTtsAudio } from '../utils/helpers';
import { beginAudioSpeech, endSpeechPlayback, setSpeechPlaybackStatus } from '../lib/speechPlaybackStore';
import type { SpeechBoundary } from '../lib/speechReading';
import { Icon } from './Icons';
import { ProviderLogo } from './ProviderLogo';
import { LatestRequest } from '../utils/latestRequest';

const SPEECH_PREVIEW_TEXT = 'こんにちは。日本語の音声テストです。';

export default function SpeechServices({
  settings,
  onChange,
}: {
  settings: SpeechSettings;
  onChange: (settings: SpeechSettings) => void;
}) {
  const { t } = useLanguage();
  const [collapsedProviders, setCollapsedProviders] = useState<Record<string, boolean>>({});
  const [editingProvider, setEditingProvider] = useState<{ profile: SpeechProviderProfile; isNew: boolean } | null>(null);
  const [editingVoice, setEditingVoice] = useState<{ provider: SpeechProviderProfile; voice: SpeechVoice; isNew: boolean } | null>(null);
  const [defaultMenuOpen, setDefaultMenuOpen] = useState(false);
  const defaultMenuRef = useRef<HTMLDivElement | null>(null);

  // 试听行内音频状态
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [rowAudioUrl, setRowAudioUrl] = useState<string | null>(null);
  const rowAudioRef = useRef<HTMLAudioElement | null>(null);
  const rowAudioBlobRef = useRef<Blob | null>(null);
  const rowBoundariesRef = useRef<SpeechBoundary[] | undefined>(undefined);
  const rowSpeechSessionIdRef = useRef<number | null>(null);
  const previewRequest = useRef(new LatestRequest());

  const endRowSpeechSession = useCallback(() => {
    if (rowSpeechSessionIdRef.current !== null) {
      endSpeechPlayback(rowSpeechSessionIdRef.current);
      rowSpeechSessionIdRef.current = null;
    }
  }, []);

  const providers = settings.providers && settings.providers.length > 0
    ? settings.providers
    : (sanitizeSpeechSettings(settings)?.providers ?? SPEECH_PROVIDER_PRESETS);

  const flatServices = settings.services && settings.services.length > 0
    ? settings.services
    : buildFlatSpeechServices(providers);

  const activeService = flatServices.find((item) => item.id === settings.activeId) || flatServices[0];

  const toggleCollapse = (id: string) => {
    setCollapsedProviders((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    if (!defaultMenuOpen) return;
    const handleDown = (e: MouseEvent) => {
      if (defaultMenuRef.current && !defaultMenuRef.current.contains(e.target as Node)) {
        setDefaultMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDefaultMenuOpen(false);
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [defaultMenuOpen]);

  useEffect(() => {
    let current = true;
    if (rowAudioUrl && rowAudioRef.current) {
      rowAudioRef.current.play().catch(() => {
        if (current) { endRowSpeechSession(); setPlayingVoiceId(null); }
      });
    }
    return () => { current = false; };
  }, [rowAudioUrl, endRowSpeechSession]);

  useEffect(() => {
    const manager = previewRequest.current;
    const audio = rowAudioRef.current;
    return () => { manager.cancel(); endRowSpeechSession(); audio?.pause(); };
  }, [endRowSpeechSession]);

  useEffect(() => {
    return () => {
      if (rowAudioUrl) URL.revokeObjectURL(rowAudioUrl);
    };
  }, [rowAudioUrl]);

  const previewRowVoice = async (provider: SpeechProviderProfile, voice: SpeechVoice) => {
    previewRequest.current.cancel();
    endRowSpeechSession();
    rowAudioRef.current?.pause();
    rowAudioBlobRef.current = null;
    setRowAudioUrl(null);
    if (playingVoiceId === voice.id) {
      if (rowAudioRef.current) {
        rowAudioRef.current.pause();
        rowAudioRef.current.currentTime = 0;
      }
      setPlayingVoiceId(null);
      return;
    }
    const ticket = previewRequest.current.start();
    setPlayingVoiceId(voice.id);
    try {
      const { url, blob, boundaries } = await getJapaneseTtsAudio(
        SPEECH_PREVIEW_TEXT,
        provider.apiKey.trim(),
        provider.provider,
        {
          baseUrl: provider.baseUrl.trim(),
          model: voice.model.trim(),
          voice: voice.voice.trim(),
          speed: voice.speed,
          signal: ticket.signal,
        }
      );
      if (!ticket.isCurrent()) { URL.revokeObjectURL(url); return; }
      rowAudioBlobRef.current = blob;
      rowBoundariesRef.current = boundaries;
      setRowAudioUrl(url);
    } catch {
      if (ticket.isCurrent()) setPlayingVoiceId(null);
    }
  };

  const handleSaveProvider = (saved: SpeechProviderProfile) => {
    const exists = providers.some((p) => p.id === saved.id);
    const nextProviders = exists
      ? providers.map((p) => (p.id === saved.id ? saved : p))
      : [...providers, saved];
    const nextFlat = buildFlatSpeechServices(nextProviders);
    const nextActiveId = nextFlat.some((s) => s.id === settings.activeId)
      ? settings.activeId
      : (nextFlat[0]?.id ?? 'edge');
    onChange({
      providers: nextProviders,
      services: nextFlat,
      activeId: nextActiveId,
    });
    setEditingProvider(null);
  };

  const handleRemoveProvider = (providerId: string) => {
    const nextProviders = providers.filter((p) => p.id !== providerId);
    const nextFlat = buildFlatSpeechServices(nextProviders);
    const nextActiveId = nextFlat.some((s) => s.id === settings.activeId)
      ? settings.activeId
      : (nextFlat[0]?.id ?? 'edge');
    onChange({
      providers: nextProviders,
      services: nextFlat,
      activeId: nextActiveId,
    });
  };

  const handleSaveVoice = (providerId: string, savedVoice: SpeechVoice) => {
    const nextProviders = providers.map((p) => {
      if (p.id !== providerId) return p;
      const voiceExists = p.voices.some((v) => v.id === savedVoice.id);
      const nextVoices = voiceExists
        ? p.voices.map((v) => (v.id === savedVoice.id ? savedVoice : v))
        : [...p.voices, savedVoice];
      return { ...p, voices: nextVoices };
    });
    const nextFlat = buildFlatSpeechServices(nextProviders);
    const nextActiveId = nextFlat.some((s) => s.id === settings.activeId)
      ? settings.activeId
      : (nextFlat[0]?.id ?? 'edge');
    onChange({
      providers: nextProviders,
      services: nextFlat,
      activeId: nextActiveId,
    });
    setEditingVoice(null);
  };

  const handleRemoveVoice = (providerId: string, voiceId: string) => {
    const nextProviders = providers.map((p) => {
      if (p.id !== providerId) return p;
      return {
        ...p,
        voices: p.voices.filter((v) => v.id !== voiceId),
      };
    });
    const nextFlat = buildFlatSpeechServices(nextProviders);
    const nextActiveId = nextFlat.some((s) => s.id === settings.activeId)
      ? settings.activeId
      : (nextFlat[0]?.id ?? 'edge');
    onChange({
      providers: nextProviders,
      services: nextFlat,
      activeId: nextActiveId,
    });
  };

  return (
    <div className="flex flex-col gap-5" aria-label={t('语音服务')}>
      {/* 隐藏的行试听 audio 元素 */}
      <audio
        ref={rowAudioRef}
        src={rowAudioUrl || undefined}
        onPlay={event => { rowSpeechSessionIdRef.current = beginAudioSpeech(event.currentTarget, rowAudioBlobRef.current, SPEECH_PREVIEW_TEXT, { boundaries: rowBoundariesRef.current }); }}
        onPause={() => { if (rowSpeechSessionIdRef.current !== null) setSpeechPlaybackStatus(rowSpeechSessionIdRef.current, 'paused'); }}
        onEnded={() => { endRowSpeechSession(); setPlayingVoiceId(null); }}
        onError={() => { endRowSpeechSession(); setPlayingVoiceId(null); }}
        className="hidden"
      />

      {/* 工具栏：新增语音服务 */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
          {t('语音服务')}
        </span>
        <button
          type="button"
          className="nd-soft-btn"
          onClick={() => setEditingProvider({ profile: { ...createSpeechProvider('openai'), name: '' }, isNew: true })}
        >
          {Icon.plus}<span>{t('新增语音服务')}</span>
        </button>
      </div>

      {/* 默认语音卡片 */}
      <div>
        <span className="settings-card-group-label">{t('默认语音')}</span>
        <div className="settings-card-group" ref={defaultMenuRef}>
          <div className="settings-card-row">
            <div className="settings-card-row-info">
              <span className="settings-card-row-title">{t('默认语音')}</span>
              <span className="settings-card-row-desc">{t('朗读例句与生词时使用的语音服务。')}</span>
            </div>
            <div className="relative">
              <button
                type="button"
                className="nd-soft-btn settings-row-trigger"
                aria-haspopup="menu"
                aria-expanded={defaultMenuOpen && flatServices.length > 0}
                disabled={flatServices.length === 0}
                onClick={() => setDefaultMenuOpen((v) => !v)}
              >
                <span className="min-w-0 truncate">{activeService ? formatSpeechServiceName(activeService, t) : t('内置')}</span>
                <span style={{ transform: defaultMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} aria-hidden="true">
                  {Icon.chev}
                </span>
              </button>
              {defaultMenuOpen && flatServices.length > 0 && (
                <div className="settings-row-menu" role="menu" aria-label={t('默认语音')}>
                  {flatServices.map((service) => {
                    const isActive = service.id === settings.activeId;
                    const displayName = formatSpeechServiceName(service, t);
                    return (
                      <button
                        key={service.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className="model-switch-item"
                        style={isActive ? { color: 'var(--primary)', background: 'var(--primary-soft)' } : undefined}
                        onClick={() => {
                          onChange({ ...settings, activeId: service.id });
                          setDefaultMenuOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <ProviderLogo profile={{ id: service.provider, name: service.name }} className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate">{displayName}</span>
                        </div>
                        {isActive && <span aria-hidden="true">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 从预设添加 */}
      <div>
        <span className="settings-card-group-label">{t('从预设添加')}</span>
        <div className="preset-icon-wall" role="group" aria-label={t('从预设添加')}>
          {SPEECH_PROVIDER_PRESETS.filter((preset) => preset.provider !== 'edge').map((preset) => (
            <button
              type="button"
              className="preset-icon"
              key={preset.id}
              title={preset.name}
              onClick={() => setEditingProvider({ profile: createSpeechProvider(preset.provider), isNew: true })}
            >
              <ProviderLogo profile={{ id: preset.provider, name: preset.name }} className="h-5 w-5" />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 配置服务商分组列表（类似模型服务可折叠树形） */}
      <div className="settings-group mt-0" role="group" aria-label={t('语音配置')}>
        <span className="settings-card-group-label">{t('配置服务商')}</span>
        <div className="space-y-3">
          {providers.map((provider) => {
            const isCollapsed = Boolean(collapsedProviders[provider.id]);
            return (
              <section key={provider.id} className="provider-group-card" aria-label={provider.name}>
                <header className="provider-group-header">
                  <button
                    type="button"
                    className="provider-group-title"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleCollapse(provider.id)}
                  >
                    <ProviderLogo profile={{ id: provider.provider, name: provider.name }} className="h-4 w-4" />
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {provider.name || t('未命名服务商')}
                    </span>
                    {provider.baseUrl && (
                      <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--ink-3)' }}>
                        {provider.baseUrl}
                      </span>
                    )}
                    <span className="provider-group-count">
                      {t('{0} 个音色', provider.voices.length)}
                    </span>
                    <span
                      className="provider-group-chevron"
                      aria-hidden="true"
                      style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                    >
                      {Icon.chev}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-1">
                    {provider.provider !== 'edge' && (
                      <button
                        type="button"
                        className="nd-ghost-btn"
                        onClick={() => setEditingProvider({ profile: provider, isNew: false })}
                      >
                        {Icon.pencil}<span>{t('编辑配置')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="nd-ghost-btn"
                      onClick={() => setEditingVoice({ provider, voice: createSpeechVoice(provider.provider), isNew: true })}
                    >
                      {Icon.plus}<span>{t('新增音色')}</span>
                    </button>
                    {provider.provider !== 'edge' && (
                      <button
                        type="button"
                        className="nd-ghost-btn provider-danger"
                        onClick={() => handleRemoveProvider(provider.id)}
                        aria-label={t('删除语音服务：{0}', provider.name)}
                      >
                        {t('删除此服务')}
                      </button>
                    )}
                  </div>
                </header>

                {!isCollapsed && (
                  <div className="provider-model-list">
                    {provider.voices.length === 0 ? (
                      <div className="rounded-[10px] p-3 text-sm" style={{ background: 'var(--bg-2)', border: '1px dashed var(--line)', color: 'var(--ink-3)' }}>
                        {t('还没有音色，点「新增音色」添加。')}
                      </div>
                    ) : (
                      provider.voices.map((voice) => {
                        const isCurrent = voice.id === settings.activeId;
                        const isPlaying = playingVoiceId === voice.id;
                        const voiceDisplay = getLocalizedSpeechVoiceName(voice.name || voice.voice, t);
                        return (
                          <div key={voice.id} className="model-row">
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <span className="truncate text-sm font-medium" style={{ color: 'var(--ink)' }}>
                                {voiceDisplay}
                              </span>
                              <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--ink-3)' }}>
                                {voice.model} · {voice.voice}
                              </span>
                              {voice.speed !== 1 && (
                                <span className="model-row-cap-badge">{voice.speed}x</span>
                              )}
                              {isCurrent && (
                                <span
                                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                  style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                                >
                                  {t('当前')}
                                </span>
                              )}
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                              {!isCurrent && (
                                <button
                                  type="button"
                                  className="nd-ghost-btn shrink-0"
                                  onClick={() => onChange({ ...settings, activeId: voice.id })}
                                >
                                  {t('设为当前')}
                                </button>
                              )}
                              <button
                                type="button"
                                className="nd-ghost-btn shrink-0"
                                onClick={() => previewRowVoice(provider, voice)}
                              >
                                {isPlaying ? t('停止') : t('试听')}
                              </button>
                              <button
                                type="button"
                                className="nd-ghost-btn shrink-0"
                                onClick={() => setEditingVoice({ provider, voice, isNew: false })}
                              >
                                {Icon.pencil}<span>{t('音色配置')}</span>
                              </button>
                              {provider.voices.length > 1 && (
                                <button
                                  type="button"
                                  className="nd-ghost-btn provider-danger shrink-0"
                                  onClick={() => handleRemoveVoice(provider.id, voice.id)}
                                >
                                  {t('删除')}
                                </button>
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
      </div>

      {/* 服务商配置弹窗 */}
      {editingProvider && (
        <SpeechProviderDialog
          key={editingProvider.profile.id}
          initial={editingProvider.profile}
          isNew={editingProvider.isNew}
          onClose={() => setEditingProvider(null)}
          onSave={handleSaveProvider}
        />
      )}

      {/* 音色配置弹窗 */}
      {editingVoice && (
        <SpeechVoiceDialog
          key={editingVoice.voice.id}
          provider={editingVoice.provider}
          initial={editingVoice.voice}
          isNew={editingVoice.isNew}
          onClose={() => setEditingVoice(null)}
          onSave={(v) => handleSaveVoice(editingVoice.provider.id, v)}
        />
      )}
    </div>
  );
}

/** 服务商配置对话框 */
function SpeechProviderDialog({
  initial,
  isNew,
  onSave,
  onClose,
}: {
  initial: SpeechProviderProfile;
  isNew: boolean;
  onSave: (provider: SpeechProviderProfile) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(initial);
  const update = (patch: Partial<SpeechProviderProfile>) => setDraft((val) => ({ ...val, ...patch }));

  const isArkChatUrl = draft.provider === 'openai' && /^https:\/\/ark\.cn-beijing\.volces\.com(?:\/|$)/i.test(draft.baseUrl.trim());

  return (
    <SettingsConfigLayer onClose={onClose}>
      <div
        className="settings-config-backdrop"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="settings-config-dialog" role="dialog" aria-modal="true" aria-label={t('语音服务配置')}>
          <button type="button" className="settings-modal-close-button" onClick={onClose} aria-label={t('关闭设置')}>
            {Icon.x}
          </button>
          <h3 className="m-0 mb-4 text-lg font-semibold">{isNew ? t('新增语音服务') : t('语音服务配置')}</h3>
          <div className="space-y-3">
            <label className="block text-sm">
              {t('服务名称')}
              <input
                className="nd-input mt-1"
                value={draft.name}
                placeholder={draft.provider}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              {t('接口类型')}
              <select
                aria-label={t('接口类型')}
                className="nd-input mt-1"
                value={draft.provider}
                onChange={(e) => {
                  const protocol = e.target.value as SpeechProtocol;
                  const preset = SPEECH_PROVIDER_PRESETS.find((item) => item.provider === protocol)!;
                  update({
                    provider: protocol,
                    baseUrl: preset.baseUrl,
                    apiKey: '',
                    voices: preset.voices.map((v) => ({ ...v })),
                  });
                }}
              >
                <option value="openai">OpenAI {t('兼容接口')}</option>
                <option value="gemini">Gemini</option>
                <option value="minimax">MiniMax</option>
                <option value="volcengine">Volcengine</option>
              </select>
            </label>
            <label className="block text-sm">
              {t('基础地址（Base URL）')}
              <input
                className="nd-input mt-1"
                value={draft.baseUrl}
                placeholder="https://..."
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
            </label>
            {isArkChatUrl && (
              <div className="text-xs leading-5" role="status">
                <p>{t('该地址用于对话。Agent Plan 语音需要专用接口、地址和音色。')}</p>
                <button
                  type="button"
                  className="nd-soft-btn"
                  onClick={() => {
                    const preset = SPEECH_PROVIDER_PRESETS.find((item) => item.provider === 'volcengine')!;
                    update({
                      provider: preset.provider,
                      baseUrl: preset.baseUrl,
                      voices: preset.voices.map((v) => ({ ...v })),
                    });
                  }}
                >
                  {t('改用 Agent Plan 语音配置')}
                </button>
              </div>
            )}
            {draft.provider === 'volcengine' && (
              <p className="m-0 text-xs leading-5">
                {t('使用 Agent Plan 专属 API Key；模型支持日语，音色需在套餐中可用。')}{' '}
                <a href="https://docs.volcengine.com/docs/ark/agent-plan-personal-voice-model?lang=zh" target="_blank" rel="noreferrer">
                  {t('查看接入文档')}
                </a>
              </p>
            )}
            <label className="block text-sm">
              {t('API 密钥')}
              <input
                type="password"
                className="nd-input mt-1"
                value={draft.apiKey}
                placeholder="sk-..."
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </label>
          </div>
          <div className="settings-actions">
            <button type="button" className="nd-ghost-btn" onClick={onClose}>
              {t('取消')}
            </button>
            <button
              type="button"
              className="nd-primary-btn"
              onClick={() => {
                onSave({
                  ...draft,
                  name: draft.name.trim() || draft.provider,
                  baseUrl: draft.baseUrl.trim(),
                  apiKey: draft.apiKey.trim(),
                });
              }}
            >
              {t('保存')}
            </button>
          </div>
        </div>
      </div>
    </SettingsConfigLayer>
  );
}

/** 音色配置对话框 */
function SpeechVoiceDialog({
  provider,
  initial,
  isNew,
  onSave,
  onClose,
}: {
  provider: SpeechProviderProfile;
  initial: SpeechVoice;
  isNew: boolean;
  onSave: (voice: SpeechVoice) => void;
  onClose: () => void;
}) {
  const { t, errorText } = useLanguage();
  const [draft, setDraft] = useState(initial);
  const [testing, setTesting] = useState(false);
  const [audio, setAudio] = useState('');
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);
  const boundariesRef = useRef<SpeechBoundary[] | undefined>(undefined);
  const speechSessionIdRef = useRef<number | null>(null);

  const endVoiceSpeechSession = useCallback(() => {
    if (speechSessionIdRef.current !== null) {
      endSpeechPlayback(speechSessionIdRef.current);
      speechSessionIdRef.current = null;
    }
  }, []);

  const update = (patch: Partial<SpeechVoice>) => setDraft((val) => ({ ...val, ...patch }));

  useEffect(() => {
    setError('');
    setAudio('');
    setTesting(false);
    return () => {
      controller.current?.abort();
    };
  }, [draft]);

  useEffect(() => {
    return () => {
      endVoiceSpeechSession();
      if (audio) URL.revokeObjectURL(audio);
    };
  }, [audio, endVoiceSpeechSession]);

  const valid = Boolean(draft.model.trim() && draft.voice.trim());

  const preview = async () => {
    controller.current?.abort();
    endVoiceSpeechSession();
    audioBlobRef.current = null;
    const request = new AbortController();
    controller.current = request;
    setTesting(true);
    setError('');
    setAudio('');
    try {
      const { url, blob, boundaries } = await getJapaneseTtsAudio(
        SPEECH_PREVIEW_TEXT,
        provider.apiKey.trim(),
        provider.provider,
        {
          baseUrl: provider.baseUrl.trim(),
          model: draft.model.trim(),
          voice: draft.voice.trim(),
          speed: draft.speed,
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
        }
      );
      if (request.signal.aborted) {
        URL.revokeObjectURL(url);
      } else {
        audioBlobRef.current = blob;
        boundariesRef.current = boundaries;
        setAudio(url);
      }
    } catch (err) {
      if (!request.signal.aborted) {
        setError(
          err instanceof Error && err.name === 'TimeoutError'
            ? t('连接测试超时，请检查地址或稍后重试')
            : errorText(err instanceof Error ? err.message : t('无法连接到服务器，请检查网络'))
        );
      }
    } finally {
      if (!request.signal.aborted) setTesting(false);
    }
  };

  const speedValid = provider.provider === 'gemini' || Number.isFinite(draft.speed) && draft.speed >= 0.5 && draft.speed <= 2;
  const save = () => {
    if (!valid || !speedValid) return;
    onSave({ ...draft, name: draft.name.trim() || draft.voice.trim(), model: draft.model.trim(), voice: draft.voice.trim(), speed: provider.provider === 'gemini' ? 1 : draft.speed });
  };

  return <SettingsConfigLayer onClose={onClose}>
    <div className="settings-config-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="settings-config-dialog model-config-dialog" role="dialog" aria-modal="true" aria-label={t('音色配置')}
        onSubmit={event => { event.preventDefault(); save(); }}>
        <header className="model-config-header">
          <button type="button" className="settings-modal-close-button" onClick={onClose} aria-label={t('关闭设置')}>{Icon.x}</button>
          <h3>{isNew ? t('新增音色') : t('音色配置')}</h3>
          <p className="model-config-hint">{t('属于「{0}」下的模型。', provider.name)}</p>
        </header>
        <div className="model-config-body model-config-fields">
          <ConfigField id="speechCfgName" label={t('音色名称')}>
            <input id="speechCfgName" className="nd-input" value={draft.name} placeholder={draft.voice || 'Voice'} onChange={event => update({ name: event.target.value })} />
          </ConfigField>
          <ConfigField id="speechCfgModel" label={t('模型 ID')}>
            <input id="speechCfgModel" className="nd-input" value={draft.model} readOnly={provider.provider === 'edge'} required
              onChange={event => update({ model: event.target.value })} />
          </ConfigField>
          <ConfigField id="speechCfgVoice" label={provider.provider === 'edge' ? t('音色选择') : t('音色 ID')}>
            {provider.provider === 'edge' ? <select id="speechCfgVoice" className="nd-input" value={draft.voice}
              onChange={event => {
                const voice = EDGE_VOICE_DEFINITIONS.find(item => item.voice === event.target.value) || EDGE_VOICE_DEFINITIONS[0];
                update({ voice: voice.voice, name: t(voice.name), model: 'edge-tts' });
              }}>
              {EDGE_VOICE_DEFINITIONS.map(voice => <option key={voice.voice} value={voice.voice}>{t(voice.labelKey)}</option>)}
            </select> : <>
              <input id="speechCfgVoice" list="speechVoiceOptions" className="nd-input" value={draft.voice} required onChange={event => update({ voice: event.target.value })} />
              <datalist id="speechVoiceOptions">{(SPEECH_VOICES[provider.provider] ?? []).map(voice => <option key={voice} value={voice} />)}</datalist>
            </>}
          </ConfigField>
          <ConfigAdvanced>
            <ConfigInputTypes />
            {provider.provider !== 'gemini' && <ConfigField id="speechCfgSpeed" label={t('语速倍率')}>
              <input id="speechCfgSpeed" className="nd-input" type="number" min="0.5" max="2" step="0.1" value={draft.speed}
                onChange={event => update({ speed: Number(event.target.value) })} aria-invalid={!speedValid} />
            </ConfigField>}
            <div>
              <p className="model-config-hint">{t('测试会合成一小段日语，可能产生少量费用。')}</p>
              <button type="button" className="nd-soft-btn mt-2" disabled={!valid || !speedValid || (provider.provider !== 'edge' && !provider.apiKey.trim()) || testing} onClick={preview}>
                {testing ? t('测试中…') : t('测试并试听')}
              </button>
            </div>
            {error && <p role="alert" className="model-config-error">{error}</p>}
            {audio && <audio controls autoPlay src={audio} className="w-full" aria-label={t('语音测试结果')}
              onPlay={event => { speechSessionIdRef.current = beginAudioSpeech(event.currentTarget, audioBlobRef.current, SPEECH_PREVIEW_TEXT, { boundaries: boundariesRef.current }); }}
              onPause={() => { if (speechSessionIdRef.current !== null) setSpeechPlaybackStatus(speechSessionIdRef.current, 'paused'); }}
              onEnded={endVoiceSpeechSession}
              onError={endVoiceSpeechSession}
            />}
          </ConfigAdvanced>
        </div>
        <footer className="settings-actions model-config-actions">
          <button type="button" className="nd-ghost-btn model-config-reset" onClick={() => setDraft(initial)}>{t('重置表单')}</button>
          <button type="button" className="nd-ghost-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="nd-primary-btn" disabled={!valid || !speedValid}>{t('保存')}</button>
        </footer>
      </form>
    </div>
  </SettingsConfigLayer>;
}
