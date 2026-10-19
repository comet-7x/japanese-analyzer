'use client';

import { useEffect, useId, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Icon } from './Icons';

/** Native top-layer dialog stays visible even inside the sticky reading toolbar. */
export default function ImageCapabilityNotice({ model, onClose, onOpenSettings }: {
  model: string; onClose: () => void; onOpenSettings?: () => void;
}) {
  const { t } = useLanguage();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    const body = document.body;
    const overflow = body?.style.overflow;
    if (body) body.style.overflow = 'hidden';
    element?.showModal();
    return () => {
      element?.close();
      if (body) body.style.overflow = overflow ?? '';
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={dialog} className="image-capability-notice" role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <span className="image-notice-icon" aria-hidden="true">{Icon.photo}</span>
    <h2 className="status-error" id={`${id}-title`}>{t('此模型不支持图片')}</h2>
    <p className="image-notice-model">{t('当前模型：{0}', model || t('未配置模型'))}</p>
    <p className="status-error" id={`${id}-description`}>{t('当前模型不支持图片解析，请切换到支持图片输入的多模态模型。')}</p>
    <div className="image-notice-actions">
      {onOpenSettings && <button type="button" className="nd-soft-btn" onClick={() => { onClose(); onOpenSettings(); }}>{t('打开设置')}</button>}
      <button type="button" className="nd-primary-btn" autoFocus onClick={onClose}>{t('知道了')}</button>
    </div>
  </dialog>;
}
