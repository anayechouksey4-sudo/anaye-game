import { squadControlsEqual, type SquadControls } from '../../../shared/protocol';

export interface ThrottleClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: ThrottleClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Leading + trailing throttle for `squad:controls`.
 *
 *   push(v)   while dragging: sends at most once per `intervalMs`; the newest value is always sent
 *             at the end of the window (the trailing send is guaranteed, never dropped).
 *   flush(v)  gesture finished: cancels any pending trailing send and sends `v` right now, unless it
 *             is exactly what already went out.
 *   force(v)  preset / reset / reconnect: always sends right now.
 *
 * `send` returns false when the socket is down; the frame is then not counted as sent, so the next
 * flush/force re-sends it.
 */
export class ControlsThrottle {
  private lastSentAt = -Infinity;
  private lastSent: SquadControls | null = null;
  private pending: SquadControls | null = null;
  private timer: unknown = null;

  constructor(
    private readonly send: (controls: SquadControls) => boolean,
    private readonly intervalMs: number,
    private readonly clock: ThrottleClock = realClock,
  ) {}

  push(controls: SquadControls): void {
    const wait = this.lastSentAt + this.intervalMs - this.clock.now();
    if (wait <= 0 && this.timer === null) {
      this.emit(controls);
      return;
    }
    this.pending = controls;
    if (this.timer === null) this.timer = this.clock.setTimeout(this.onTimer, Math.max(0, wait));
  }

  flush(controls: SquadControls): void {
    const hadPending = this.pending !== null;
    this.cancel();
    if (hadPending || !squadControlsEqual(controls, this.lastSent)) this.emit(controls);
  }

  force(controls: SquadControls): void {
    this.cancel();
    this.emit(controls);
  }

  /** Forget what was sent (new connection: the server has not seen anything from us yet). */
  reset(): void {
    this.cancel();
    this.lastSent = null;
    this.lastSentAt = -Infinity;
  }

  cancel(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  private readonly onTimer = (): void => {
    this.timer = null;
    const next = this.pending;
    this.pending = null;
    if (next) this.emit(next);
  };

  private emit(controls: SquadControls): void {
    if (!this.send(controls)) return;
    this.lastSent = controls;
    this.lastSentAt = this.clock.now();
  }
}
