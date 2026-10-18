'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { PhraseRange } from '../utils/phraseRange';

// 手机上长按多久进入圈选
const LONG_PRESS_MS = 450;
// 长按期间手指移动超过这个距离视为滚动，取消长按
const LONG_PRESS_MOVE_TOLERANCE_PX = 10;
const HORIZONTAL_SNAP_HEIGHTS = 1.5;
const VERTICAL_SNAP_HEIGHTS = 0.5;

function tokenIndexFromTarget(target: EventTarget | null): number | null {
  const element = target instanceof Element ? target.closest('[data-token-index]') : null;
  if (!element) return null;
  const index = Number(element.getAttribute('data-token-index'));
  return Number.isInteger(index) ? index : null;
}

interface CachedTokenRect {
  index: number;
  rect: DOMRect;
}

function readTokenRects(container: HTMLElement): CachedTokenRect[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-token-index]')).flatMap(element => {
    const index = Number(element.getAttribute('data-token-index'));
    const rect = element.getBoundingClientRect();
    return Number.isInteger(index) && rect.width > 0 && rect.height > 0 ? [{ index, rect }] : [];
  });
}

function findTokenIndex(
  event: ReactPointerEvent | PointerEvent,
  container: HTMLElement | null,
  cachedRects?: CachedTokenRect[] | null
): number | null {
  const direct = event.target instanceof Node && container?.contains(event.target) ? tokenIndexFromTarget(event.target) : null;
  if (direct !== null) return direct;

  const x = event.clientX;
  const y = event.clientY;

  // 1. 点命中查找（穿透中间覆盖层）
  if (typeof document !== 'undefined' && document.elementsFromPoint) {
    const elements = document.elementsFromPoint(x, y);
    for (const el of elements) {
      if (!container?.contains(el)) continue;
      const idx = tokenIndexFromTarget(el);
      if (idx !== null) return idx;
    }
  }

  // 2. 空间几何吸附（划过行间距、换行空白区域）
  const rects = cachedRects ?? (container ? readTokenRects(container) : []);

  if (rects && rects.length > 0) {
    let closestIndex: number | null = null;
    let minDistance = Infinity;

    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i].rect;
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
      // Scale the gap tolerance with rendered token height, including furigana.
      if (dx > rect.height * HORIZONTAL_SNAP_HEIGHTS || dy > rect.height * VERTICAL_SNAP_HEIGHTS) continue;
      const dist = Math.hypot(dx, dy * 2.2);
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = rects[i].index;
      }
    }
    return closestIndex;
  }

  return null;
}

interface UsePhraseSelectionOptions {
  /** 未提供时不启用圈选（如解析进行中） */
  onRangeSelect?: (a: number, b: number) => void;
  /** Shift 点击的起点：当前选中的词或选区起点 */
  anchorIndex: number | null;
  /** 圈选起点（长按或详情里的「选中多个词」按钮设置），由页面持有 */
  pickAnchor: number | null;
  onPickAnchorChange: (index: number | null) => void;
}

/**
 * 在解析结果上圈选连续多个词 / 长句：
 * - 鼠标：按住拖过长句（支持跨行连续跟踪）；或 Shift + 点击从起点选到终点
 * - 触屏：长按一个词进入圈选，再点另一个词
 * - 详情里的「选中多个词」按钮进入圈选，再点另一个词
 */
