/**
 * Career data: everything the CAREER tab shows and the trophies are judged on. Pure reducers over a
 * plain `Career` object (node-tested in game/test/career.test.ts), a tiny zustand store around the
 * current one, and versioned localStorage under `gamerfleet.career.v1`.
 *
 * Nothing here reads physics or the event bus: career/tracking.ts does that and calls the reducers.
 * Every reducer returns a NEW object and never mutates its input, so React re-renders only when
 * something changed and the tests can compare before / after.
 */
import { create } from 'zustand';

export const CAREER_STORAGE_KEY = 'gamerfleet.career.v1';
export const CAREER_VERSION = 1 as const;

export type CareerMedal = 'gold' | 'silver' | 'bronze';
/** Best first. */
export const CAREER_MEDALS: readonly CareerMedal[] = ['gold', 'silver', 'bronze'];

/** One (track, car) combination. */
export interface RaceRecord {
  bestMs: number | null;
  medal: CareerMedal | null;
  /** Best finishing position against rivals / friends (1-based); null until the car raced someone. */
  bestPosition: number | null;
  /** Finishes. */
  runs: number;
  /** Falls (respawns that count) over those finished runs. */
  falls: number;
  /** Finishes with no fall at all. */
  cleanRuns: number;
}

export interface CareerTotals {
  racesFinished: number;
  /** P1 against at least one other car. */
  wins: number;
  /** P1–P3 against at least one other car. */
  podiums: number;
  friendsPlayed: number;
  friendsWon: number;
  /** Friends races won with three or more players in the results. */
  friendsWonWith3: number;
  friendsHosted: number;
  /** Metres driven, every map. */
  distanceM: number;
  /** Metres driven per map id. */
  distanceByMap: Record<string, number>;
  topSpeedKmh: number;
  topSpeedMap: string | null;
  topSpeedCar: string | null;
  /** Island AIR records: longest flight and longest leap seen. */
  longestAirS: number;
  longestLeapM: number;
  /** Simulated seconds with the car driving (the menu pauses it). */
  timePlayedS: number;
  /** Respawns that count as falls (fall / water / bounds), all runs. */
  falls: number;
  restarts: number;
  /** Races finished with tilt steering. */
  tiltFinishes: number;
  /** Biggest improvement on an existing best time, ms (the ghost is that best run). */
  bestImprovementMs: number;
}

export interface Career {
  v: typeof CAREER_VERSION;
  createdAt: number;
  /** Keyed `${trackId}|${carId}` (recordKey). */
  records: Record<string, RaceRecord>;
  totals: CareerTotals;
  /** Island regions visited (labels as worldLive publishes them), insertion order. */
  regions: string[];
  /** Car ids that finished at least one race, insertion order. */
  carsFinished: string[];
  /** Trophy id → unlock time (epoch ms). */
  trophies: Record<string, number>;
}

export interface FinishInput {
  trackId: string;
  carId: string;
  ms: number;
  falls: number;
  medal: CareerMedal | null;
  /** 1-based position when there was anyone to race (rivals / friends), else null. */
  position: number | null;
  /** Steering source for the run. */
  steering?: 'touch' | 'tilt' | string;
}

export interface SampleInput {
  trackId: string | null;
  carId: string | null;
  distanceM: number;
  seconds: number;
  topSpeedKmh: number;
}

export interface FriendsRaceInput {
  /** We had a results row. */
  played: boolean;
  won: boolean;
  /** Results rows (players who raced). */
  players: number;
  /** We were the host when the lights went out. */
  hosted: boolean;
}

export const recordKey = (trackId: string, carId: string): string => `${trackId}|${carId}`;

export function emptyTotals(): CareerTotals {
  return {
    racesFinished: 0,
    wins: 0,
    podiums: 0,
    friendsPlayed: 0,
    friendsWon: 0,
    friendsWonWith3: 0,
    friendsHosted: 0,
    distanceM: 0,
    distanceByMap: {},
    topSpeedKmh: 0,
    topSpeedMap: null,
    topSpeedCar: null,
    longestAirS: 0,
    longestLeapM: 0,
    timePlayedS: 0,
    falls: 0,
    restarts: 0,
    tiltFinishes: 0,
    bestImprovementMs: 0,
  };
}

export function emptyRecord(): RaceRecord {
  return { bestMs: null, medal: null, bestPosition: null, runs: 0, falls: 0, cleanRuns: 0 };
}

