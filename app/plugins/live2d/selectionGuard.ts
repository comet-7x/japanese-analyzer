interface Point { x: number; y: number }
interface Bounds { left: number; top: number; right: number; bottom: number }

export function containsPoint(bounds: Bounds, point: Point): boolean {
  return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom;
}

const CONTROL_SELECTOR = 'input, textarea, select, button, a, label, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="slider"], [role="scrollbar"], [role="tab"]';

// A click on blank page space can make the browser select the closest line of
// text, even hundreds of pixels away. Protect that blank space beneath the stage
// while preserving controls and actual text hit by the pointer in reading mode.
export function isReadingTargetAtPoint(target: Element, point: Point): boolean {
  if (target.closest(CONTROL_SELECTOR)) return true;
  const range = target.ownerDocument.createRange();
  try {
    // elementFromPoint returns the deepest hit element; its direct text nodes
    // identify text actually under the pointer, rather than the nearest caret.
    return Array.from(target.childNodes).some(node => {
      if (node.nodeType !== 3 || !node.textContent?.trim()) return false;
      range.selectNodeContents(node);
      return Array.from(range.getClientRects()).some(rect => containsPoint(rect, point));
    });
  } finally { range.detach(); }
}

export function guardStageBackgroundSelection(event: MouseEvent, container: HTMLElement): void {
  if (event.button !== 0 || event.shiftKey || !event.cancelable) return;
  if ('pointerType' in event && event.pointerType === 'touch') return;
  const point = { x: event.clientX, y: event.clientY };
  if (!containsPoint(container.getBoundingClientRect(), point)) return;
  const target = event.target;
  if (!(target instanceof Element) || isReadingTargetAtPoint(target, point)) return;
  event.preventDefault();
}
