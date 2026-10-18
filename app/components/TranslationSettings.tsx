'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import {
  createTranslationService,
  getActiveTranslationService,
  isValidMyMemoryEmail,
  TRANSLATION_PRESETS,
  type TranslationService,
  type TranslationServiceSettings,
} from '../lib/translationServices';
import { clearMachineTranslationCache } from '../services/machineTranslationClient';
import { Icon } from './Icons';
import { ProviderLogo } from './ProviderLogo';
import SettingsConfigLayer from './SettingsConfigLayer';

export default function TranslationSettings({
  value,
  onChange,
}: {
  value: TranslationServiceSettings;
  onChange: (value: TranslationServiceSettings) => void;
}) {
  const { t } = useLanguage();
  const [cleared, setCleared] = useState(false);
  const [editing, setEditing] = useState<TranslationService | null>(null);
  const [defaultMenuOpen, setDefaultMenuOpen] = useState(false);
  const defaultMenuRef = useRef<HTMLDivElement | null>(null);

  const activeService = getActiveTranslationService(value);

  const remove = (id: string) => {
    const nextServices = value.services.filter((item) => item.id !== id);
    const nextActiveId = value.activeId === id ? (nextServices[0]?.id || 'mymemory') : value.activeId;
    const nextPreferred = value.preferredProvider === id ? nextActiveId : value.preferredProvider;
    const myMemorySvc = nextServices.find((s) => s.provider === 'mymemory');
    onChange({
      ...value,
      services: nextServices,
      activeId: nextActiveId,
      preferredProvider: nextPreferred,
      ...(myMemorySvc?.email ? { myMemoryEmail: myMemorySvc.email } : { myMemoryEmail: undefined }),
    });
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

  return (
    <div className="flex flex-col gap-5" aria-label={t('翻译服务')}>
      {/* 工具栏：翻译服务标题（后续接入 DeepL/Google 时再启用新增按钮） */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-3)' }}>
          {t('翻译服务')}
        </span>
        {/* 后续接入 DeepL、Google 等服务时解除注释启用
        <button
          type="button"
          className="nd-soft-btn"
          onClick={() => setEditing(createTranslationService('mymemory'))}
        >
          {Icon.plus}<span>{t('新增翻译服务')}</span>
        </button>
        */}
      </div>

      {/* 默认服务卡片 */}
      <div>
        <span className="settings-card-group-label">{t('默认翻译服务')}</span>
        <div className="settings-card-group" ref={defaultMenuRef}>
          <div className="settings-card-row">
            <div className="settings-card-row-info">
              <span className="settings-card-row-title">{t('默认翻译服务')}</span>
              <span className="settings-card-row-desc">{t('解析完成后自动快速翻译时使用的服务。')}</span>
            </div>
            <div className="relative">
              <button
                type="button"
                className="nd-soft-btn settings-row-trigger"
                aria-haspopup="menu"
                aria-expanded={defaultMenuOpen && value.services.length > 0}
                disabled={value.services.length === 0}
                onClick={() => setDefaultMenuOpen((v) => !v)}
              >
                <span className="min-w-0 truncate">{activeService?.name || 'MyMemory'}</span>
                <span
                  style={{
                    transform: defaultMenuOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                  aria-hidden="true"
                >
                  {Icon.chev}
                </span>
              </button>
              {defaultMenuOpen && value.services.length > 0 && (
                <div className="settings-row-menu" role="menu" aria-label={t('默认翻译服务')}>
                  {value.services.map((service) => {
                    const isActive = service.id === value.activeId;
                    return (
                      <button
                        key={service.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        className="model-switch-item"
                        style={isActive ? { color: 'var(--primary)', background: 'var(--primary-soft)' } : undefined}
                        onClick={() => {
                          onChange({
                            ...value,
                            activeId: service.id,
                            preferredProvider: value.preferredProvider === 'model' ? 'model' : service.id,
                          });
                          setDefaultMenuOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <ProviderLogo profile={{ id: service.provider, name: service.name }} className="h-4 w-4" />
                          <span className="min-w-0 flex-1 truncate">{service.name}</span>
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

      {/* 后续接入 DeepL、Google 等服务时解除注释启用从预设添加
      <div>
        <span className="settings-card-group-label">{t('从预设添加')}</span>
        <div className="preset-icon-wall" role="group" aria-label={t('从预设添加')}>
          {TRANSLATION_PRESETS.map((preset) => (
            <button
              type="button"
              className="preset-icon"
              key={preset.id}
              title={preset.name}
              onClick={() => setEditing(createTranslationService(preset.provider))}
            >
              <ProviderLogo profile={{ id: preset.provider, name: preset.name }} className="h-5 w-5" />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>
      */}

      {/* 配置服务商分组列表 */}
      <div className="settings-group mt-0" role="group" aria-label={t('翻译服务配置')}>
        <span className="settings-card-group-label">{t('配置服务商')}</span>
        <div className="space-y-3">
          {value.services.map((service) => {
            const isCurrent = service.id === value.activeId;
            return (
              <section key={service.id} className="provider-group-card" aria-label={service.name}>
                <header className="provider-group-header">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <ProviderLogo profile={{ id: service.provider, name: service.name }} className="h-4 w-4" />
                    <span className="truncate text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                      {service.name}
                    </span>
                    <span className="hidden truncate text-xs sm:inline" style={{ color: 'var(--ink-3)' }}>
                      {service.email ? t('邮箱：{0}', service.email) : t('免费 · 无需注册')}
                    </span>
                    {isCurrent && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
                      >
                        {t('当前')}
                      </span>
                    )}
                    {service.id === 'mymemory' && (
                      <span
                        className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: 'color-mix(in srgb, var(--ink) 6%, transparent)', color: 'var(--ink-3)' }}
                      >
                        {t('内置')}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {!isCurrent && (
                      <button
                        type="button"
                        className="nd-ghost-btn shrink-0"
                        onClick={() =>
                          onChange({
                            ...value,
                            activeId: service.id,
                            preferredProvider: value.preferredProvider === 'model' ? 'model' : service.id,
                          })
                        }
                      >
                        {t('设为当前')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="nd-ghost-btn"
                      onClick={() => setEditing(service)}
                      aria-label={t('编辑翻译服务：{0}', service.name)}
                    >
                      {Icon.pencil}<span>{t('编辑配置')}</span>
                    </button>
                    {service.id !== 'mymemory' && (
                      <button
                        type="button"
                        className="nd-ghost-btn provider-danger"
                        onClick={() => remove(service.id)}
                        aria-label={t('删除翻译服务：{0}', service.name)}
                      >
                        {t('删除此服务')}
                      </button>
                    )}
                  </div>
                </header>
              </section>
            );
          })}
        </div>
      </div>

      {/* 翻译缓存管理卡片 */}
      <div className="settings-card-group">
        <div className="settings-card-row flex-wrap">
          <div className="settings-card-row-info">
            <span className="settings-card-row-title">{t('翻译缓存')}</span>
            <span className="settings-card-row-desc">
              {t('MyMemory 原文与译文保存在此浏览器，最多 100 条、保留 30 天。重复内容优先使用缓存。')}
            </span>
          </div>
          <button
            type="button"
            className="nd-ghost-btn"
            onClick={() => {
              clearMachineTranslationCache();
              setCleared(true);
            }}
          >
            {t('清除翻译缓存')}
          </button>
        </div>
        {cleared && (
          <p role="status" className="tool-note px-4 pb-3">
            {t('翻译缓存已清除，当前显示的译文仍保留。')}
          </p>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <TranslationServiceDialog
          key={editing.id}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(service) => {
            const exists = value.services.some((item) => item.id === service.id);
            const nextServices = exists
              ? value.services.map((item) => (item.id === service.id ? service : item))
              : [...value.services, service];
            const myMemorySvc = nextServices.find((s) => s.provider === 'mymemory');
            onChange({
              ...value,
              services: nextServices,
              ...(myMemorySvc?.email ? { myMemoryEmail: myMemorySvc.email } : { myMemoryEmail: undefined }),
            });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TranslationServiceDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: TranslationService;
  onSave: (service: TranslationService) => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState('');

  const handleSave = () => {
    const trimmedEmail = (draft.email || '').trim();
    if (trimmedEmail && !isValidMyMemoryEmail(trimmedEmail)) {
      setError(t('请输入有效的电子邮箱地址，或留空使用匿名配额。'));
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim() || 'MyMemory',
      email: trimmedEmail,
    });
  };

  return (
    <SettingsConfigLayer onClose={onClose}>
      <div
        className="settings-config-backdrop"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="settings-config-dialog"
          role="dialog"
          aria-modal="true"
          aria-label={t('翻译服务配置')}
        >
          <button
            type="button"
            className="settings-modal-close-button"
            onClick={onClose}
            aria-label={t('关闭设置')}
          >
            {Icon.x}
          </button>
          <h3 className="m-0 mb-4 text-lg font-semibold">{t('翻译服务配置')}</h3>

          <div className="space-y-4">
            <div>
              <label htmlFor="serviceNameInput" className="settings-field-label">
                {t('服务名称')}
              </label>
              <input
                id="serviceNameInput"
                type="text"
                className="nd-input w-full"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="MyMemory"
              />
            </div>

            {draft.provider === 'mymemory' && (
              <div>
                <label htmlFor="myMemoryEmailInput" className="settings-field-label">
                  {t('MyMemory 联系邮箱（可选）')}
                </label>
                <input
                  id="myMemoryEmailInput"
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  className="nd-input w-full"
                  value={draft.email || ''}
                  placeholder="name@example.com"
                  onChange={(e) => {
                    setDraft({ ...draft, email: e.target.value });
                    setError('');
                  }}
                />
                <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                  {t(
                    '无需注册 MyMemory。留空匿名调用；填写有效邮箱可申请更高的免费每日额度，实际额度以服务方为准。邮箱会随翻译请求发送给 MyMemory。'
                  )}
                </p>
                <div className="mt-2">
                  <a
                    href="https://mymemory.translated.net/doc/usagelimits.php"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tool-note"
                  >
                    {t('查看 MyMemory 官方额度说明')}
                  </a>
                </div>
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs" style={{ color: 'var(--danger, #ef4444)' }}>
                {error}
              </p>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button type="button" className="nd-ghost-btn" onClick={onClose}>
              {t('取消')}
            </button>
            <button type="button" className="settings-save-button primary" onClick={handleSave}>
              {t('保存')}
            </button>
          </div>
        </div>
      </div>
    </SettingsConfigLayer>
  );
}
