/**
 * Collapses a burst of log events into at most one line per interval.
 *
 * The first event prints immediately; later events within the interval only
 * replace the pending line, which prints when the interval ends. So a 30 Hz
 * slider drag produces ~1 line/s and the log always ends on the final value.
 */
export interface ThrottledLog {
  /** `render` runs at emit time and receives how many events it summarises. */
  push(render: (count: number) => string): void;
  /** Drop any pending line (call on shutdown so no timer outlives the owner). */
  cancel(): void;
}

export function createThrottledLog(intervalMs: number, emit: (line: string) => void): ThrottledLog {
  let lastEmitAt = -Infinity;
  let timer: NodeJS.Timeout | undefined;
  let pending: ((count: number) => string) | undefined;
  let count = 0;

  const flush = (): void => {
    timer = undefined;
    if (!pending) return;
    const render = pending;
    const n = count;
    pending = undefined;
    count = 0;
    lastEmitAt = Date.now();
    emit(render(n));
  };

  return {
    push(render) {
      pending = render;
      count += 1;
      if (timer) return;
      const wait = lastEmitAt + intervalMs - Date.now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      count = 0;
    },
  };
}
