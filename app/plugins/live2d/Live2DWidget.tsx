'use client';

import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type CSSProperties, type RefObject, type Dispatch, type SetStateAction } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import { localizeError } from '../../i18n';
import { getSpeechEnvelope, type SpeechEnvelope } from './audioEnvelope';
import { getLive2DModelFiles } from './modelLibrary';
import { getSpeechPlaybackSnapshot, subscribeSpeechPlayback, type SpeechPlaybackSnapshot } from '../../lib/speechPlaybackStore';
import { speechPages, speechGraphemes, speechRangeProgress } from '../../lib/speechReading';
import { getSpeechReadingFrame, subscribeSpeechReadingFrame, useSpeechReading, type SpeechReadingSnapshot } from '../../lib/speechReadingStore';
import { setSpeechSweep } from '../../lib/speechSweep';
import { shortcutFromEvent } from './actionProfile';
import type { Live2DCanvasHandle } from './Live2DCanvas';
import { LIVE2D_SCALE, updateLive2DModelConfig, type Live2DSettings } from './settings';
import { moodForAnalysis, type CompanionAnalysisEvent, type CompanionMood } from './companion';
import { placeBubble } from './bubble';
import { scaleFromWheel } from './scale';
import Live2DScrollFeedback from './Live2DScrollFeedback';
import { isCharacterTap } from './interaction';

const Live2DCanvas = dynamic(() => import('./Live2DCanvas'), { ssr: false });

interface Props {
  settings: Live2DSettings;
  analysisEvent?: CompanionAnalysisEvent | null;
  onSettingsChange: Dispatch<SetStateAction<Live2DSettings>>;
  onOpenSettings: () => void;
  onCapsuleAnchorChange: (anchor: HTMLElement | null) => void;
  capsuleMoveRef: RefObject<((x: number, y: number, commit: boolean) => void) | null>;
}

type Viewport = 'pending' | 'mobile' | 'compact' | 'wide';
type Position = { x: number; y: number };
type PositionKey = 'position' | 'mobilePosition';

function clampPosition(position: Position, width: number, height: number): Position {
  const edge = 8;
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + edge;
  const top = (viewport?.offsetTop ?? 0) + edge;
  return {
    x: Math.min(Math.max(left, left + (viewport?.width ?? window.innerWidth) - width - 2 * edge), Math.max(left, position.x)),
    y: Math.min(Math.max(top, top + (viewport?.height ?? window.innerHeight) - height - 2 * edge), Math.max(top, position.y)),
  };
}

