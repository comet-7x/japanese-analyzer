/** Temporary expressions restore a live default; stale timers can never clear a newer choice. */
export class ExpressionLifecycle {
  private active: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  constructor(private apply: (id: string | null) => void, private baseline: () => string | null,
    private schedule = (callback: () => void, delay: number) => setTimeout(callback, delay),
    private cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer)) {}
  activate(id: string, mode: 'timed' | 'toggle' | 'event', seconds: number, finished: () => void) {
    const togglingOff = mode === 'toggle' && this.active === id;
    this.clear();
    if (togglingOff) { this.apply(this.baseline()); finished(); return; }
    this.active = id;
    const revision = this.revision;
    this.apply(id);
    if (mode === 'timed') this.timer = this.schedule(() => {
      if (revision !== this.revision) return;
      this.timer = undefined; this.active = null; this.apply(this.baseline()); finished();
    }, seconds * 1000);
  }
  private clear() { this.revision++; if (this.timer !== undefined) this.cancel(this.timer); this.timer = undefined; this.active = null; }
  reset() { this.clear(); this.apply(this.baseline()); }
  destroy() { this.clear(); }
}
