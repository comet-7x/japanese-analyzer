export interface VisibleBounds { left: number; top: number; right: number; bottom: number }

/** Bounds of rendered artwork, excluding transparent canvas padding and faint antialiasing. */
export function visibleAlphaBounds(pixels: ArrayLike<number>, width: number, height: number, startRow = 0): VisibleBounds | null {
  if (width < 1 || height < 1 || pixels.length < width * height * 4) return null;
  let left = width, top = height, right = 0, bottom = 0;
  for (let y = Math.max(0, Math.floor(startRow)); y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 24) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** A control beneath the character belongs under its standing base, not its hair or outstretched arms. */
export function visibleBaseCenter(pixels: ArrayLike<number>, width: number, height: number): number | null {
  const artwork = visibleAlphaBounds(pixels, width, height);
  if (!artwork) return null;
  const base = visibleAlphaBounds(pixels, width, height, artwork.bottom - Math.max(1, (artwork.bottom - artwork.top) * .12));
  return base ? (base.left + base.right) / 2 / width : null;
}
