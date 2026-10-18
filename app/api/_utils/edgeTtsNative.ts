import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export interface EdgeTtsCue {
  word: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
}

export interface EdgeTtsResult {
  audio: Buffer;
  mimeType: string;
  cues: EdgeTtsCue[];
}

/**
 * Convert user rate number (-100 to 100) to SSML percentage string
 */
function formatSsmlRate(rate: number): string {
  if (!rate) return '+0%';
  const rounded = Math.round(rate);
  return rounded >= 0 ? `+${rounded}%` : `${rounded}%`;
}

/**
 * Convert user pitch number (-100 to 100) to SSML Hz/percentage string
 */
function formatSsmlPitch(pitch: number): string {
  if (!pitch) return '+0Hz';
  const rounded = Math.round(pitch);
  return rounded >= 0 ? `+${rounded}Hz` : `${rounded}Hz`;
}

/**
 * Synthesize Japanese speech using Edge TTS direct WebSocket protocol,
 * extracting exact word-level timestamp boundaries.
 */
export async function synthesizeEdgeTtsWithBoundaries(
  text: string,
  options: {
    voice?: string;
    gender?: string;
    rate?: number;
    pitch?: number;
  } = {}
): Promise<EdgeTtsResult> {
  const tts = new MsEdgeTTS();

  const selectedVoice = options.voice || (options.gender === 'male' ? 'ja-JP-KeitaNeural' : 'ja-JP-NanamiNeural');
  const rateStr = formatSsmlRate(options.rate || 0);
  const pitchStr = formatSsmlPitch(options.pitch || 0);

  await tts.setMetadata(selectedVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
    wordBoundaryEnabled: true,
  });

  const { audioStream, metadataStream } = await tts.toStream(text, {
    rate: rateStr,
    pitch: pitchStr,
  });

  const audioChunks: Buffer[] = [];
  const rawBoundaries: Array<{ word: string; offsetMs: number; durationMs: number }> = [];

  if (metadataStream) {
    metadataStream.on('data', (data: Buffer | string) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString('utf8');
        const event = JSON.parse(raw);
        for (const item of event.Metadata || []) {
          if (item.Type === 'WordBoundary' && item.Data?.text?.Text) {
            const { Offset, Duration, text: textObj } = item.Data;
            // Offset and Duration are in ticks (1 tick = 100 nanoseconds = 0.0001 ms)
            const offsetMs = (Offset || 0) / 10000;
            const durationMs = (Duration || 0) / 10000;
            rawBoundaries.push({
              word: textObj.Text,
              offsetMs,
              durationMs,
            });
          }
        }
      } catch {
        // Ignore partial or non-JSON telemetry frames
      }
    });
  }

  audioStream.on('data', (chunk: Buffer) => {
    audioChunks.push(chunk);
  });

  await new Promise<void>((resolve, reject) => {
    audioStream.on('end', () => resolve());
    audioStream.on('error', (err) => reject(err));
  });

  const audio = Buffer.concat(audioChunks);

  // Convert raw millisecond boundaries to second-based cues
  const cues: EdgeTtsCue[] = rawBoundaries.map((b) => ({
    word: b.word,
    startTime: Math.round((b.offsetMs / 1000) * 1000) / 1000,
    endTime: Math.round(((b.offsetMs + b.durationMs) / 1000) * 1000) / 1000,
  }));

  return {
    audio,
    mimeType: 'audio/mpeg',
    cues,
  };
}
