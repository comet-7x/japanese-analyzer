import type { TokenData } from '../services/api';
import { collectSemanticUnits, splitJapaneseText, type JapaneseChunkingOptions, type JapaneseTextChunk } from './japaneseChunking';
import { canRecoverAnalysis, type AnalysisErrorCode, AnalysisValidationError } from './requestErrors';

export type AnalysisChunkStatus = 'queued' | 'running' | 'retrying' | 'complete' | 'failed' | 'cancelled';
/** Source ranges use UTF-16 offsets, matching String.slice and the editing model. */
export interface AnalysisChunkProgress {
  id: string;
  start: number;
  end: number;
  rootIndex: number;
  status: AnalysisChunkStatus;
  attempt: number;
  recovery: boolean;
  error?: Error;
  errorCode?: AnalysisErrorCode;
}
export interface AnalysisProgress {
  status: 'idle' | 'running' | 'complete' | 'failed' | 'cancelled';
  chunks: AnalysisChunkProgress[];
  tokens: TokenData[];
  confirmedTokens: TokenData[];
  initialSuccess: boolean;
}
interface WorkChunk extends AnalysisChunkProgress {
  chunk: JapaneseTextChunk;
  tokens: TokenData[];
  partial: TokenData[];
}
export type AnalysisChunkRequest = (
  chunk: JapaneseTextChunk, context: AnalysisChunkProgress, signal: AbortSignal,
  onPartial: (tokens: TokenData[]) => void,
) => Promise<TokenData[]>;

/** Split only at an existing sentence/paragraph boundary, never inside brackets. */
export function splitRecoveryChunk(chunk: JapaneseTextChunk): JapaneseTextChunk[] {
  const boundaries = collectSemanticUnits(chunk.text).map(unit => unit.end)
    .filter(end => end < chunk.text.length && chunk.text.slice(0, end).trim() && chunk.text.slice(end).trim());
  if (!boundaries.length) return [chunk];
  const middle = boundaries.reduce((best, end) => Math.abs(end - chunk.text.length / 2) < Math.abs(best - chunk.text.length / 2) ? end : best);
  return [[0, middle], [middle, chunk.text.length]].map(([start, end]) => ({
    text: chunk.text.slice(start, end), start: chunk.start + start, end: chunk.start + end,
    sentenceCount: collectSemanticUnits(chunk.text.slice(start, end)).reduce((n, unit) => n + unit.sentenceCount, 0),
    overLimit: end - start > 420,
  }));
}

/** A tab-local run owns validated chunks; retries never revisit successful spans. */
export class AnalysisSession {
  private controller = new AbortController();
  private chunks: WorkChunk[];
  private status: AnalysisProgress['status'] = 'idle';
  private initialSuccess = true;
  private pending?: Promise<AnalysisProgress>;
  private removeAbort?: () => void;

  constructor(text: string, private request: AnalysisChunkRequest, private options: {
    signal?: AbortSignal; onProgress?: (progress: AnalysisProgress) => void;
    chunking?: JapaneseChunkingOptions; automaticRecovery?: boolean;
  } = {}) {
    this.chunks = splitJapaneseText(text, options.chunking).map((chunk, rootIndex) => this.work(chunk, rootIndex, false));
    const abort = () => this.cancel();
    options.signal?.addEventListener('abort', abort, { once: true });
    this.removeAbort = () => options.signal?.removeEventListener('abort', abort);
    if (options.signal?.aborted) this.cancel();
  }

  private work(chunk: JapaneseTextChunk, rootIndex: number, recovery: boolean): WorkChunk {
    return { id: `${chunk.start}:${chunk.end}`, start: chunk.start, end: chunk.end, rootIndex,
      status: 'queued', attempt: 0, recovery, chunk, tokens: [], partial: [] };
  }

