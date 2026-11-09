/**
 * Live counters for the owner's console (milestone 6): O(1) work per event, a fixed amount of memory.
 * Everything here starts at zero when the relay starts (the free hosting plan sleeps and restarts the
 * relay), and "today" is the UTC day. Per-player breakdowns (maps, cars, countries) are not kept here:
 * the relay counts its current clients when the console asks (bounded by the clients connected now).
 */

export interface DailyCounters {
  /** UTC day these "today" numbers belong to (YYYY-MM-DD). */
  day: string;
  peakToday: number;
  peakTodayAt: number | null;
  peakSinceStart: number;
  peakSinceStartAt: number | null;
  sessionsToday: number;
  sessionsSinceStart: number;
  racesFinishedToday: number;
  racesFinishedSinceStart: number;
}

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export class LiveStats {
  readonly startedAt: number;
  private day: string;
  private peakToday = 0;
  private peakTodayAt: number | null = null;
  private peakSinceStart = 0;
  private peakSinceStartAt: number | null = null;
  private sessionsToday = 0;
  private sessionsSinceStart = 0;
  private racesToday = 0;
  private racesSinceStart = 0;

  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
    this.startedAt = now();
    this.day = utcDay(this.startedAt);
  }

  /** A socket became a game client (counted once per socket). */
  gameSessionStarted(): void {
    this.roll();
    this.sessionsToday += 1;
    this.sessionsSinceStart += 1;
  }

  /** The number of connected game clients changed to `count`. */
  concurrentGames(count: number): void {
    this.roll();
    const t = this.now();
    if (count > this.peakToday) {
      this.peakToday = count;
      this.peakTodayAt = t;
    }
    if (count > this.peakSinceStart) {
      this.peakSinceStart = count;
      this.peakSinceStartAt = t;
    }
  }

  /** A room race reached its results. */
  raceFinished(): void {
    this.roll();
    this.racesToday += 1;
    this.racesSinceStart += 1;
  }

  /** The counters, after rolling the UTC day; `currentGames` seeds today's peak after a day change. */
  counters(currentGames: number): DailyCounters {
    this.concurrentGames(currentGames);
    return {
      day: this.day,
      peakToday: this.peakToday,
      peakTodayAt: this.peakTodayAt,
      peakSinceStart: this.peakSinceStart,
      peakSinceStartAt: this.peakSinceStartAt,
      sessionsToday: this.sessionsToday,
      sessionsSinceStart: this.sessionsSinceStart,
      racesFinishedToday: this.racesToday,
      racesFinishedSinceStart: this.racesSinceStart,
    };
  }

  private roll(): void {
    const day = utcDay(this.now());
    if (day === this.day) return;
    this.day = day;
    this.peakToday = 0;
    this.peakTodayAt = null;
    this.sessionsToday = 0;
    this.racesToday = 0;
  }
}

/** Counts → [{id, players}] sorted by count (then id), at most `limit` entries; the rest go to `other`. */
export function topCounts(counts: Map<string, number>, limit: number): { entries: { id: string; players: number }[]; other: number } {
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const entries = sorted.slice(0, limit).map(([id, players]) => ({ id, players }));
  const other = sorted.slice(limit).reduce((sum, [, n]) => sum + n, 0);
  return { entries, other };
}
