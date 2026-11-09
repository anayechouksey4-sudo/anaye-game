/**
 * One ranking for everyone in a race: the player, the three medal-pace rivals (rivals/), remote
 * players (multiplayer/) and the shadow ghost (ranked never: `kind: 'ghost'` is listed but not placed).
 *
 * CONTRACT (PLAN-M1 §2 R; other builders import these names — extend freely, never rename):
 *   registerParticipant(p) → unregister      setProgress(id, progressM)      setFinished(id, finishMs)
 *   routeProgressOf(position, lastGate)      useStandings()
 *
 * Progress is metres along the race route (rivals/route.ts: the centreline polyline the rivals drive),
 * monotonic per lap: a participant's progress never goes backwards unless it is reset (restart).
 * The ranking is published at most 10 Hz (`publishStandings`, called by RivalsLayer every 6 physics
 * steps and at once on register / finish), so the HUD never re-renders at 60 Hz.
 */
import { create } from 'zustand';
import type { Vector3 } from 'three';
import type { CarClassId } from '@shared/protocol';
import { stationOnRoute, type RaceRoute } from './route';

export type ParticipantKind = 'player' | 'rival' | 'remote' | 'ghost';

export interface Participant {
  id: string;
  name: string;
  carId: CarClassId;
  kind: ParticipantKind;
  /** Display colour (name tags, standings rows), CSS. */
  color: string;
  /** Metres along the route (monotonic per lap). */
  progressM: number;
  finished: boolean;
  finishMs: number | null;
  /**
   * Known or projected finish time, ms: rivals drive a plan so theirs is exact; others get an
   * estimate from their pace (`etaMs` is refreshed by setProgress when a speed is known).
   */
  etaMs: number | null;
  /** Route speed estimate, m/s (from progress deltas, or the speed a remote car reports), for gap estimates of participants with no plan. */
  speedMps: number;
  /** speedMps comes from setReportedSpeed (a friend's pose carries its speed); progress deltas are not used then. */
  reportedSpeed: boolean;
  /** Race clock (ms) of the last progress update. */
  lastAtMs: number;
  registeredAt: number;
}

export interface StandingRow {
  id: string;
  name: string;
  kind: ParticipantKind;
  carId: CarClassId;
  color: string;
  progressM: number;
  finished: boolean;
  finishMs: number | null;
  /** Seconds behind the car one place ahead (null for the leader, or when it cannot be estimated). */
  gapS: number | null;
  /** Seconds relative to the player: positive = this car is ahead of the player. */
  gapToPlayerS: number | null;
}

export interface StandingsSnapshot {
  order: StandingRow[];
  /** 1-based position of the player among everyone ranked (0 when the player is not registered). */
  playerPosition: number;
  /** Everyone ranked (ghosts excluded). */
  total: number;
  /** Race clock (ms since GO) at publish time. */
  raceMs: number;
}

/** The player's participant id (registered by rivals/RivalsLayer). */
export const PLAYER_ID = 'player';

const EMPTY: StandingsSnapshot = { order: [], playerPosition: 0, total: 0, raceMs: 0 };
const MIN_SPEED = 5; // m/s floor for gap estimates (a stopped car never shows an infinite gap)
let registrations = 0;

const participants = new Map<string, Participant>();
let route: RaceRoute | null = null;
let raceMs = 0;

const useStandingsStore = create<StandingsSnapshot>()(() => EMPTY);

/** React: the latest published ranking. */
export const useStandings = (): StandingsSnapshot => useStandingsStore();

/** Non-React access (results card, debug). */
export const standingsSnapshot = (): StandingsSnapshot => useStandingsStore.getState();

export function registerParticipant(p: { id: string; name: string; carId: CarClassId; kind: ParticipantKind; color?: string }): () => void {
  const entry: Participant = {
    id: p.id,
    name: p.name,
    carId: p.carId,
    kind: p.kind,
    color: p.color ?? '#d8f7ff',
    progressM: 0,
    finished: false,
    finishMs: null,
    etaMs: null,
    speedMps: 0,
    reportedSpeed: false,
    lastAtMs: raceMs,
    registeredAt: registrations++,
  };
  participants.set(p.id, entry);
  publishStandings(true);
  return () => {
    // Only this registration's entry: a re-registration under the same id is left alone.
    if (participants.get(p.id) !== entry) return;
    participants.delete(p.id);
    publishStandings(true);
  };
}