export default function Live2DWidget({ settings, analysisEvent = null, onSettingsChange, onOpenSettings, onCapsuleAnchorChange, capsuleMoveRef }: Props) {
  const { t, locale } = useLanguage();
  const canvasRef = useRef<Live2DCanvasHandle>(null);
  const widgetRef = useRef<HTMLElement>(null);
  const scaleControlRef = useRef<HTMLDivElement>(null);
  const [capsuleAnchor, setCapsuleAnchor] = useState<HTMLDivElement | null>(null);
  const visualCenterRef = useRef(.5);
  const latestSettingsRef = useRef(settings);
  latestSettingsRef.current = settings;
  const onSettingsChangeRef = useRef(onSettingsChange);
  onSettingsChangeRef.current = onSettingsChange;
  const visualScaleRef = useRef(settings.scale);
  const pendingScaleRef = useRef<{ modelId: string | null; scale: number } | null>(null);
  const saveScaleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scaleFrameRef = useRef(0);
  const [visualScale, setVisualScale] = useState(settings.scale);
  const keyboardModality = useRef(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [mood, setMood] = useState<CompanionMood>('idle');
  const [envelope, setEnvelope] = useState<SpeechEnvelope | null>(null);

  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number; key: PositionKey; startX: number; startY: number; moved: boolean } | null>(null);
  const positionRef = useRef<Position | null>(null);
  const stageSizeRef = useRef({ width: 96, height: 44 });
  const [position, setPosition] = useState<Position | null>(null);
  const [collapsedPosition, setCollapsedPosition] = useState<Position | null>(null);
  const restoreFootpoint = useRef<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const [messageTarget, setMessageTarget] = useState<HTMLParagraphElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>('pending');
  const [source, setSource] = useState<File[] | null>(null);
  const [modelName, setModelName] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const [speech, setSpeech] = useState<SpeechPlaybackSnapshot | null>(() => getSpeechPlaybackSnapshot());
  const docked = settings.minimized;
  const positionKey: PositionKey = viewport === 'mobile' ? 'mobilePosition' : 'position';
  const savedPosition = settings[positionKey];
  const capsulePositionKey = viewport === 'mobile' ? 'mobileCapsulePosition' : 'capsulePosition';
  const savedCapsulePosition = settings[capsulePositionKey];
  const savedCapsuleX = savedCapsulePosition?.x;
  const savedCapsuleY = savedCapsulePosition?.y;

  useEffect(() => {
    // Browser focus-visible heuristics can carry keyboard state into restored or programmatic focus.
    // Require a real navigation key before showing the large character-stage indicator.
    const keyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing
        || !['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].includes(event.key)) return;
      keyboardModality.current = true;
      if (document.activeElement === scaleControlRef.current) setKeyboardFocus(true);
    };
    const pointerDown = () => { keyboardModality.current = false; setKeyboardFocus(false); };
    document.addEventListener('keydown', keyDown, true);
    document.addEventListener('pointerdown', pointerDown, true);
    return () => {
      document.removeEventListener('keydown', keyDown, true);
      document.removeEventListener('pointerdown', pointerDown, true);
    };
  }, []);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 640px)');
    const compact = window.matchMedia('(max-width: 1239px)');
    const update = () => setViewport(mobile.matches ? 'mobile' : compact.matches ? 'compact' : 'wide');
    update();
    mobile.addEventListener('change', update);
    compact.addEventListener('change', update);
    return () => {
      mobile.removeEventListener('change', update);
      compact.removeEventListener('change', update);
    };
  }, []);

  useLayoutEffect(() => {
    if (docked) return;
    const widget = widgetRef.current;
    if (!widget) return;
    let previousSize: { width: number; height: number } | null = null;
    const keepInView = () => {
      if (dragRef.current) return;
      const rect = widget.getBoundingClientRect();
      const saved = latestSettingsRef.current[positionKey];
      const current = previousSize ? positionRef.current : saved;
      // Grow around the character's bottom centre, then keep the whole stage visible.
      const anchor = current ?? { x: rect.left, y: rect.top };
      const footpoint = restoreFootpoint.current;
      const next = clampPosition({
        x: footpoint ? footpoint.x + 48 - rect.width * visualCenterRef.current : anchor.x - (previousSize ? (rect.width - previousSize.width) * visualCenterRef.current : 0),
        y: footpoint ? footpoint.y + 44 - rect.height : anchor.y - (previousSize ? rect.height - previousSize.height : 0),
      }, rect.width, rect.height);
      restoreFootpoint.current = null;
      if (footpoint) onSettingsChangeRef.current(current => ({ ...current, [positionKey]: next }));
      previousSize = { width: rect.width, height: rect.height };
      stageSizeRef.current = previousSize;
      positionRef.current = next;
      setPosition(previous => previous?.x === next.x && previous.y === next.y ? previous : next);
    };
    keepInView();
    const observer = new ResizeObserver(keepInView);
    observer.observe(widget);
    window.addEventListener('resize', keepInView);
    window.visualViewport?.addEventListener('resize', keepInView);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', keepInView);
      window.visualViewport?.removeEventListener('resize', keepInView);
    };
  }, [docked, positionKey, savedPosition?.x, savedPosition?.y]);

  useLayoutEffect(() => {
    if (!docked) { setCollapsedPosition(null); return; }
    const keepCapsuleInView = () => {
      const widget = widgetRef.current;
      if (!widget) return;
      const rect = widget.getBoundingClientRect();
      // A freshly collapsed character keeps its footpoint; a hidden character on reload restores its saved capsule.
      const point = !positionRef.current && savedCapsuleX !== undefined && savedCapsuleY !== undefined ? { x: savedCapsuleX, y: savedCapsuleY } : { x: rect.left, y: rect.top };
      const next = clampPosition(point, rect.width, rect.height);
      restoreFootpoint.current = next; setCollapsedPosition(next);
      return next;
    };
    const initial = keepCapsuleInView();
    if (initial && (initial.x !== savedCapsuleX || initial.y !== savedCapsuleY)) onSettingsChangeRef.current(current => ({ ...current, [capsulePositionKey]: initial }));
    window.addEventListener('resize', keepCapsuleInView);
    window.visualViewport?.addEventListener('resize', keepCapsuleInView);
    return () => {
      window.removeEventListener('resize', keepCapsuleInView);
      window.visualViewport?.removeEventListener('resize', keepCapsuleInView);
    };
  }, [docked, capsulePositionKey, savedCapsuleX, savedCapsuleY]);

  useEffect(() => {
    onCapsuleAnchorChange(settings.enabled && source && !loadError ? capsuleAnchor : null);
    return () => onCapsuleAnchorChange(null);
  }, [settings.enabled, source, loadError, capsuleAnchor, onCapsuleAnchorChange]);

  useLayoutEffect(() => {
    capsuleMoveRef.current = (x, y, commit) => {
      const widget = widgetRef.current;
      if (!docked || !widget || !capsuleAnchor) return;
      const rect = widget.getBoundingClientRect();
      const anchor = capsuleAnchor.getBoundingClientRect();
      const actual = clampPosition({ x: rect.left + x - anchor.left, y: rect.top + y - anchor.top }, rect.width, rect.height);
      restoreFootpoint.current = actual; setCollapsedPosition(actual);
      if (commit) onSettingsChangeRef.current(current => ({ ...current, [capsulePositionKey]: actual }));
    };
    return () => { capsuleMoveRef.current = null; };
  }, [capsuleMoveRef, docked, capsuleAnchor, capsulePositionKey]);

  useEffect(() => subscribeSpeechPlayback(() => {
    const next = getSpeechPlaybackSnapshot();
    setSpeech(previous => previous?.id === next?.id && previous?.status === next?.status ? previous : next);
  }), []);
  useEffect(() => {
    const changed = () => setModelRevision((revision) => revision + 1);
    window.addEventListener('live2d:models-changed', changed);
    return () => window.removeEventListener('live2d:models-changed', changed);
  }, []);

  useEffect(() => {
    if (!settings.enabled || !settings.modelId) {
      setSource(null);
      setModelName('');
      setLoadError('');
      return;
    }
    let disposed = false;
    setLoading(true);
    setSource(null);
    setLoadError('');
    void getLive2DModelFiles(settings.modelId).then((record) => {
      if (disposed) return;
      if (!record) throw new Error(t('所选角色模型已不存在，请重新导入。'));
      setSource(record.files);
      setModelName(record.model.name);
    }).catch((cause) => {
      if (!disposed) setLoadError(cause instanceof Error ? cause.message : t('无法读取本地角色模型。'));
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [settings.enabled, settings.modelId, modelRevision, t]);

  useEffect(() => {
    setEnvelope(null);
    if (!settings.enabled || docked || !settings.lipSync || speech?.source !== 'audio' || !speech.blob) return;
    let cancelled = false;
    void getSpeechEnvelope(speech.blob).then(result => {
      if (!cancelled) setEnvelope(result);
    }).catch(() => { /* The audio player remains independent when decoding fails. */ });
    return () => { cancelled = true; };
  }, [settings.enabled, settings.lipSync, speech?.id, speech?.source, speech?.blob, docked]);

  useEffect(() => {
    const next = moodForAnalysis(analysisEvent, Date.now());
    setMood(next);
    if (next !== 'success' && next !== 'error') return;
    const timer = window.setTimeout(() => setMood('idle'), Math.max(0, 3500 - (Date.now() - analysisEvent!.at)));
    return () => window.clearTimeout(timer);
  }, [analysisEvent]);

  const flushScaleRef = useRef<() => void>(() => {});
  flushScaleRef.current = () => {
    if (saveScaleRef.current) clearTimeout(saveScaleRef.current);
    saveScaleRef.current = null;
    const pending = pendingScaleRef.current;
    pendingScaleRef.current = null;
    const current = latestSettingsRef.current;
    if (!pending || !current.enabled || current.modelId !== pending.modelId) return;
    const next = updateLive2DModelConfig(current, pending.modelId, { scale: pending.scale });
    latestSettingsRef.current = next;
    onSettingsChangeRef.current(current => updateLive2DModelConfig(current, pending.modelId, { scale: pending.scale }));
  };

  const previewScaleRef = useRef<(value: number) => void>(() => {});
  previewScaleRef.current = value => {
    const next = Math.max(LIVE2D_SCALE.min, Math.min(LIVE2D_SCALE.max, value));
    visualScaleRef.current = next;
    pendingScaleRef.current = { modelId: latestSettingsRef.current.modelId, scale: next };
    if (!scaleFrameRef.current) scaleFrameRef.current = window.requestAnimationFrame(() => {
      scaleFrameRef.current = 0;
      setVisualScale(visualScaleRef.current);
    });
    canvasRef.current?.wakeRenderer();
    if (saveScaleRef.current) clearTimeout(saveScaleRef.current);
    saveScaleRef.current = setTimeout(() => flushScaleRef.current(), 200);
  };

  useEffect(() => {
    if (!pendingScaleRef.current) {
      visualScaleRef.current = settings.scale;
      setVisualScale(settings.scale);
    }
  }, [settings.scale]);

  useEffect(() => {
    pendingScaleRef.current = null;
    if (saveScaleRef.current) clearTimeout(saveScaleRef.current);
    window.cancelAnimationFrame(scaleFrameRef.current);
    scaleFrameRef.current = 0;
    visualScaleRef.current = latestSettingsRef.current.scale;
    setVisualScale(visualScaleRef.current);
    dragRef.current = null; setDragging(false);
    return () => {
      if (saveScaleRef.current) clearTimeout(saveScaleRef.current);
      window.cancelAnimationFrame(scaleFrameRef.current);
      scaleFrameRef.current = 0;
    };
  }, [settings.modelId, docked]);

  useEffect(() => {
    const node = scaleControlRef.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !event.cancelable) return;
      event.preventDefault();
      previewScaleRef.current(scaleFromWheel(visualScaleRef.current, event.deltaY, event.deltaMode, window.innerHeight));
    };
    const flush = () => flushScaleRef.current();
    node.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('pagehide', flush);
    return () => {
      node.removeEventListener('wheel', wheel);
      window.removeEventListener('pagehide', flush);
    };
  }, [docked]);

  if (!settings.enabled) return null;

  const savePosition = (key: PositionKey, next: Position) => {
    const updated = { ...latestSettingsRef.current, [key]: next };
    latestSettingsRef.current = updated;
    onSettingsChange(current => ({ ...current, [key]: next }));
  };

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('button, input, textarea, a')) return;
    const widget = widgetRef.current;
    if (!widget) return;
    const rect = widget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      key: positionKey,
      startX: event.clientX, startY: event.clientY, moved: false,
    };
    const initial = clampPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
    positionRef.current = initial;
    setPosition(initial);
    canvasRef.current?.wakeRenderer();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const widget = widgetRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !widget) return;
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;
      drag.moved = true;
      setDragging(true);
    }
    const next = clampPosition(
      { x: event.clientX - drag.offsetX, y: event.clientY - drag.offsetY },
      widget.offsetWidth,
      widget.offsetHeight,
    );
    positionRef.current = next;
    setPosition(next);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup') moveDrag(event);
    const tapped = isCharacterTap(drag, event);
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (tapped) void canvasRef.current?.tapAt(event.clientX, event.clientY);
    const widget = widgetRef.current;
    if (drag.moved && positionRef.current && widget) {
      const current = positionRef.current;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const rightEdge = left + (viewport?.width ?? window.innerWidth);
      const right = rightEdge - current.x - widget.offsetWidth;
      const next = clampPosition({ x: current.x - left < 48 ? left + 16 : right < 48
        ? rightEdge - widget.offsetWidth - 16 : current.x, y: current.y }, widget.offsetWidth, widget.offsetHeight);
      positionRef.current = next;
      setPosition(next);
      savePosition(drag.key, next);
    }
  };

  const moveWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    const shortcut = shortcutFromEvent(event);
    if (shortcut && !event.repeat && canvasRef.current?.triggerShortcut(shortcut)) {
      event.preventDefault(); event.stopPropagation(); return;
    }
    if (event.repeat && shortcut) { event.preventDefault(); return; }
    const offsets: Record<string, Position> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const offset = offsets[event.key];
    const widget = widgetRef.current;
    if (!offset || !widget) return;
    event.preventDefault();
    const rect = widget.getBoundingClientRect();
    const previous = positionRef.current ?? { x: rect.left, y: rect.top };
    const step = event.shiftKey ? 40 : 12;
    const next = clampPosition(
      { x: previous.x + offset.x * step, y: previous.y + offset.y * step },
      rect.width,
      rect.height,
    );
    positionRef.current = next;
    setPosition(next);
    savePosition(positionKey, next);
  };

  return (
    <section
      ref={widgetRef}
      className={`live2d-widget ${docked ? 'is-docked' : ''} ${dragging ? 'is-dragging' : ''} ${viewport === 'mobile' ? (docked ? 'is-mobile-collapsed' : 'is-mobile-expanded') : ''} ${viewport === 'compact' ? 'is-narrow-desktop' : ''}`}
      style={{ '--live2d-scale': visualScale,
        ...(docked && collapsedPosition ? { left: collapsedPosition.x, top: collapsedPosition.y, right: 'auto', bottom: 'auto' }
          : position ? { left: docked ? position.x + stageSizeRef.current.width * visualCenterRef.current - 48 : position.x,
            top: docked ? position.y + stageSizeRef.current.height - 44 : position.y, right: 'auto', bottom: 'auto' } : {}),
      } as CSSProperties}
      aria-label={t('虚拟角色服务')}
    >
      {!docked && (
        <>
          <div className="live2d-widget-body live2d-character-drag-region" style={{ opacity: settings.opacity }}
            ref={scaleControlRef} role="group" tabIndex={0} aria-label={t('拖动看板娘')} title={modelName || undefined}
            data-keyboard-focus={keyboardFocus ? 'true' : undefined}
            onFocus={event => { if (event.target === event.currentTarget) setKeyboardFocus(keyboardModality.current); }}
            onBlur={() => setKeyboardFocus(false)}
            aria-describedby="live2d-character-instructions" aria-keyshortcuts="Enter Space Shift+Enter ArrowLeft ArrowRight ArrowUp ArrowDown"
            onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}
            onPointerCancel={finishDrag} onLostPointerCapture={finishDrag} onKeyDown={moveWithKeyboard}>
            {source && !loadError ? (
              <Live2DCanvas
                ref={canvasRef}
                source={source}
                onVisualCenterChange={center => {
                  visualCenterRef.current = center;
                  if (capsuleAnchor && !docked) capsuleAnchor.style.transform = `translateX(${(center - .5) * 100}%)`;
                }}
                interactionProfile={settings.modelId ? settings.modelConfigs[settings.modelId]?.interaction : undefined}
                className="live2d-widget-canvas"
                dragging={dragging}
                pauseWhenIdle={settings.pauseWhenIdle}
                mood={mood}
                speech={speech}
                envelope={envelope}
                lipSync={settings.lipSync}
                sensitivity={settings.sensitivity}
                trackPointer={settings.trackPointer}
                onError={(cause) => setLoadError(cause.message.includes('Cubism Core')
                  ? t('缺少 Live2D 官方运行库。请按项目文档安装 Cubism Core。')
                  : cause.message)}
              />
            ) : (
              <div className="live2d-widget-placeholder" role={loadError ? 'alert' : undefined}>
                <p ref={setMessageTarget}>{(loadError && localizeError(loadError, locale)) || (loading ? t('正在加载角色…') : t('请先在设置中导入角色模型。'))}</p>
                {messageTarget && <Live2DScrollFeedback target={messageTarget} ownerId="live2d-widget-message" label={t('滚动角色说明')} zIndex={855}
                  layoutKey={`${visualScale}:${position?.x}:${position?.y}`} />}
                <button type="button" className="nd-ghost-btn" onClick={onOpenSettings}>{t('打开看板娘设置')}</button>
              </div>
            )}
            <span id="live2d-character-instructions" className="sr-only">{t('轻点角色部位触发动作，拖动移动角色。方向键移动，Enter 或空格互动，Shift+Enter 触发头部互动；需要模型支持。')}</span>
          </div>
          <AnimatePresence initial={false}>
            {speech?.text && <SpeechBubble key={speech.id} anchorRef={widgetRef} position={position} speech={speech} mobile={viewport === 'mobile'} />}
          </AnimatePresence>
        </>
      )}
      <div ref={setCapsuleAnchor} className="live2d-capsule-anchor" aria-hidden="true"
        style={{ transform: docked ? undefined : `translateX(${(visualCenterRef.current - .5) * 100}%)` }} />
    </section>
  );
}

