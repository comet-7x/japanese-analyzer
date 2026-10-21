// Keep the backing store at display density without unbounded GPU allocations.
export function planRenderQuality(width: number, height: number, dpr: number, maxEdge = 4096) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const density = Number.isFinite(dpr) && dpr > 0 ? Math.max(1, dpr) : 1;
  const edge = Math.max(1, Math.min(4096, maxEdge));
  const resolution = Math.min(density, 4, edge / safeWidth, edge / safeHeight,
    Math.sqrt(6_000_000 / (safeWidth * safeHeight)));
  const pixelWidth = Math.ceil(safeWidth * resolution);
  const pixelHeight = Math.ceil(safeHeight * resolution);
  const maskSize = Math.min(1024, Math.max(512, 2 ** Math.ceil(Math.log2(Math.max(pixelWidth, pixelHeight) * .75))));
  return { width: safeWidth, height: safeHeight, resolution, pixelWidth, pixelHeight, maskSize };
}

interface MaskRenderer {
  getClippingMaskBufferSize(): number;
  setClippingMaskBufferSize(size: number): void;
  startUp(gl: WebGLRenderingContext): void;
}

export function ensureMaskResolution(renderer: MaskRenderer, size: number, gl: WebGLRenderingContext): void {
  if (renderer.getClippingMaskBufferSize() >= size) return;
  renderer.setClippingMaskBufferSize(size);
  // Cubism recreates the clipping manager without retaining its GL context.
  renderer.startUp(gl);
}
