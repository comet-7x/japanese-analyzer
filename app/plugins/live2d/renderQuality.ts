// One quality policy for the desktop widget, mobile widget and settings preview.
// Supersample 1x displays; pinch zoom magnifies CSS pixels without changing DPR.
export function planRenderQuality(width: number, height: number, dpr: number, maxEdge = 4096, viewportScale = 1) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const displayDensity = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const zoom = Number.isFinite(viewportScale) && viewportScale > 0 ? Math.max(1, viewportScale) : 1;
  const density = Math.max(2, displayDensity * zoom);
  const edge = Math.max(1, Math.min(4096, maxEdge));
  const resolution = Math.min(density, 4, edge / safeWidth, edge / safeHeight,
    Math.sqrt(6_000_000 / (safeWidth * safeHeight)));
  const pixelWidth = Math.ceil(safeWidth * resolution);
  const pixelHeight = Math.ceil(safeHeight * resolution);
  const maskSize = Math.min(edge, 2048, Math.max(512, 2 ** Math.ceil(Math.log2(Math.max(pixelWidth, pixelHeight) * .75))));
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
