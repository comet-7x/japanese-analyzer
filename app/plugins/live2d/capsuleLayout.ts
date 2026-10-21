export interface SurfaceRect { x: number; y: number; width: number; height: number }

/** Clamp the controls independently of the model's scale, including a mobile keyboard. */
export function placeCapsuleSurface(anchor: SurfaceRect, size: { width: number; height: number }, viewport: SurfaceRect, above = false) {
  const edge = 8;
  const width = Math.max(0, Math.min(size.width, viewport.width - edge * 2));
  const height = Math.max(0, Math.min(size.height, viewport.height - edge * 2));
  const x = Math.max(viewport.x + edge, Math.min(anchor.x + (anchor.width - width) / 2, viewport.x + viewport.width - width - edge));
  const wantedY = above ? anchor.y - height - 10 : anchor.y + (anchor.height - height) / 2;
  const y = Math.max(viewport.y + edge, Math.min(wantedY, viewport.y + viewport.height - height - edge));
  return { x, y, width, height };
}