/** Metres along the race route, monotonic per lap. `etaMs` (optional): a known finish time (a rival's plan). */
export function setProgress(id: string, progressM: number, etaMs?: number): void {
  const p = participants.get(id);
  if (!p || p.finished || !Number.isFinite(progressM)) return;
  const dt = (raceMs - p.lastAtMs) / 1000;
  if (dt > 0.05 && !p.reportedSpeed) {
    const v = (progressM - p.progressM) / dt;
    // A sample behind the best progress so far (projection noise) is skipped without moving the
    // reference time, so the next forward sample is measured over the whole interval.
    if (v >= 0) {
      p.speedMps += (v - p.speedMps) * Math.min(1, dt * 2);
      p.lastAtMs = raceMs;
    }
  }
  if (progressM > p.progressM) p.progressM = progressM;
  if (etaMs !== undefined) p.etaMs = etaMs;
}

/**
 * The speed a participant reports (a friend's pose carries its car's speed): smoother and truer than
 * progress deltas, which arrive at the network's rhythm and read 0 between bursts.
 */
export function setReportedSpeed(id: string, mps: number): void {
  const p = participants.get(id);
  if (!p || p.finished || !Number.isFinite(mps) || mps < 0) return;
  p.speedMps = p.reportedSpeed ? p.speedMps + (mps - p.speedMps) * 0.3 : mps;
  p.reportedSpeed = true;
}

/** Progress allowed to go backwards (the player respawned to an earlier checkpoint). */
export function rewindProgress(id: string, progressM: number): void {
  const p = participants.get(id);
  if (!p || p.finished || !Number.isFinite(progressM)) return;
  p.progressM = Math.max(0, progressM);
  p.speedMps = 0;
  p.lastAtMs = raceMs;
}

/** Hard reset of one participant's progress (restart, lap reset); allowed to go backwards. */
export function resetProgress(id: string): void {
  const p = participants.get(id);
  if (!p) return;
  p.progressM = 0;
  p.finished = false;
  p.finishMs = null;
  p.etaMs = null;
  p.speedMps = 0;
  p.lastAtMs = raceMs;
}

export function setFinished(id: string, finishMs: number): void {
  const p = participants.get(id);
  if (!p || p.finished) return;
  p.finished = true;
  p.finishMs = finishMs;
  p.etaMs = finishMs;
  if (route) p.progressM = route.lengthM;
  publishStandings(true);
}

/** The route everyone is ranked on (null between races); resets every participant's progress. */
export function setStandingsRoute(next: RaceRoute | null): void {
  route = next;
  for (const p of participants.values()) resetProgress(p.id);
  publishStandings(true);
}

export const standingsRoute = (): RaceRoute | null => route;

/** The race clock the gaps are estimated against (ms since GO; RivalsLayer advances it). */
export function setRaceClock(ms: number): void {
  raceMs = ms;
}

/**
 * The same projection the player uses: metres along the route at the point nearest `position`,
 * searched between the last gate passed and the next one (so a car cannot gain progress by leaving
 * the course). 0 when no route is set.
 */
export function routeProgressOf(position: Vector3, lastGate: number): number {
  if (!route) return 0;
  return stationOnRoute(route, position.x, position.z, lastGate);
}

function rank(a: Participant, b: Participant): number {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  if (a.finished && b.finished) return (a.finishMs ?? 0) - (b.finishMs ?? 0) || a.registeredAt - b.registeredAt;
  return b.progressM - a.progressM || a.registeredAt - b.registeredAt;
}