export function emptyCareer(now = Date.now()): Career {
  return { v: CAREER_VERSION, createdAt: now, records: {}, totals: emptyTotals(), regions: [], carsFinished: [], trophies: {} };
}

const MEDAL_RANK: Record<CareerMedal, number> = { gold: 3, silver: 2, bronze: 1 };

/** The better of two medals (null = none). */
export function betterMedal(a: CareerMedal | null, b: CareerMedal | null): CareerMedal | null {
  if (a === null) return b;
  if (b === null) return a;
  return MEDAL_RANK[a] >= MEDAL_RANK[b] ? a : b;
}

const finite = (n: unknown, fallback = 0): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback);
const nonNeg = (n: unknown): number => Math.max(0, finite(n));

// ─────────────────────────────────────────────────────────────────────────────
// Reducers
// ─────────────────────────────────────────────────────────────────────────────

/** A finished race. */
export function recordFinish(c: Career, f: FinishInput): Career {
  if (!Number.isFinite(f.ms) || f.ms <= 0) return c;
  const key = recordKey(f.trackId, f.carId);
  const prev = c.records[key] ?? emptyRecord();
  const falls = Math.max(0, Math.round(f.falls));
  const improvement = prev.bestMs !== null && f.ms < prev.bestMs ? prev.bestMs - f.ms : 0;
  const record: RaceRecord = {
    bestMs: prev.bestMs === null ? f.ms : Math.min(prev.bestMs, f.ms),
    medal: betterMedal(prev.medal, f.medal),
    bestPosition: f.position === null ? prev.bestPosition : prev.bestPosition === null ? f.position : Math.min(prev.bestPosition, f.position),
    runs: prev.runs + 1,
    falls: prev.falls + falls,
    cleanRuns: prev.cleanRuns + (falls === 0 ? 1 : 0),
  };
  const raced = f.position !== null;
  const t = c.totals;
  const totals: CareerTotals = {
    ...t,
    racesFinished: t.racesFinished + 1,
    wins: t.wins + (raced && f.position === 1 ? 1 : 0),
    podiums: t.podiums + (raced && f.position !== null && f.position <= 3 ? 1 : 0),
    tiltFinishes: t.tiltFinishes + (f.steering === 'tilt' ? 1 : 0),
    bestImprovementMs: Math.max(t.bestImprovementMs, improvement),
  };
  const carsFinished = c.carsFinished.includes(f.carId) ? c.carsFinished : [...c.carsFinished, f.carId];
  return { ...c, records: { ...c.records, [key]: record }, totals, carsFinished };
}

/** A respawn that counts as a fall (fall / water / bounds). */
export function recordFall(c: Career): Career {
  return { ...c, totals: { ...c.totals, falls: c.totals.falls + 1 } };
}

export function recordRestart(c: Career): Career {
  return { ...c, totals: { ...c.totals, restarts: c.totals.restarts + 1 } };
}

/** Distance, time and top speed accumulated by the 10 Hz sampler (flushed every few seconds). */
export function addSample(c: Career, s: SampleInput): Career {
  const distanceM = nonNeg(s.distanceM);
  const seconds = nonNeg(s.seconds);
  const top = nonNeg(s.topSpeedKmh);
  const t = c.totals;
  if (distanceM === 0 && seconds === 0 && top <= t.topSpeedKmh) return c;
  const distanceByMap = s.trackId && distanceM > 0 ? { ...t.distanceByMap, [s.trackId]: (t.distanceByMap[s.trackId] ?? 0) + distanceM } : t.distanceByMap;
  const faster = top > t.topSpeedKmh;
  return {
    ...c,
    totals: {
      ...t,
      distanceM: t.distanceM + distanceM,
      distanceByMap,
      timePlayedS: t.timePlayedS + seconds,
      topSpeedKmh: faster ? Math.round(top * 10) / 10 : t.topSpeedKmh,
      topSpeedMap: faster ? s.trackId : t.topSpeedMap,
      topSpeedCar: faster ? s.carId : t.topSpeedCar,
    },
  };
}

/** An island AIR record landing (seconds in the air, metres covered). */
export function recordAir(c: Career, seconds: number, metres: number): Career {
  const t = c.totals;
  const airS = Math.max(t.longestAirS, nonNeg(seconds));
  const leapM = Math.max(t.longestLeapM, nonNeg(metres));
  if (airS === t.longestAirS && leapM === t.longestLeapM) return c;
  return { ...c, totals: { ...t, longestAirS: Math.round(airS * 100) / 100, longestLeapM: Math.round(leapM * 10) / 10 } };
}

