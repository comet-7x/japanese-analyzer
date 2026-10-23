export type CompanionMood = 'idle' | 'analyzing' | 'success' | 'error';
export interface CompanionAnalysisEvent {
  requestId: number;
  phase: 'started' | 'succeeded' | 'failed' | 'cancelled';
  at: number;
}

export function moodForAnalysis(event: CompanionAnalysisEvent | null, now: number): CompanionMood {
  if (!event || event.phase === 'cancelled') return 'idle';
  if (event.phase === 'started') return 'analyzing';
  if (now - event.at >= 3500) return 'idle';
  return event.phase === 'succeeded' ? 'success' : 'error';
}

export function smoothValue(current: number, target: number, dt: number, tau = 0.18): number {
  return current + (target - current) * (1 - Math.exp(-Math.max(0, dt) / tau));
}

/** Latest desired expression wins, including requests arriving while an asset loads. */
export class ExpressionQueue {
  private revision = 0;
  private running = false;
  private disposed = false;
  private desired: string | null = null;

  constructor(
    private load: (id: string) => Promise<void>,
    private apply: (id: string) => Promise<unknown>,
    private reset: () => void,
    private wake: () => void,
    private invalidate: () => void = () => {},
  ) {}

  set(id: string | null): void {
    this.desired = id;
    this.revision++;
    this.invalidate();
    if (!this.running) void this.drain();
  }

  private async drain(): Promise<void> {
    this.running = true;
    try {
      while (!this.disposed) {
        const revision = this.revision;
        const desired = this.desired;
        try {
          if (desired) {
            await this.load(desired);
            if (this.disposed) return;
            if (revision !== this.revision) continue;
            await this.apply(desired);
          } else this.reset();
        } catch { /* Unsupported expressions do not interrupt the companion. */ }
        if (this.disposed) return;
        this.wake();
        if (revision === this.revision) break;
      }
    } finally {
      this.running = false;
    }
  }

  destroy(): void { this.disposed = true; }
}
