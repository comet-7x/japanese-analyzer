import type { SpeechTiming } from './speechReading';

/** The current speech session, shared with optional visual companions. */
export type SpeechPlaybackStatus = 'playing' | 'paused';

export interface SpeechPlaybackSnapshot {
  id: number;
  source: 'audio' | 'system';
  audio: HTMLAudioElement | null;
  blob: Blob | null;
  text: string;
  status: SpeechPlaybackStatus;
  timing?: SpeechTiming;
  /** Native Web Speech boundary, in original-text UTF-16 offsets. */
  boundaryIndex?: number;
}

let nextId = 0;
let current: SpeechPlaybackSnapshot | null = null;
const listeners = new Set<() => void>();

function publish(next: SpeechPlaybackSnapshot | null): void {
  current = next;
  for (const listener of listeners) listener();
}

export function getSpeechPlaybackSnapshot(): SpeechPlaybackSnapshot | null {
  return current;
}

export function subscribeSpeechPlayback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call from the audio element's play event. The host remains the only audio player. */
export function beginAudioSpeech(audio: HTMLAudioElement, blob: Blob | null, text: string, timing?: SpeechTiming): number {
  const id = ++nextId;
  publish({ id, source: 'audio', audio, blob, text, status: 'playing', ...(timing ? { timing } : {}) });
  return id;
}

/** System speech synthesis cannot provide PCM; consumers can animate a simple fallback. */
export function beginSystemSpeech(text: string, timing?: SpeechTiming): number {
  const id = ++nextId;
  publish({ id, source: 'system', audio: null, blob: null, text, status: 'playing', ...(timing ? { timing } : {}) });
  return id;
}

export function setSystemSpeechBoundary(id: number, charIndex: number): void {
  if (current?.id !== id || current.source !== 'system' || !Number.isInteger(charIndex)
    || charIndex < 0 || charIndex >= current.text.length || current.boundaryIndex === charIndex) return;
  publish({ ...current, boundaryIndex: charIndex });
}

export function setSpeechPlaybackStatus(id: number, status: SpeechPlaybackStatus): void {
  if (current?.id !== id || current.status === status) return;
  publish({ ...current, status });
}

/** A stale player's cleanup must never clear a newer session. */
export function endSpeechPlayback(id: number): void {
  if (current?.id === id) publish(null);
}