export function usePhraseSelection({ onRangeSelect, anchorIndex, pickAnchor, onPickAnchorChange }: UsePhraseSelectionOptions) {
  const [preview, setPreview] = useState<PhraseRange | null>(null);
  const dragRef = useRef<{ anchor: number; current: number } | null>(null);
  const pressRef = useRef<{ timer: number; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);
  const cachedRectsRef = useRef<CachedTokenRect[] | null>(null);
  const observerCleanup = useRef<() => void>(() => undefined);
  // 拖动、Shift 点击、长按之后紧跟的 click 不再当作单词点击
  const suppressClickRef = useRef(false);
  const enabled = !!onRangeSelect;
  const invalidateRects = useCallback(() => { cachedRectsRef.current = null; }, []);
  const stopObserving = useCallback(() => { observerCleanup.current(); observerCleanup.current = () => undefined; }, []);

  const clearPress = useCallback(() => {
    if (pressRef.current) window.clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  }, []);

  const cancelPick = useCallback(() => onPickAnchorChange(null), [onPickAnchorChange]);

  useEffect(() => {
    if (enabled) return;
    dragRef.current = null;
    cachedRectsRef.current = null;
    clearPress(); stopObserving();
    setPreview(null);
    if (pickAnchor !== null) onPickAnchorChange(null);
  }, [enabled, onPickAnchorChange, pickAnchor, clearPress, stopObserving]);

  useEffect(() => {
    const handlePointerUp = () => {
      clearPress();
      cachedRectsRef.current = null;
      stopObserving();
      const drag = dragRef.current;
      dragRef.current = null;
      setPreview(null);
      if (drag && drag.current !== drag.anchor && onRangeSelect) {
        suppressClickRef.current = true;
        onRangeSelect(drag.anchor, drag.current);
      }
      // click 会在 pointerup 之后同步派发，之后再解除屏蔽
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    };
    const handlePointerCancel = () => {
      clearPress();
      dragRef.current = null;
      cachedRectsRef.current = null;
      stopObserving();
      suppressClickRef.current = false;
      setPreview(null);
      onPickAnchorChange(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      dragRef.current = null;
      cachedRectsRef.current = null;
      clearPress(); stopObserving();
      suppressClickRef.current = false;
      setPreview(null);
      onPickAnchorChange(null);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', invalidateRects, true);
    window.addEventListener('resize', invalidateRects);
    document.fonts?.addEventListener('loadingdone', invalidateRects);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', invalidateRects, true);
      window.removeEventListener('resize', invalidateRects);
      document.fonts?.removeEventListener('loadingdone', invalidateRects);
      stopObserving();
    };
  }, [clearPress, onPickAnchorChange, onRangeSelect, invalidateRects, stopObserving]);

  useEffect(() => clearPress, [clearPress]);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    if (!onRangeSelect) return;
    const container = event.currentTarget as HTMLElement;
    containerRef.current = container;
    const index = findTokenIndex(event, container);
    if (index === null) return;

    if (event.pointerType === 'mouse') {
      if (event.button !== 0) return;
      if (event.shiftKey && anchorIndex !== null && anchorIndex !== index) {
        event.preventDefault();
        suppressClickRef.current = true;
        onRangeSelect(anchorIndex, index);
        return;
      }
      dragRef.current = { anchor: index, current: index };
      cachedRectsRef.current = readTokenRects(container);
      stopObserving();
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidateRects) : null;
      resizeObserver?.observe(container);
      container.querySelectorAll<HTMLElement>('[data-token-index]').forEach(element => resizeObserver?.observe(element));
      const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(invalidateRects) : null;
      mutationObserver?.observe(container, { childList: true, characterData: true, subtree: true });
      observerCleanup.current = () => { resizeObserver?.disconnect(); mutationObserver?.disconnect(); };
      return;
    }

    clearPress();
    const timer = window.setTimeout(() => {
      pressRef.current = null;
      suppressClickRef.current = true;
      onPickAnchorChange(index);
      navigator.vibrate?.(8);
    }, LONG_PRESS_MS);
    pressRef.current = { timer, x: event.clientX, y: event.clientY };
  }, [anchorIndex, clearPress, onPickAnchorChange, onRangeSelect, invalidateRects, stopObserving]);

  const onPointerMove = useCallback((event: ReactPointerEvent) => {
    const press = pressRef.current;
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX) {
      clearPress();
    }
    const drag = dragRef.current;
    if (!drag) return;

    // 拖动时阻止浏览器原生蓝色文本选中冲突
    if (event.pointerType === 'mouse' && event.buttons === 1) {
      event.preventDefault();
    }

    const container = containerRef.current || (event.currentTarget as HTMLElement);
    if (!cachedRectsRef.current && container) cachedRectsRef.current = readTokenRects(container);
    const index = findTokenIndex(event, container, cachedRectsRef.current);
    if (index === null || index === drag.current) return;
    drag.current = index;
    setPreview(drag.current === drag.anchor
      ? null
      : { start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor, drag.current) });
  }, [clearPress]);

  /** 词的点击：圈选状态下作为终点，否则返回 false 交给单词释义 */
  const handleTokenClick = useCallback((index: number): boolean => {
    if (suppressClickRef.current) return true;
    if (pickAnchor === null) return false;
    onPickAnchorChange(null);
    if (pickAnchor !== index) onRangeSelect?.(pickAnchor, index);
    return true;
  }, [onPickAnchorChange, onRangeSelect, pickAnchor]);

  return {
    preview,
    cancelPick,
    handleTokenClick,
    containerProps: enabled ? { onPointerDown, onPointerMove } : {},
  };
}
