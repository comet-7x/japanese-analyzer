'use client';

import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Icon, I } from '../../components/Icons';
import { useLanguage } from '../../contexts/LanguageContext';
import { getSpeechPlaybackSnapshot, subscribeSpeechPlayback } from '../../lib/speechPlaybackStore';
import { placeCapsuleSurface } from './capsuleLayout';

export interface CompanionControls {
  anchor: HTMLElement;
  collapsed: boolean;
  preparing: boolean;
  readingAvailable: boolean;
  readingText: string;
  readingError: string;
  onRead: () => void;
  onSettings: () => void;
  onCollapse: () => void;
  onRestore: () => void;
  onMoveCapsule: (x: number, y: number, commit: boolean) => void;
}

interface Props {
  controls: CompanionControls;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  composer: ReactNode;
  panel: ReactNode;
}

const back = <I w={14} sw={1.7}><path d="M15 6l-6 6 6 6" /></I>;

export default function CompanionCapsule({ controls, open, onOpenChange, composer, panel }: Props) {
  const { t } = useLanguage();
  const reduce = useReducedMotion();
  const [view, setView] = useState<'rest' | 'menu' | 'settings'>('rest');
  const [layout, setLayout] = useState<ReturnType<typeof placeCapsuleSurface> | null>(null);
  const [panelLayout, setPanelLayout] = useState<ReturnType<typeof placeCapsuleSurface> | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restRef = useRef<HTMLButtonElement>(null);
  const menuChatRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number; moved: boolean; lastX: number; lastY: number } | null>(null);
  const suppressClick = useRef(false);
  const suppressFocusOpen = useRef(false);
  const speech = useSyncExternalStore(subscribeSpeechPlayback, getSpeechPlaybackSnapshot, () => null);
  const activeSpeech = speech?.text === controls.readingText ? speech : null;
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const readingLabel = controls.preparing ? '取消准备朗读' : activeSpeech?.status === 'playing' ? '暂停朗读' : activeSpeech?.status === 'paused' ? '继续朗读' : '阅读';

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useLayoutEffect(() => {
    const anchor = controls.anchor;
    const surface = surfaceRef.current;
    if (!surface) return;
    let frame = 0;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const viewport = { x: vv?.offsetLeft ?? 0, y: vv?.offsetTop ?? 0, width: vv?.width ?? window.innerWidth, height: vv?.height ?? window.innerHeight };
      const targetWidth = open ? 360 : view === 'settings' ? 236 : view === 'menu' ? (controls.collapsed ? 236 : 188) : 64;
      const targetHeight = Math.max(44, surface.offsetHeight);
      const next = placeCapsuleSurface({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }, { width: targetWidth, height: targetHeight }, viewport);
      // Keep the collapsed drag line at the same footpoint as its menu opens above it.
      if (controls.collapsed && !open && view !== 'settings') next.y = Math.max(viewport.y + 8, Math.min(rect.bottom - next.height, viewport.y + viewport.height - next.height - 8));
      const chatHeight = Math.max(0, Math.min(380, viewport.height - next.height - 36));
      // A character near the top must still leave room above its chat composer.
      if (open) next.y = Math.max(next.y, viewport.y + chatHeight + 18);
      setLayout(previous => previous && Object.keys(next).every(key => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next);
      if (open) {
        setPanelLayout(placeCapsuleSurface(next, { width: 360, height: chatHeight }, viewport, true));
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const observer = new ResizeObserver(schedule);
    observer.observe(anchor); observer.observe(surface);
    // Model dragging changes its position without changing the anchor's size.
    const mutations = new MutationObserver(schedule);
    mutations.observe(anchor, { attributes: true, attributeFilter: ['style'] });
    if (anchor.parentElement) mutations.observe(anchor.parentElement, { attributes: true, attributeFilter: ['style', 'class'] });
    measure();
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    return () => {
      observer.disconnect(); mutations.disconnect(); cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [controls.anchor, controls.collapsed, open, view]);

  useEffect(() => {
    if (!open && view !== 'settings') return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || surfaceRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
      onOpenChange(false); setView('rest');
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, view, onOpenChange]);

  const showMenu = (focus = false) => {
    cancelClose(); onOpenChange(false); setView('menu');
    if (focus) requestAnimationFrame(() => menuChatRef.current?.focus());
  };
  const moveLine = (event: ReactPointerEvent<HTMLButtonElement>, commit = false) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.x; const dy = event.clientY - active.y;
    if (Math.hypot(dx, dy) >= 5) active.moved = true;
    if (active.moved) {
      suppressClick.current = true;
      cancelClose(); setView('rest');
      active.lastX = active.left + dx; active.lastY = active.top + dy;
      controls.onMoveCapsule(active.lastX, active.lastY, commit);
    }
  };
  const finishLine = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.id !== event.pointerId) return;
    if (event.type === 'pointerup') moveLine(event, true);
    else if (drag.current.moved) controls.onMoveCapsule(drag.current.lastX, drag.current.lastY, true);
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const line = <button ref={restRef} type="button" className={`live2d-capsule-line${controls.collapsed ? ' is-movable' : ''}`}
    aria-label={t(controls.collapsed ? '拖动胶囊或点击打开菜单' : '打开看板娘菜单')} aria-expanded={view === 'menu'}
    onFocus={() => {
      if (suppressFocusOpen.current) { suppressFocusOpen.current = false; return; }
      if (!drag.current) showMenu(!controls.collapsed);
    }}
    onPointerDown={event => {
      if (!controls.collapsed || !event.isPrimary || event.button !== 0) return;
      const rect = controls.anchor.getBoundingClientRect();
      suppressClick.current = false; cancelClose();
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false, lastX: rect.left, lastY: rect.top };
      event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault();
    }} onPointerMove={event => moveLine(event)} onPointerUp={finishLine} onPointerCancel={finishLine} onLostPointerCapture={finishLine}
    onKeyDown={event => {
      if (!controls.collapsed || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const rect = controls.anchor.getBoundingClientRect(); const step = event.shiftKey ? 40 : 12;
      controls.onMoveCapsule(rect.left + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), rect.top + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0), true);
    }} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } showMenu(true); }}><span /></button>;
  const transition = reduce ? { duration: 0.12 } : { type: 'spring' as const, duration: 0.3, bounce: 0 };
  return createPortal(<>
    <div ref={surfaceRef} className="live2d-capsule-surface" data-view={open ? 'chat' : view}
      style={{ left: layout ? layout.x + layout.width / 2 : 0, top: layout?.y ?? 0, width: layout?.width ?? 64, transform: 'translateX(-50%)', visibility: layout ? 'visible' : 'hidden' }}
      onPointerEnter={event => { cancelClose(); if (!drag.current && event.pointerType === 'mouse' && !open && view === 'rest') setView('menu'); }}
      onPointerLeave={() => { if (!open && view === 'menu') { cancelClose(); closeTimer.current = setTimeout(() => { if (!surfaceRef.current?.contains(document.activeElement)) setView('rest'); }, 220); } }}
      onBlur={event => { if (!open && view === 'menu' && !event.currentTarget.contains(event.relatedTarget)) setView('rest'); }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault(); event.stopPropagation(); onOpenChange(false); setView('rest');
        suppressFocusOpen.current = true;
        requestAnimationFrame(() => { restRef.current?.focus(); suppressFocusOpen.current = false; });
      }}>
      <motion.div className="live2d-capsule" layout={!reduce && !controls.collapsed} transition={transition}>
        {open ? <div className="live2d-capsule-chat">
          <button type="button" className="live2d-capsule-back" aria-label={t('返回')} title={t('返回')} onClick={() => showMenu(true)}>{back}</button>
          {composer}
        </div> : view === 'settings' ? <div className="live2d-capsule-settings">
          <div className="live2d-capsule-settings-heading"><button ref={backRef} type="button" className="live2d-capsule-back" aria-label={t('返回')} onClick={() => showMenu(true)}>{back}</button><span>{t('角色设置')}</span></div>
          <button type="button" className="live2d-capsule-setting-row" onClick={() => { setView('rest'); controls.onSettings(); }}>{Icon.gear}<span>{t('角色设置')}</span></button>
          <button type="button" className="live2d-capsule-setting-row" onClick={() => { setView('rest'); if (controls.collapsed) controls.onRestore(); else controls.onCollapse(); }}>{controls.collapsed ? Icon.companion : Icon.dock}<span>{t(controls.collapsed ? '展开看板娘' : '收起')}</span></button>
        </div> : view === 'menu' ? <div className="live2d-capsule-actions" role="group" aria-label={t('角色操作')}>
          <button ref={menuChatRef} type="button" aria-label={t('聊天')} title={t('聊天')} onClick={() => onOpenChange(true)}>{Icon.chat}</button>
          <span className="live2d-capsule-divider" aria-hidden="true" />
          <button type="button" disabled={!controls.readingAvailable && !controls.preparing} aria-label={t(readingLabel)} title={t(readingLabel)} aria-busy={controls.preparing} onClick={controls.onRead}>
            {controls.preparing ? <span className="live2d-capsule-loading">{Icon.stop}</span> : activeSpeech?.status === 'playing' ? <I><path d="M9 5v14M15 5v14" /></I> : Icon.speaker}
          </button>
          <span className="live2d-capsule-divider" aria-hidden="true" />
          <button type="button" aria-label={t('设置')} title={t('设置')} onClick={() => { setView('settings'); requestAnimationFrame(() => backRef.current?.focus()); }}>{Icon.gear}</button>
          {controls.collapsed && <><span className="live2d-capsule-divider" aria-hidden="true" /><button type="button" aria-label={t('展开看板娘')} title={t('展开看板娘')} onClick={controls.onRestore}>{Icon.companion}</button></>}
        </div> : !controls.collapsed ? line : null}
        {controls.collapsed && !open && view !== 'settings' && line}
      </motion.div>
      {!!controls.readingError && view !== 'rest' && !open && <p className="live2d-capsule-error" role="alert">{controls.readingError}</p>}
    </div>
    <AnimatePresence initial={false}>
      {open && <motion.div ref={panelRef} key="companion-chat-panel" className="live2d-chat-panel" role="region" aria-label={t('聊天')}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
        style={{ left: panelLayout?.x ?? 0, top: panelLayout?.y ?? 0, width: panelLayout?.width ?? 360, height: panelLayout?.height ?? 380, visibility: panelLayout ? 'visible' : 'hidden' }}>
        {panel}
      </motion.div>}
    </AnimatePresence>
  </>, document.body);
}
