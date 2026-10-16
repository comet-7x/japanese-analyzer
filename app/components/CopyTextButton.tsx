'use client';

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { Icon } from './Icons';

export default function CopyTextButton({ text, label = '复制', iconOnly = false }: { text: string; label?: string; iconOnly?: boolean }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle');
  const lifecycle = useRef<{ request: number; timer?: ReturnType<typeof setTimeout> }>({ request: 0 });
  useEffect(() => {
    const current = lifecycle.current;
    setStatus('idle');
    return () => { current.request++; clearTimeout(current.timer); };
  }, [text]);

  const copy = async () => {
    const current = lifecycle.current;
    const id = ++current.request;
    clearTimeout(current.timer);
    setStatus('idle');
    try {
      await navigator.clipboard.writeText(text);
      if (id !== current.request) return;
      setStatus('copied');
      current.timer = setTimeout(() => setStatus('idle'), 1200);
    } catch {
      if (id === current.request) setStatus('manual');
    }
  };

  return <div className="copy-text-control">
    <button type="button" className={iconOnly ? 'dictionary-icon-btn' : 'nd-ghost-btn'} title={status === 'copied' ? t('已复制') : t(label)} aria-label={t(label)} disabled={!text.trim()} onClick={() => void copy()}>
      {status === 'copied' ? Icon.check : Icon.copy}
      <span role="status" className={iconOnly ? 'sr-only' : 'copy-text-label'}>{status === 'copied' ? t('已复制') : t(label)}</span>
    </button>
    {status === 'manual' && <div className="copy-text-fallback">
      <p className="tool-note" role="status">{t('请手动复制')}</p>
      <textarea className="learning-input" aria-label={t('复制内容')} readOnly value={text} onFocus={event => event.target.select()} />
    </div>}
  </div>;
}
