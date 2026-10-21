/** The soft edge starts outside the glyph and ends outside it, giving true 0/100%. */
export function setSpeechSweep(element: HTMLElement, progress: number, feather: number): void {
  const p = Number(Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)).toFixed(4));
  if (element.style.getPropertyValue('--speech-progress') === String(p)) return;
  element.style.setProperty('--speech-progress', String(p));
  element.style.setProperty('--speech-reveal', `calc(${p * 100}% + ${(2 * p - 1) * feather}px)`);
}
