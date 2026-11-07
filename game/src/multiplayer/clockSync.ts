/**
 * Relay clock estimate from room:ping / room:pong round trips. Every member of a room times its
 * start lights to `startAt` on THIS clock, so a 50 ms agreement between phones needs a few samples
 * and a median, not one ping.
 *
 *   offset = serverNow − (sentAt + rtt / 2)        relayNow() = localNow() + offset
 *
 * The estimate is the median of the last SAMPLE_WINDOW offsets weighted by nothing but recency;
 * a sample whose rtt is more than 3× the best seen is ignored (a queued frame behind a burst).
 */
export const SAMPLE_WINDOW = 5;
export const RTT_OUTLIER_FACTOR = 3;

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
}

export class ClockSync {
  private readonly samples: ClockSample[] = [];
  private bestRtt = Infinity;
  /** Current estimate (0 until the first sample). */
  offsetMs = 0;
  /** Smoothed round trip, ms (null until the first sample). */
  rttMs: number | null = null;
  /** Samples accepted so far (the UI shows "syncing" below SAMPLE_WINDOW). */
  count = 0;

  private readonly localNow: () => number;

  constructor(localNow: () => number = () => performance.now()) {
    this.localNow = localNow;
  }

  /** Record one pong. Returns false when the sample was rejected as an outlier. */
  addSample(sentAt: number, receivedAt: number, serverNow: number): boolean {
    const rtt = Math.max(0, receivedAt - sentAt);
    if (rtt > this.bestRtt * RTT_OUTLIER_FACTOR && this.samples.length >= 2) return false;
    this.bestRtt = Math.min(this.bestRtt, rtt);
    const offset = serverNow - (sentAt + rtt / 2);
    this.samples.push({ offsetMs: offset, rttMs: rtt });
    if (this.samples.length > SAMPLE_WINDOW) this.samples.shift();
    this.count += 1;
    const sorted = this.samples.map((s) => s.offsetMs).sort((a, b) => a - b);
    this.offsetMs = sorted[Math.floor(sorted.length / 2)]!;
    this.rttMs = this.rttMs === null ? rtt : Math.round(this.rttMs * 0.7 + rtt * 0.3);
    return true;
  }

  /** The relay's clock, ms (Date.now() on the relay), as best we know. */
  now(): number {
    return this.localNow() + this.offsetMs;
  }

  get synced(): boolean {
    return this.count >= 2;
  }

  reset(): void {
    this.samples.length = 0;
    this.bestRtt = Infinity;
    this.offsetMs = 0;
    this.rttMs = null;
    this.count = 0;
  }
}
