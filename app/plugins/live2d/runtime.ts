export type RenderMode = 'active' | 'idle' | 'paused';

/** This controller never polls: frames report busy work; one deadline handles inactivity. */
export class Live2DRuntime {
  private lastActivity: number;
  private busy = false;
  private visible = true;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private mode: RenderMode | undefined;

  constructor(
    private apply: (mode: RenderMode) => void,
    private pauseWhenIdle = false,
    private now = () => performance.now(),
    private schedule = (callback: () => void, delay: number) => setTimeout(callback, delay),
    private cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  ) {
    this.lastActivity = now();
    this.reconcile();
  }

  wake(): void {
    this.lastActivity = this.now();
    this.reconcile();
  }

  setBusy(busy: boolean): void {
    if (this.busy === busy) return;
    this.busy = busy;
    this.wake();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible) this.lastActivity = this.now();
    this.reconcile();
  }

  setPauseWhenIdle(value: boolean): void {
    this.pauseWhenIdle = value;
    this.reconcile();
  }

  private reconcile = (): void => {
    if (this.disposed) return;
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
    const remaining = Math.max(0, 8000 - (this.now() - this.lastActivity));
    const next = !this.visible ? 'paused' : this.busy || remaining > 0
      ? 'active' : this.pauseWhenIdle ? 'paused' : 'idle';
    if (next !== this.mode) {
      this.mode = next;
      this.apply(next);
    }
    if (this.visible && !this.busy && remaining > 0) {
      this.timer = this.schedule(this.reconcile, remaining);
    }
  };

  destroy(): void {
    this.disposed = true;
    if (this.timer !== undefined) this.cancel(this.timer);
  }
}
