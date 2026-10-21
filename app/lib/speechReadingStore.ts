'use client';

import { useSyncExternalStore } from 'react';
import { getSpeechPlaybackSnapshot, subscribeSpeechPlayback, type SpeechPlaybackSnapshot } from './speechPlaybackStore';
import { alignSpeechBoundaries, estimateSpeechCues, speechCueAtTime, speechCueProgress, speechWords, type SpeechTextCue, type TextSpan } from './speechReading';

export interface SpeechReadingSnapshot extends TextSpan {
  id: number;
  text: string;
  approximate: boolean;
  status: 'playing' | 'paused';
}

export interface SpeechReadingFrame extends SpeechReadingSnapshot {
  progress: number;
  continuous: boolean;
}

const listeners = new Set<() => void>();
const frameListeners = new Set<(frame: SpeechReadingFrame | null) => void>();
let currentFrame: SpeechReadingFrame | null = null;
let current: SpeechReadingSnapshot | null = null;
let session: SpeechPlaybackSnapshot | null = null;
let cues: SpeechTextCue[] = [];
let words: TextSpan[] = [];
let duration = NaN;
let official = false;
let elapsed = 0;
let clockAt = 0;
let frame = 0;
let disconnect: (() => void) | null = null;
let detachAudio: (() => void) | null = null;

function publish(next: SpeechReadingSnapshot | null) {
  if (current?.id === next?.id && current?.start === next?.start && current?.end === next?.end
    && current?.approximate === next?.approximate && current?.status === next?.status) return;
  current = next;
  for (const listener of listeners) listener();
}

function advanceClock() {
  const now = performance.now();
  if (clockAt && session?.source === 'system' && session.status === 'playing') elapsed += now - clockAt;
  clockAt = now;
}

function readPosition() {
  advanceClock();
  const speech = session;
  if (!speech) { emitFrame(null); publish(null); return; }
  let span: TextSpan | null = null;
  let cue: SpeechTextCue | null = null;
  let seconds = 0;
  let approximate = !official;
  if (speech.source === 'audio' && speech.audio) {
    const audio = speech.audio;
    if (!official && !Object.is(audio.duration, duration)) {
      duration = audio.duration;
      cues = estimateSpeechCues(speech.text, duration, speech.timing);
    }
    seconds = audio.currentTime;
    cue = speechCueAtTime(cues, seconds);
    span = cue;
  } else if (speech.boundaryIndex !== undefined) {
    span = words.find(word => word.start <= speech.boundaryIndex! && word.end > speech.boundaryIndex!) ?? null;
    approximate = false;
  } else {
    // Some system voices never emit boundaries. This is an explicitly approximate fallback.
    seconds = elapsed / 1000;
    cue = speechCueAtTime(cues, seconds);
    span = cue;
  }
  const snapshot = { id: speech.id, text: speech.text, start: span?.start ?? 0, end: span?.end ?? 0,
    approximate, status: speech.status };
  emitFrame({ ...snapshot, progress: cue ? speechCueProgress(cue, seconds) : span ? 1 : 0,
    continuous: cue !== null });
  publish(snapshot);
}

function emitFrame(next: SpeechReadingFrame | null) {
  currentFrame = next;
  for (const listener of frameListeners) listener(next);
}

function tick() {
  frame = 0;
  if (session?.status === 'playing' && !document.hidden) {
    readPosition();
    frame = requestAnimationFrame(tick);
  }
}

function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  readPosition();
  if (session?.status === 'playing' && !document.hidden) frame = requestAnimationFrame(tick);
}

function connectSession() {
  advanceClock();
  const next = getSpeechPlaybackSnapshot();
  if (next?.id !== session?.id) {
    detachAudio?.(); detachAudio = null;
    cues = []; words = []; elapsed = 0; duration = NaN; official = false;
    if (next) {
      words = speechWords(next.text);
      cues = alignSpeechBoundaries(next.text, next.timing?.boundaries ?? []);
      official = cues.length > 0;
      if (next.source === 'system') {
        // No audio duration is available: estimate at roughly 5 Japanese units/second.
        const units = next.timing?.tokens ?? words.map(word => ({ word: next.text.slice(word.start, word.end), pos: '', furigana: '' }));
        const count = units.reduce((sum, unit) => sum + Array.from(unit.furigana || unit.word).length, 0);
        cues = estimateSpeechCues(next.text, Math.max(0.3, count / 5), next.timing);
        official = false;
      } else if (next.audio) {
        const audio = next.audio;
        const events = ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'durationchange', 'playing', 'pause', 'waiting', 'ended'];
        events.forEach(event => audio.addEventListener(event, readPosition));
        detachAudio = () => events.forEach(event => audio.removeEventListener(event, readPosition));
      }
    }
  }
  session = next;
  schedule();
}

export function getSpeechReadingSnapshot(): SpeechReadingSnapshot | null { return current; }
export function getSpeechReadingFrame(): SpeechReadingFrame | null { return currentFrame; }

function connect() {
  if (disconnect) return;
  disconnect = subscribeSpeechPlayback(connectSession);
  document.addEventListener('visibilitychange', schedule);
  connectSession();
}

function disconnectIfUnused() {
  if (listeners.size || frameListeners.size) return;
  disconnect?.(); disconnect = null;
  detachAudio?.(); detachAudio = null;
  document.removeEventListener('visibilitychange', schedule);
  if (frame) cancelAnimationFrame(frame);
  frame = 0; session = null; current = null; currentFrame = null; cues = []; words = [];
}

/** Per-frame styles subscribe here; React continues to receive word changes only. */
export function subscribeSpeechReadingFrame(listener: (frame: SpeechReadingFrame | null) => void): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
  frameListeners.add(listener);
  connect();
  return () => { frameListeners.delete(listener); disconnectIfUnused(); };
}

export function subscribeSpeechReading(listener: () => void): () => void {
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return () => {};
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfUnused();
  };
}

const serverSnapshot = () => null;
/** One shared clock, with React updates only when the active word/status changes. */
export function useSpeechReading() {
  return useSyncExternalStore(subscribeSpeechReading, getSpeechReadingSnapshot, serverSnapshot);
}
