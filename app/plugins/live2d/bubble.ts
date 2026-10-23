export interface Rect { x: number; y: number; width: number; height: number }

/** All inputs use CSS viewport coordinates, including VisualViewport offsets. */
export function placeBubble(anchor: Rect, bubble: { width: number; height: number }, viewport: Rect) {
  const edge = 8;
  const gap = 12;
  const topRoom = anchor.y - viewport.y - edge - gap;
  const bottomRoom = viewport.y + viewport.height - (anchor.y + anchor.height) - edge - gap;
  const placement = topRoom >= bubble.height || topRoom >= bottomRoom ? 'top' : 'bottom';
  const width = Math.min(bubble.width, Math.max(0, viewport.width - 2 * edge));
  const center = anchor.x + anchor.width / 2;
  const x = Math.max(viewport.x + edge, Math.min(viewport.x + viewport.width - edge - width, center - width / 2));
  const wantedY = placement === 'top' ? anchor.y - gap - bubble.height : anchor.y + anchor.height + gap;
  const y = Math.max(viewport.y + edge, Math.min(viewport.y + viewport.height - edge - bubble.height, wantedY));
  const tail = Math.max(16, Math.min(width - 16, center - x));
  return { x, y, tail, placement };
}