  getSnapshot(): AnalysisProgress {
    const confirmedTokens: TokenData[] = [];
    const tokens: TokenData[] = [];
    for (const chunk of this.chunks) {
      if (chunk.status === 'complete') { confirmedTokens.push(...chunk.tokens); tokens.push(...chunk.tokens); }
      else {
        if (chunk.status === 'running' || chunk.status === 'retrying') tokens.push(...chunk.partial);
        break;
      }
    }
    return { status: this.status, initialSuccess: this.initialSuccess, tokens, confirmedTokens,
      chunks: this.chunks.map(({ id, start, end, rootIndex, status, attempt, recovery, error, errorCode }) =>
        ({ id, start, end, rootIndex, status, attempt, recovery, error, errorCode })) };
  }

  private notify() { this.options.onProgress?.(this.getSnapshot()); }

  cancel() {
    if (this.status === 'cancelled' || this.status === 'complete') return;
    this.status = 'cancelled';
    this.controller.abort(new DOMException('Analysis cancelled', 'AbortError'));
    this.removeAbort?.();
    this.chunks.forEach(chunk => {
      if (chunk.status !== 'complete') { chunk.status = 'cancelled'; chunk.partial = []; }
    });
    this.notify();
  }

  run(): Promise<AnalysisProgress> {
    if (this.pending) return this.pending;
    if (this.status !== 'idle') return Promise.resolve(this.getSnapshot());
    return this.drain(true);
  }

  retryFailed(): Promise<AnalysisProgress> {
    if (this.pending) return this.pending;
    if (this.status !== 'failed') return Promise.resolve(this.getSnapshot());
    this.chunks.forEach(chunk => {
      if (chunk.status === 'failed') { chunk.status = 'queued'; chunk.error = undefined; chunk.errorCode = undefined; }
    });
    return this.drain(false);
  }

  private drain(automatic: boolean): Promise<AnalysisProgress> {
    this.status = 'running';
    this.notify();
    const task = new Promise<AnalysisProgress>(resolve => {
      let active = 0;
      const pump = () => {
        while (!this.controller.signal.aborted && active < 3) {
          const work = this.chunks.find(chunk => chunk.status === 'queued');
          if (!work) break;
          active++;
          work.status = work.recovery || work.attempt > 0 ? 'retrying' : 'running';
          work.attempt++;
          this.notify();
          void (async () => {
            try {
              const tokens = await this.request(work.chunk, { id: work.id, start: work.start, end: work.end, rootIndex: work.rootIndex, status: work.status, attempt: work.attempt, recovery: work.recovery }, this.controller.signal, partial => {
                if (this.controller.signal.aborted) return;
                work.partial = partial;
                this.notify();
              });
              if (this.controller.signal.aborted) return;
              work.tokens = tokens;
              work.partial = [];
              work.status = 'complete';
            } catch (error) {
              if (this.controller.signal.aborted) return;
              this.initialSuccess = false;
              work.partial = [];
              work.error = error instanceof Error ? error : new Error('解析失败');
              work.errorCode = error instanceof AnalysisValidationError ? error.code : undefined;
              if (automatic && this.options.automaticRecovery !== false && !work.recovery && canRecoverAnalysis(error)) {
                const replacements = splitRecoveryChunk(work.chunk).map(chunk => this.work(chunk, work.rootIndex, true));
                // Retrying the same span still needs a distinct, incremented attempt number.
                if (replacements.length === 1) replacements[0].attempt = work.attempt;
                this.chunks.splice(this.chunks.indexOf(work), 1, ...replacements);
              } else work.status = 'failed';
            } finally {
              active--;
              if (!this.controller.signal.aborted) this.notify();
              pump();
            }
          })();
        }
        if (active === 0 && !this.chunks.some(chunk => chunk.status === 'queued')) {
          if (!this.controller.signal.aborted) {
            this.status = this.chunks.every(chunk => chunk.status === 'complete') ? 'complete' : 'failed';
            if (this.status === 'complete') this.removeAbort?.();
            this.notify();
          }
          resolve(this.getSnapshot());
        }
      };
      pump();
    });
    this.pending = task.finally(() => { this.pending = undefined; });
    return this.pending;
  }
}