/** Estimated ms until `p` reaches the finish (0 when finished). */
function remainingMs(p: Participant): number | null {
  if (p.finished) return 0;
  if (p.etaMs !== null) return Math.max(0, p.etaMs - raceMs);
  if (!route) return null;
  const left = Math.max(0, route.lengthM - p.progressM);
  return (left / Math.max(p.speedMps, MIN_SPEED)) * 1000;
}

/** Seconds `behind` trails `ahead` by (≥ 0 when the order is right; may be null). */
export function gapSeconds(ahead: Participant, behind: Participant): number | null {
  if (ahead.finished && behind.finished) return ((behind.finishMs ?? 0) - (ahead.finishMs ?? 0)) / 1000;
  if (ahead.finished && !behind.finished) {
    const left = remainingMs(behind);
    return left === null ? null : (raceMs + left - (ahead.finishMs ?? raceMs)) / 1000;
  }
  // Neither finished: the distance between them at the follower's pace (a rival's plan pace when known).
  const v = Math.max(behind.speedMps, MIN_SPEED);
  return Math.max(0, ahead.progressM - behind.progressM) / v;
}

let lastPublishMs = -Infinity;
const sorted: Participant[] = [];

/** Rebuild and publish the ranking (≤ 10 Hz unless `force`). */
export function publishStandings(force = false): void {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!force && now - lastPublishMs < 100) return;
  lastPublishMs = now;
  sorted.length = 0;
  for (const p of participants.values()) if (p.kind !== 'ghost') sorted.push(p);
  if (sorted.length === 0) {
    if (useStandingsStore.getState() !== EMPTY) useStandingsStore.setState(EMPTY);
    return;
  }
  sorted.sort(rank);
  const player = sorted.find((p) => p.kind === 'player') ?? null;
  const order: StandingRow[] = sorted.map((p, i) => {
    const ahead = i > 0 ? sorted[i - 1]! : null;
    let gapToPlayerS: number | null = null;
    if (player && p !== player) {
      const playerAhead = rank(player, p) < 0;
      const g = playerAhead ? gapSeconds(player, p) : gapSeconds(p, player);
      gapToPlayerS = g === null ? null : playerAhead ? -g : g;
    } else if (player && p === player) gapToPlayerS = 0;
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      carId: p.carId,
      color: p.color,
      progressM: p.progressM,
      finished: p.finished,
      finishMs: p.finishMs,
      gapS: ahead ? gapSeconds(ahead, p) : null,
      gapToPlayerS,
    };
  });
  useStandingsStore.setState({ order, playerPosition: player ? sorted.indexOf(player) + 1 : 0, total: sorted.length, raceMs });
}

/**
 * The results-card line: the player's position and the nearest other car — a human (remote) when one
 * is present, else a rival — with the gap in seconds. Null when the player raced alone.
 */
export function positionLine(): { position: number; total: number; text: string } | null {
  const snap = standingsSnapshot();
  if (snap.playerPosition === 0 || snap.total < 2) return null;
  const others = snap.order.filter((r) => r.kind !== 'player' && r.gapToPlayerS !== null);
  if (others.length === 0) return null;
  const humans = others.filter((r) => r.kind === 'remote');
  const pool = humans.length > 0 ? humans : others;
  const nearest = pool.reduce((best, r) => (Math.abs(r.gapToPlayerS!) < Math.abs(best.gapToPlayerS!) ? r : best));
  const gap = nearest.gapToPlayerS!;
  const name = nearest.name.toUpperCase();
  const secs = `${Math.abs(gap).toFixed(1)} S`;
  const text = gap > 0 ? `P${snap.playerPosition} · ${secs} BEHIND ${name}` : `P${snap.playerPosition} · AHEAD OF ${name} BY ${secs}`;
  return { position: snap.playerPosition, total: snap.total, text };
}

/** Everything registered (debug / tests). */
export const participantsList = (): Participant[] => [...participants.values()];

/** Tests only: forget every participant and the route. */
export function resetStandingsForTests(): void {
  participants.clear();
  route = null;
  raceMs = 0;
  lastPublishMs = -Infinity;
  useStandingsStore.setState(EMPTY);
}