function SpeechBubble({ anchorRef, position, speech, mobile }: {
  anchorRef: RefObject<HTMLElement | null>; position: Position | null; speech: SpeechPlaybackSnapshot; mobile: boolean;
}) {
  const { text } = speech;
  const reading = useSpeechReading();
  const retainedReading = useRef<SpeechReadingSnapshot | null>(null);
  if (reading?.id === speech.id) retainedReading.current = reading;
  const pages = useMemo(() => speechPages(text), [text]);
  // Keep the final page/word intact while AnimatePresence fades out the ended session.
  const active = reading?.id === speech.id ? reading : retainedReading.current;
  const page = pages.find(part => part.start <= (active?.start ?? 0) && part.end > (active?.start ?? 0)) ?? pages[0];
  const pageText = text.slice(page?.start ?? 0, page?.end ?? 0);
  const start = (page?.start ?? 0) + (pageText.match(/^\s*/u)?.[0].length ?? 0);
  const end = Math.max(start, (page?.end ?? 0) - (pageText.match(/\s*$/u)?.[0].length ?? 0));
  const highlightStart = Math.max(start, Math.min(end, active?.start ?? start));
  const highlightEnd = Math.max(highlightStart, Math.min(end, active?.end ?? start));
  const fragments = useMemo(() => speechGraphemes(text.slice(start, end)).map(span => ({
    start: span.start + start, end: span.end + start,
  })), [text, start, end]);
  const bubbleRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const page = bubbleRef.current?.querySelector(`[data-speech-page="${start}"]`);
    const entries = Array.from(page?.querySelectorAll<HTMLElement>('.live2d-bubble-fragment') ?? []).map(element => ({
      element, start: Number(element.dataset.speechStart), end: Number(element.dataset.speechEnd),
    }));
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const paint = (frame = getSpeechReadingFrame()) => {
      // Exit keeps the final sweep intact; a newer session cannot repaint it.
      if (!frame || frame.id !== speech.id) return;
      for (const entry of entries) {
        if (entry.start < frame.end && entry.end > frame.start) {
          setSpeechSweep(entry.element, media.matches ? 1 : speechRangeProgress(frame, entry), 4);
        }
      }
    };
    const onPreference = () => paint();
    const unsubscribe = subscribeSpeechReadingFrame(paint);
    paint();
    media.addEventListener('change', onPreference);
    return () => { unsubscribe(); media.removeEventListener('change', onPreference); };
  }, [speech.id, start, end]);
  const [layout, setLayout] = useState<ReturnType<typeof placeBubble> | null>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const measure = () => {
      const rect = anchor.getBoundingClientRect();
      const viewport = window.visualViewport;
      const bounds = { x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
      bubble.style.maxWidth = `${Math.max(0, Math.min(260, bounds.width - 16))}px`;
      bubble.style.maxHeight = `${Math.max(0, Math.min(132, bounds.height - 16))}px`;
      setLayout(placeBubble({ x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        { width: bubble.offsetWidth, height: bubble.offsetHeight }, bounds));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(anchor); observer.observe(bubble);
    measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [anchorRef, position, text]);
  return createPortal(<motion.div className="live2d-bubble-anchor" aria-hidden="true" data-placement={layout?.placement}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: 0.15, ease: 'easeOut' }}
    style={{ left: layout?.x ?? 0, top: layout?.y ?? 0, visibility: layout ? 'visible' : 'hidden',
      zIndex: mobile ? 35 : 850, '--bubble-tail': `${layout?.tail ?? 20}px` } as CSSProperties}>
    <div ref={bubbleRef} className="live2d-comic-bubble" data-page-start={start} data-page-end={end}
      data-timing={active?.approximate ? 'approximate' : 'boundary'} data-status={speech.status}>
      <span className="live2d-bubble-copy" lang="ja">
        <AnimatePresence initial={false}>
          <motion.span key={start} className="live2d-bubble-page" data-speech-page={start}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}>
            {fragments.map(fragment => <span key={fragment.start} className="live2d-bubble-fragment"
              data-speech-start={fragment.start} data-speech-end={fragment.end}
              data-reading-current={fragment.start < highlightEnd && fragment.end > highlightStart ? 'true' : undefined}
              data-reading-start={fragment.start === highlightStart ? 'true' : undefined}
              data-reading-end={fragment.end === highlightEnd ? 'true' : undefined}>
              {text.slice(fragment.start, fragment.end)}
            </span>)}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  </motion.div>, document.body);
}