export function visitRegion(c: Career, label: string): Career {
  const clean = label.trim();
  if (!clean || c.regions.includes(clean)) return c;
  return { ...c, regions: [...c.regions, clean] };
}

/** A friends race closed (results), or our lights went out as the host. */
export function recordFriendsRace(c: Career, r: FriendsRaceInput): Career {
  const t = c.totals;
  const won = r.played && r.won;
  return {
    ...c,
    totals: {
      ...t,
      friendsPlayed: t.friendsPlayed + (r.played ? 1 : 0),
      friendsWon: t.friendsWon + (won ? 1 : 0),
      friendsWonWith3: t.friendsWonWith3 + (won && r.players >= 3 ? 1 : 0),
      friendsHosted: t.friendsHosted + (r.hosted ? 1 : 0),
    },
  };
}

/** Marks trophies unlocked at `now` (already-unlocked ids keep their first time). */
export function unlockTrophies(c: Career, ids: readonly string[], now: number): Career {
  const fresh = ids.filter((id) => !(id in c.trophies));
  if (fresh.length === 0) return c;
  const trophies = { ...c.trophies };
  for (const id of fresh) trophies[id] = now;
  return { ...c, trophies };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selectors
// ─────────────────────────────────────────────────────────────────────────────

export function medalCounts(c: Career): Record<CareerMedal, number> {
  const out: Record<CareerMedal, number> = { gold: 0, silver: 0, bronze: 0 };
  for (const r of Object.values(c.records)) if (r.medal) out[r.medal]++;
  return out;
}

/** The record for a (track, car), or null. */
export const recordOf = (c: Career, trackId: string, carId: string): RaceRecord | null => c.records[recordKey(trackId, carId)] ?? null;

/** Medal of a (track, car), or null. */
export const medalOf = (c: Career, trackId: string, carId: string): CareerMedal | null => recordOf(c, trackId, carId)?.medal ?? null;

/** Distinct track ids that have a record with a car. */
export function tracksWithMedal(c: Career, medal: CareerMedal, carId?: string): Set<string> {
  const out = new Set<string>();
  for (const [key, r] of Object.entries(c.records)) {
    if (!r.medal || MEDAL_RANK[r.medal] < MEDAL_RANK[medal]) continue;
    const [trackId, car] = key.split('|');
    if (!trackId || !car) continue;
    if (carId !== undefined && car !== carId) continue;
    out.add(trackId);
  }
  return out;
}

/** Cars that hold at least one medal (any colour). */
export function carsWithMedal(c: Career): Set<string> {
  const out = new Set<string>();
  for (const [key, r] of Object.entries(c.records)) {
    const car = key.split('|')[1];
    if (r.medal && car) out.add(car);
  }
  return out;
}

export const kmDriven = (c: Career): number => c.totals.distanceM / 1000;

/** The shape of a standings participant this module needs (rivals/standings.ts Participant). */
export interface FinishRow {
  kind: 'player' | 'rival' | 'remote' | 'ghost';
  finished: boolean;
  finishMs: number | null;
}

/**
 * The player's position the instant it crosses the line at `elapsedMs`: 1 + everyone (ghosts aside)
 * who already has a finish time at or under it; `total` counts everyone ranked. null when the player
 * raced alone (no one to beat). Independent of when the standings were last published.
 */
export function finishPosition(rows: readonly FinishRow[], elapsedMs: number): { position: number; total: number } | null {
  let total = 0;
  let ahead = 0;
  for (const r of rows) {
    if (r.kind === 'ghost') continue;
    total++;
    if (r.kind !== 'player' && r.finished && r.finishMs !== null && r.finishMs <= elapsedMs) ahead++;
  }
  return total >= 2 ? { position: ahead + 1, total } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence (sanitized on the way in; version-gated)
// ─────────────────────────────────────────────────────────────────────────────

const asMedal = (v: unknown): CareerMedal | null => (v === 'gold' || v === 'silver' || v === 'bronze' ? v : null);

function sanitizeRecord(raw: unknown): RaceRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const bestMs = typeof r.bestMs === 'number' && Number.isFinite(r.bestMs) && r.bestMs > 0 ? Math.round(r.bestMs) : null;
  const bestPosition = typeof r.bestPosition === 'number' && Number.isFinite(r.bestPosition) && r.bestPosition >= 1 ? Math.round(r.bestPosition) : null;
  return {
    bestMs,
    medal: asMedal(r.medal),
    bestPosition,
    runs: Math.round(nonNeg(r.runs)),
    falls: Math.round(nonNeg(r.falls)),
    cleanRuns: Math.round(nonNeg(r.cleanRuns)),
  };
}

function stringList(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 48 || out.includes(v)) continue;
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Anything from storage → a valid Career (unknown version or junk → empty). */
export function sanitizeCareer(raw: unknown, now = Date.now()): Career {
  const empty = emptyCareer(now);
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Record<string, unknown>;
  if (r.v !== CAREER_VERSION) return empty;
  const records: Record<string, RaceRecord> = {};
  if (r.records && typeof r.records === 'object') {
    for (const [key, value] of Object.entries(r.records as Record<string, unknown>)) {
      if (typeof key !== 'string' || !key.includes('|') || key.length > 96) continue;
      const rec = sanitizeRecord(value);
      if (rec) records[key] = rec;
    }
  }
  const t = (r.totals && typeof r.totals === 'object' ? r.totals : {}) as Record<string, unknown>;
  const byMap: Record<string, number> = {};
  if (t.distanceByMap && typeof t.distanceByMap === 'object') {
    for (const [k, v] of Object.entries(t.distanceByMap as Record<string, unknown>)) if (typeof k === 'string' && k.length <= 48 && nonNeg(v) > 0) byMap[k] = nonNeg(v);
  }
  const base = emptyTotals();
  const totals: CareerTotals = {
    racesFinished: Math.round(nonNeg(t.racesFinished)),
    wins: Math.round(nonNeg(t.wins)),
    podiums: Math.round(nonNeg(t.podiums)),
    friendsPlayed: Math.round(nonNeg(t.friendsPlayed)),
    friendsWon: Math.round(nonNeg(t.friendsWon)),
    friendsWonWith3: Math.round(nonNeg(t.friendsWonWith3)),
    friendsHosted: Math.round(nonNeg(t.friendsHosted)),
    distanceM: nonNeg(t.distanceM),
    distanceByMap: byMap,
    topSpeedKmh: nonNeg(t.topSpeedKmh),
    topSpeedMap: typeof t.topSpeedMap === 'string' ? t.topSpeedMap : base.topSpeedMap,
    topSpeedCar: typeof t.topSpeedCar === 'string' ? t.topSpeedCar : base.topSpeedCar,
    longestAirS: nonNeg(t.longestAirS),
    longestLeapM: nonNeg(t.longestLeapM),
    timePlayedS: nonNeg(t.timePlayedS),
    falls: Math.round(nonNeg(t.falls)),
    restarts: Math.round(nonNeg(t.restarts)),
    tiltFinishes: Math.round(nonNeg(t.tiltFinishes)),
    bestImprovementMs: nonNeg(t.bestImprovementMs),
  };
  const trophies: Record<string, number> = {};
  if (r.trophies && typeof r.trophies === 'object') {
    for (const [id, at] of Object.entries(r.trophies as Record<string, unknown>)) if (typeof id === 'string' && id.length <= 32 && typeof at === 'number' && Number.isFinite(at)) trophies[id] = at;
  }
  return {
    v: CAREER_VERSION,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now,
    records,
    totals,
    regions: stringList(r.regions, 64),
    carsFinished: stringList(r.carsFinished, 32),
    trophies,
  };
}

export function loadCareer(): Career {
  try {
    if (typeof window === 'undefined') return emptyCareer();
    const raw = window.localStorage.getItem(CAREER_STORAGE_KEY);
    return sanitizeCareer(raw ? JSON.parse(raw) : null);
  } catch {
    return emptyCareer();
  }
}

export function saveCareer(c: Career): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(c));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export interface CareerStore {
  career: Career;
  /** Replace the career (no-op when identical); persists. */
  commit: (next: Career) => void;
  /** RESET CAREER: back to empty, persisted. */
  reset: () => void;
}

export const useCareer = create<CareerStore>()((set, get) => ({
  career: loadCareer(),
  commit: (next) => {
    if (next === get().career) return;
    set({ career: next });
    saveCareer(next);
  },
  reset: () => {
    const next = emptyCareer();
    set({ career: next });
    saveCareer(next);
  },
}));

/** Non-React access. */
export const careerState = (): CareerStore => useCareer.getState();
