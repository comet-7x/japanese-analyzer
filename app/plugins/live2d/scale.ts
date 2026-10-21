import { LIVE2D_SCALE } from './settings';

export function scaleFromWheel(scale: number, deltaY: number, deltaMode: number, pageHeight: number): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1);
  return Math.max(LIVE2D_SCALE.min, Math.min(LIVE2D_SCALE.max, scale * Math.exp(-pixels * 0.003)));
}
