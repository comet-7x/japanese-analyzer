/** A precomputed, normalized mouth opening curve for a complete speech audio Blob. */
export interface SpeechEnvelope {
  samples: Float32Array;
  stepSeconds: number;
  durationSeconds: number;
}

const cachedEnvelopes = new WeakMap<Blob, Promise<SpeechEnvelope>>();

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Pure PCM calculation, kept separate from browser decoding for predictable testing. */
export function createSpeechEnvelope(
  channels: readonly Float32Array[],
  sampleRate: number,
  stepSeconds = 0.02,
): SpeechEnvelope {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new Error('Invalid audio sample rate or envelope step');
  }
  const length = Math.max(0, ...channels.map(channel => channel.length));
  const framesPerStep = Math.max(1, Math.round(sampleRate * stepSeconds));
  const count = Math.ceil(length / framesPerStep);
  const rms = new Float32Array(count);

  for (let index = 0; index < count; index++) {
    const start = index * framesPerStep;
    const end = Math.min(length, start + framesPerStep);
    let power = 0;
    let samples = 0;
    for (const channel of channels) {
      const channelEnd = Math.min(end, channel.length);
      for (let frame = start; frame < channelEnd; frame++) {
        power += channel[frame] * channel[frame];
      }
      samples += Math.max(0, channelEnd - start);
    }
    rms[index] = samples ? Math.sqrt(power / samples) : 0;
  }

  // Normalize against this clip's own speech level, while keeping low-level noise shut.
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const reference = Math.max(0.035, sorted[Math.floor(sorted.length * 0.95)] || 0);
  const noiseFloor = 0.008;
  const range = Math.max(0.025, reference - noiseFloor);
  const samples = new Float32Array(count);
  let previous = 0;
  for (let index = 0; index < count; index++) {
    const target = clamp((rms[index] - noiseFloor) / range);
    previous += (target - previous) * (target > previous ? 0.6 : 0.25);
    samples[index] = previous;
  }

  return { samples, stepSeconds: framesPerStep / sampleRate, durationSeconds: length / sampleRate };
}

/** Supports callback-only WebKit as well as promise-based implementations. */
export function decodeAudioDataCompat(context: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const result = context.decodeAudioData(data, resolve, reject);
      if (result && typeof result.then === 'function') void result.then(resolve, reject);
    } catch (error) { reject(error); }
  });
}

let decoding = 0;
const decodeQueue: Array<() => void> = [];
async function decodeBlob(blob: Blob): Promise<SpeechEnvelope> {
  // Reserve a slot before yielding so concurrent consumers cannot exceed this bound.
  await new Promise<void>(resolve => {
    if (decoding < 2) { decoding++; resolve(); }
    else decodeQueue.push(resolve);
  });
  try {
    if (typeof window === 'undefined') throw new Error('Audio decoding requires a browser');
    const data = await blob.arrayBuffer();
    const browser = window as Window & {
      webkitOfflineAudioContext?: typeof OfflineAudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Offline = window.OfflineAudioContext || browser.webkitOfflineAudioContext;
    let buffer: AudioBuffer | undefined;
    if (Offline) {
      try {
        // This length is a constructor value, not a limit on the decoded audio.
        buffer = await decodeAudioDataCompat(new Offline(1, 4096, 44100), data.slice(0));
      } catch { /* Try the realtime decoder without starting its audio output. */ }
    }
    if (!buffer) {
      const Realtime = window.AudioContext || browser.webkitAudioContext;
      if (!Realtime) throw new Error('Web Audio is unavailable');
      const context = new Realtime();
      try { buffer = await decodeAudioDataCompat(context, data.slice(0)); }
      finally { await context.close().catch(() => undefined); }
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
    return createSpeechEnvelope(channels, buffer.sampleRate);
  } finally {
    const next = decodeQueue.shift();
    if (next) next();
    else decoding--;
  }
}

/** Decode only for a companion consumer; the host audio player remains independent. */
export function getSpeechEnvelope(blob: Blob): Promise<SpeechEnvelope> {
  const existing = cachedEnvelopes.get(blob);
  if (existing) return existing;
  const task = decodeBlob(blob);
  cachedEnvelopes.set(blob, task);
  void task.catch(() => cachedEnvelopes.delete(blob));
  return task;
}

/** Read the curve at the actual player's currentTime, including after a seek. */
export function sampleSpeechEnvelope(envelope: SpeechEnvelope, timeSeconds: number, sensitivity = 1): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0 || timeSeconds >= envelope.durationSeconds) return 0;
  const position = timeSeconds / envelope.stepSeconds;
  const index = Math.floor(position);
  const first = envelope.samples[index] ?? 0;
  const second = envelope.samples[index + 1] ?? first;
  return clamp((first + (second - first) * (position - index)) * sensitivity);
}
