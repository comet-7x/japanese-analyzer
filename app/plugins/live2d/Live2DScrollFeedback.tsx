'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion, useSpring } from 'motion/react';
import { CONTROL_SPRING } from './Live2DSlider';
import { visibleScrollBounds } from './scrollBounds';

interface Metrics { left: number; top: number; height: number; thumb: number; travel: number; offset: number; max: number; percent: number }

// The content keeps native wheel, touch and keyboard scrolling. Only the visible
// thumb has spring lag; the small target marker and aria value always reflect scrollTop.
export default function Live2DScrollFeedback({ target, ownerId, label, zIndex = 1100, layoutKey }: {
  target: HTMLElement; ownerId: string; label: string; zIndex?: number; layoutKey?: string;
}) {
  const reduced = useReducedMotion();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [active, setActive] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; y: number; scroll: number } | null>(null);
  const lastTop = useRef(target.scrollTop);
  const lastImpulse = useRef(0);
  const requestMeasure = useRef<() => void>(() => {});
  const position = useSpring(0, CONTROL_SPRING);
  const impulse = useSpring(0, { stiffness: 900, damping: 22, mass: .3 });
  const current = useRef(metrics);
  current.current = metrics;
  const targetId = target.id || ownerId;
  const hasMetrics = metrics !== null;

  useEffect(() => {
    const hadId = !!target.id;
    if (!hadId) target.id = targetId;
    let frame = 0;
    let initialized = false;
    const measure = () => {
      frame = 0;
      const rect = visibleScrollBounds(target);
      const max = target.scrollHeight - target.clientHeight;
      const top = Math.max(rect.top + 8, 8);
      const height = Math.max(0, Math.min(rect.bottom - 8, window.innerHeight - 8) - top);
      const visible = target.isConnected && max > 1 && height >= 48 && rect.right - rect.left >= 20;
      target.classList.toggle('live2d-enhanced-scroll', visible);
      if (!visible) { setMetrics(null); return; }
      const thumb = Math.min(height, Math.max(36, height * target.clientHeight / target.scrollHeight));
      const travel = height - thumb;
      const percent = Math.max(0, Math.min(1, target.scrollTop / max));
      const offset = travel * percent;
      if (!initialized || reduced || current.current?.height !== height) position.jump(offset);
      else position.set(offset);
      if (!reduced && Math.abs(target.scrollTop - lastTop.current) > 1 && performance.now() - lastImpulse.current > 80) {
        impulse.jump(.65); impulse.set(0); lastImpulse.current = performance.now();
      }
      lastTop.current = target.scrollTop;
      initialized = true;
      setMetrics({ left: rect.right - 15, top, height, thumb, travel, offset, max, percent });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    requestMeasure.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(target);
    for (let parent = target.parentElement; parent; parent = parent.parentElement) observer.observe(parent);
    Array.from(target.children).forEach(child => observer.observe(child));
    const panel = target.querySelector('.live2d-settings');
    if (panel) observer.observe(panel);
    target.addEventListener('scroll', schedule, { passive: true });
    target.addEventListener('transitionend', schedule);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      requestMeasure.current = () => {};
      target.classList.remove('live2d-enhanced-scroll');
      if (!hadId && target.id === targetId) target.removeAttribute('id');
      target.removeEventListener('scroll', schedule);
      target.removeEventListener('transitionend', schedule);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    };
  }, [target, targetId, reduced, position, impulse]);

  useEffect(() => { requestMeasure.current(); }, [layoutKey]);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const wheel = (event: WheelEvent) => {
      const before = target.scrollTop;
      target.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1);
      if (target.scrollTop !== before && event.cancelable) event.preventDefault();
    };
    rail.addEventListener('wheel', wheel, { passive: false });
    return () => rail.removeEventListener('wheel', wheel);
  }, [target, hasMetrics]);

  if (!metrics) return null;
  return createPortal(<div ref={railRef} className="live2d-scroll-feedback" data-live2d-scroll-owner={ownerId}
    data-active={active || undefined} role="scrollbar" tabIndex={0} aria-label={label} aria-controls={targetId}
    aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(metrics.percent * 100)}
    style={{ left: metrics.left, top: metrics.top, height: metrics.height, zIndex }}
    onKeyDown={event => {
      const moves: Record<string, number> = { ArrowDown: 40, ArrowUp: -40, PageDown: target.clientHeight * .9, PageUp: -target.clientHeight * .9 };
      if (event.key === 'Home') target.scrollTop = 0;
      else if (event.key === 'End') target.scrollTop = metrics.max;
      else if (moves[event.key] !== undefined) target.scrollTop += moves[event.key];
      else return;
      event.preventDefault();
    }}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setActive(true);
      const y = event.clientY - metrics.top;
      if (y < metrics.offset || y > metrics.offset + metrics.thumb) {
        target.scrollTop = Math.max(0, Math.min(1, (y - metrics.thumb / 2) / metrics.travel)) * metrics.max;
      }
      drag.current = { pointerId: event.pointerId, y: event.clientY, scroll: target.scrollTop };
    }}
    onPointerMove={event => {
      const start = drag.current, m = current.current;
      if (start?.pointerId === event.pointerId && m?.travel) target.scrollTop = start.scroll + (event.clientY - start.y) / m.travel * m.max;
    }}
    onPointerUp={event => {
      drag.current = null; setActive(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; setActive(false); }}
    onLostPointerCapture={() => { drag.current = null; setActive(false); }}>
    <span className="live2d-scroll-target" aria-hidden="true" style={{ top: metrics.offset, height: metrics.thumb }} />
    <motion.span className="live2d-scroll-thumb-position" aria-hidden="true" style={{ height: metrics.thumb, y: position }}>
      <motion.span className="live2d-scroll-thumb" style={{ x: impulse }} />
    </motion.span>
  </div>, document.body);
}
