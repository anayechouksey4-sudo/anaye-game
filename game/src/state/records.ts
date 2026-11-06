/**
 * Best times, medals and big-jump reach for the menu cards, the start card and the results screen.
 *
 * Best times live in store.ts (`loadBestTime(trackId, carId)`, per map AND car, saved on the
 * finish line; the storage keys are untouched here). This module adds:
 *   - medal times PER CAR: the map catalog's `medalsMs` are hypercar times; every other car gets
 *     them scaled by its measured full-course time relative to the hypercar's (`medalsFor`);
 *   - big-jump reach: whether a car can ever clear a map's big jump with any dashboard setting
 *     (`jumpReach`, from the protocol's assessBigJump). A car that can't gets no medals there.
 */
import {
  SQUAD_CONTROL_SPECS,
  assessBigJump,
  mapSquadControlsToPhysics,
  requiredJumpKmh,
  type SquadControls,
} from '@shared/protocol';
import { TRACK_CATALOG, type TrackMedals } from '../track/catalog';
import { DEFAULT_CAR_ID } from './selection';

export { loadBestTime } from './store';

export type Medal = 'gold' | 'silver' | 'bronze';

/** Best first. */
export const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];

export const MEDAL_LABEL: Readonly<Record<Medal, string>> = { gold: 'GOLD', silver: 'SILVER', bronze: 'BRONZE' };

/** The best medal a run time earns on a map (at or under its time), or null. */
export function medalFor(ms: number | null | undefined, medals: TrackMedals | null | undefined): Medal | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || !medals) return null;
  return MEDALS.find((m) => ms <= medals[m]) ?? null;
}

/** The next medal to chase after `ms` (null = gold already, or no medals). */
export function nextMedal(ms: number | null | undefined, medals: TrackMedals | null | undefined): { medal: Medal; ms: number } | null {
  if (!medals) return null;
  const have = medalFor(ms, medals);
  const index = have === null ? MEDALS.length : MEDALS.indexOf(have);
  const next = MEDALS[index - 1];
  return next ? { medal: next, ms: medals[next] } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-car medal times
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-course autopilot times, seconds: the median of the runs without a fall, out of 24 runs per
 * car per map (8 on the Isles and the Strip, where runs barely vary), each started at a different
 * hazard phase. Same driver for every car (the maps / integration autopilot: pure pursuit on the
 * ideal line, curvature + braking speed plan, hazard timing, plus a gentle traction control) and the
 * same sliders for every car: the ones each map's hypercar medals were set with (ribbon 60/4/0,
 * isles 30/5/0, cryo 50/3/0, strip 20/5/0, chaos 50/3/0 with the car's JUMP ATTEMPT preset from the
 * jump checkpoint). Missing = can't finish (big jump out of reach). Measured with `?ws=off` and
 * `__RACER__.advance`; README "Medals per car" has the resulting medal table.
 */
export const MEASURED_COURSE_S: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  chaos: { hypercar: 54.15, rally: 54.67, muscle: 51.54, formula: 53.56 },
  ribbon: { hypercar: 40.96, rally: 40.82, muscle: 40.88, formula: 41.62, buggy: 44.11 },
  isles: { hypercar: 48.83, rally: 49.2, muscle: 49.08, formula: 49.21 },
  cryo: { hypercar: 56.67, rally: 52.67, muscle: 56.52, formula: 55.0, buggy: 61.16 },
  strip: { hypercar: 24.66, rally: 24.15, muscle: 24.6, formula: 23.27, buggy: 34.07 },
};

/**
 * Ratios this close to 1 are inside the autopilot's run-to-run noise (hazard waits move a chaos
 * median by ±2 %): those cars keep the hypercar's times.
 */
const SCALE_DEAD_BAND = 0.02;
/** Medal times are rounded to this, ms. */
const MEDAL_ROUND_MS = 500;

/** A car's time on a map relative to the hypercar's (1 = hypercar medals; unmeasured cars get 1). */
export function medalScale(trackId: string, carId: string): number {
  const row = MEASURED_COURSE_S[trackId];
  const car = row?.[carId];
  const base = row?.[DEFAULT_CAR_ID];
  if (!car || !base) return 1;
  const ratio = car / base;
  return Math.abs(ratio - 1) < SCALE_DEAD_BAND ? 1 : ratio;
}

const roundMedal = (ms: number) => Math.round(ms / MEDAL_ROUND_MS) * MEDAL_ROUND_MS;

/**
 * Medal times for this car on this map: the catalog's hypercar times exactly for the hypercar (and
 * cars inside the noise band), else scaled by `medalScale` and rounded to 0.5 s (kept strictly
 * gold < silver < bronze). null when the map has no medals or the car can't clear its big jump.
 */
export function medalsFor(trackId: string, carId: string): TrackMedals | null {
  const base = TRACK_CATALOG.find((t) => t.id === trackId)?.medalsMs;
  if (!base) return null;
  if (jumpReach(trackId, carId)?.reachable === false) return null;
  const scale = medalScale(trackId, carId);
  if (scale === 1) return base;
  const gold = roundMedal(base.gold * scale);
  const silver = Math.max(roundMedal(base.silver * scale), gold + MEDAL_ROUND_MS);
  const bronze = Math.max(roundMedal(base.bronze * scale), silver + MEDAL_ROUND_MS);
  return { gold, silver, bronze };
}

// ─────────────────────────────────────────────────────────────────────────────
// Big-jump reach
// ─────────────────────────────────────────────────────────────────────────────

export interface JumpReach {
  /** The map's big-jump speed (catalog `bigJumpKmh`, the number on the lip sign). */
  mapKmh: number;
  /** Estimated top speed this car needs for it (requiredJumpKmh: the map's number × the class's scale). */
  requiredKmh: number;
  /** Some dashboard setting gets a READY from assessBigJump. */
  reachable: boolean;
  /** Fastest estimated top speed over every setting (only computed when unreachable, else null). */
  maxTopKmh: number | null;
}

const reachCache = new Map<string, JumpReach>();

/** Every dashboard setting, fastest engine tier first. */
function* allControls(): Generator<SquadControls> {
  const { frontWingAero: wing, engineTier: tier, chassisBalance: balance } = SQUAD_CONTROL_SPECS;
  const controls: SquadControls = { frontWingAero: 0, engineTier: 0, chassisBalance: 0 };
  for (let t = tier.max; t >= tier.min; t -= tier.step) {
    for (let a = wing.min; a <= wing.max; a += wing.step) {
      for (let b = balance.min; b <= balance.max; b += balance.step) {
        controls.frontWingAero = a;
        controls.engineTier = t;
        controls.chassisBalance = b;
        yield controls;
      }
    }
  }
}

/**
 * Can this car ever clear this map's big jump? Scans every dashboard setting (all tiers, the full
 * wing and balance ranges, in slider steps) through the protocol's `assessBigJump` with the map's
 * `bigJumpKmh` and stops at the first READY. null when the map has no big jump. Memoized per car +
 * jump speed (the full scan of an unreachable car is ~50 k estimates, a few tens of ms once).
 */
export function jumpReach(trackId: string, carId: string): JumpReach | null {
  const track = TRACK_CATALOG.find((t) => t.id === trackId);
  const mapKmh = track?.hasBigJump ? track.bigJumpKmh : undefined;
  if (mapKmh === undefined || !Number.isFinite(mapKmh) || mapKmh <= 0) return null;
  const key = `${carId}@${mapKmh}`;
  const cached = reachCache.get(key);
  if (cached) return cached;
  let reachable = false;
  let maxTop = 0;
  for (const controls of allControls()) {
    const verdict = assessBigJump(mapSquadControlsToPhysics(controls, carId), carId, mapKmh);
    if (verdict.ready) {
      reachable = true;
      break;
    }
    maxTop = Math.max(maxTop, verdict.topSpeedKmh);
  }
  const result: JumpReach = { mapKmh, requiredKmh: requiredJumpKmh(mapKmh, carId), reachable, maxTopKmh: reachable ? null : maxTop };
  reachCache.set(key, result);
  return result;
}

/** Short player-facing line for an unreachable jump: "Needs 183 km/h top speed · Dune Goblin tops out at 133 km/h". */
export function jumpOutOfReachNote(reach: JumpReach, carName: string): string {
  return `Needs ${Math.round(reach.requiredKmh)} km/h top speed · ${carName} tops out at ${Math.round(reach.maxTopKmh ?? 0)} km/h`;
}
