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
  estimateTopSpeedKmh,
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
 * ideal line, curvature + braking speed plan, hazard timing) and the same sliders for every car: the
 * ones each map's hypercar medals were set with (ribbon 60/4/0, isles 30/5/0, cryo 50/3/0, strip
 * 20/5/0, chaos 50/3/0 with the car's JUMP ATTEMPT preset from the jump checkpoint).
 *
 * Each car was driven twice over the same phases: flat out (the touch GAS is on/off, so a phone
 * player can't feather it) and with a gentle traction control (easing off while a tyre slips, like
 * pulsing the GAS). The Strip uses the flat-out medians, because flat out is clearly quicker there:
 * by 0.39 s for the hypercar and 0.37 s for the Bruiser V8 (a real-touch run holding GAS through the
 * lights takes gold with every car). On the other maps the two modes agree within run-to-run noise
 * (phase for phase, 0.16 s or less, median), so those keep the traction-control medians: taking
 * the lower of two noisy medians would only tilt the medals down at random (it would have moved the
 * Bruiser V8's chaos gold from 44.0 to 43.5 s with no real difference in pace).
 * Missing = can't finish (big jump out of reach). Measured with `?ws=off` and `__RACER__.advance`;
 * README "Medals per car" has the resulting medal table.
 *
 * The four newer cars (coupe, drift, electric, kart) were measured the same way with the same
 * autopilot and sliders, 8 runs per car per map at 8 hazard phases, FLAT OUT (traction control only
 * where flat out can't finish: the Smoke Lantern on Neon Ribbon, 0 of 8 flat out, 8 of 8 with the
 * usual traction control, and on Cryo Drift, where it needs a firmer one — easing off from 35 % slip
 * instead of 50 % — to bring 3 of 8 runs home without a fall, median 58.75), median of the runs
 * without a fall. A same-session hypercar control (8 phases) gave 54.35 / 41.48 /
 * 48.92 / 56.94 / 24.27 flat out against the stored 54.15 / 40.96 / 48.83 / 56.67 / 24.27, so the
 * stored bases stand. The kart's Isles time switches to its JUMP ATTEMPT preset at the leap's
 * checkpoint like every car does on chaos (with the map's 30/5/0 it reaches the lip at ~160 km/h
 * and falls every time); even so only 3 of 8 runs made the leap (lip 164.8–165.2 cleared, ≤ 162.5
 * short), so the Pixel Gnat's Isles medals are a marginal, honest target.
 *
 * Tessera Isle races (tessera-rim / -crown / -neon / -rally): the island autopilot (pure pursuit on the
 * race route, a speed plan from curvature with each car's off-road grip, gentle traction control) at
 * 50/3/0 for every car, 8 runs per car per race with the look-ahead jittered ±5 %, flat out and with
 * traction control; each row is the faster of the two medians, all 288 runs without a fall. The
 * catalog's island medals are the hypercar's median (gold), × 1.15 (silver), × 1.35 (bronze), rounded
 * to 0.5 s. No island race has a big jump, so every car, the buggy included, gets medals there.
 */
export const MEASURED_COURSE_S: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  chaos: { hypercar: 54.15, rally: 54.67, muscle: 51.54, formula: 53.56, coupe: 55.0, drift: 55.27, electric: 54.52 },
  ribbon: { hypercar: 40.96, rally: 40.82, muscle: 40.88, formula: 41.62, buggy: 44.11, coupe: 40.99, drift: 41.49, electric: 41.59, kart: 40.2 },
  isles: { hypercar: 48.83, rally: 49.2, muscle: 49.08, formula: 49.21, coupe: 48.5, drift: 52.3, electric: 49.59, kart: 51.47 },
  cryo: { hypercar: 56.67, rally: 52.67, muscle: 56.52, formula: 55.0, buggy: 61.16, coupe: 54.67, drift: 58.75, electric: 54.6, kart: 57.4 },
  strip: { hypercar: 24.27, rally: 24.15, muscle: 24.23, formula: 23.23, buggy: 34.07, coupe: 24.02, drift: 24.78, electric: 25.42, kart: 25.27 },
  // Tessera Isle races (see the note below).
  'tessera-rim': { hypercar: 127.39, formula: 135.46, muscle: 125.32, rally: 132.71, buggy: 175.53, coupe: 125.5, drift: 122.87, electric: 126.57, kart: 141.3 },
  'tessera-crown': { hypercar: 120.13, formula: 120.7, muscle: 118.03, rally: 120.1, buggy: 146.96, coupe: 120.85, drift: 119.18, electric: 123.47, kart: 119.97 },
  'tessera-neon': { hypercar: 56.39, formula: 55.9, muscle: 55.14, rally: 56.14, buggy: 65.57, coupe: 57.37, drift: 56.44, electric: 57.62, kart: 54.74 },
  'tessera-rally': { hypercar: 72.09, formula: 72.01, muscle: 70.24, rally: 68.12, buggy: 75.82, coupe: 71.88, drift: 71.94, electric: 71.39, kart: 72.32 },
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

/** First and last wing value allControls visits. */
function wingEnds(): [number, number] {
  const wing = SQUAD_CONTROL_SPECS.frontWingAero;
  let last = wing.min;
  for (let a = wing.min; a <= wing.max; a += wing.step) last = a;
  return [wing.min, last];
}

/**
 * The fastest ESTIMATED top speed (estimateTopSpeedKmh, the number assessBigJump compares) over
 * every setting allControls visits, from 10 estimates instead of ~50 k:
 *   - estimateTopSpeedKmh reads only mass, drag and engineTorque. Chassis balance only sets
 *     `balance` (mapSquadControlsToPhysics), so it never changes the estimate;
 *   - at a fixed tier the wing changes only drag, which is affine in the wing (dragBase +
 *     dragPerAero · a, then clamped and rounded, both monotonic), and the estimate falls as drag
 *     rises (both branches: v = √(net/drag), and the boosted-band root of drag·v² + β·v − c = 0);
 *   - so per tier the fastest wing is one end of the slider (0 % for every class today, whose
 *     dragPerAero is positive). Tiers are all checked: whether more tier is faster depends on the
 *     class's torque-per-tier against the added mass.
 * Checked against the full scan for every car on both jump maps and synthetic lip speeds
 * (README "Medals per car").
 */
function maxEstimatedTopKmh(carId: string): number {
  const { engineTier: tier, chassisBalance: balance } = SQUAD_CONTROL_SPECS;
  const controls: SquadControls = { frontWingAero: 0, engineTier: 0, chassisBalance: balance.default };
  let maxTop = 0;
  for (let t = tier.max; t >= tier.min; t -= tier.step) {
    for (const a of wingEnds()) {
      controls.frontWingAero = a;
      controls.engineTier = t;
      maxTop = Math.max(maxTop, estimateTopSpeedKmh(mapSquadControlsToPhysics(controls, carId), carId));
    }
  }
  return maxTop;
}

/**
 * Big-jump reach of a car for a jump speed (uncached; see jumpReach). READY needs an estimated top
 * speed of at least requiredJumpKmh (assessBigJump: below it the verdict is TOO SLOW or NOSE LIFT),
 * so when even the fastest setting is short the answer is "unreachable" with that top speed, without
 * a scan. Otherwise every setting goes through assessBigJump until the first READY.
 */
export function computeJumpReach(mapKmh: number, carId: string): JumpReach {
  const requiredKmh = requiredJumpKmh(mapKmh, carId);
  const fastest = maxEstimatedTopKmh(carId);
  if (fastest < requiredKmh) return { mapKmh, requiredKmh, reachable: false, maxTopKmh: fastest };
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
  return { mapKmh, requiredKmh, reachable, maxTopKmh: reachable ? null : maxTop };
}

/**
 * Can this car ever clear this map's big jump? Some dashboard setting (all tiers, the full wing and
 * balance ranges, in slider steps) gets a READY from the protocol's `assessBigJump` with the map's
 * `bigJumpKmh` (computeJumpReach). null when the map has no big jump. Memoized per car + jump speed;
 * a car too slow for the jump costs 10 estimates, a fast one stops at its first READY setting.
 */
export function jumpReach(trackId: string, carId: string): JumpReach | null {
  const track = TRACK_CATALOG.find((t) => t.id === trackId);
  const mapKmh = track?.hasBigJump ? track.bigJumpKmh : undefined;
  if (mapKmh === undefined || !Number.isFinite(mapKmh) || mapKmh <= 0) return null;
  const key = `${carId}@${mapKmh}`;
  const cached = reachCache.get(key);
  if (cached) return cached;
  const result = computeJumpReach(mapKmh, carId);
  reachCache.set(key, result);
  return result;
}

/** Short player-facing line for an unreachable jump: "Needs 183 km/h top speed · Dune Goblin tops out at 133 km/h". */
export function jumpOutOfReachNote(reach: JumpReach, carName: string): string {
  return `Needs ${Math.round(reach.requiredKmh)} km/h top speed · ${carName} tops out at ${Math.round(reach.maxTopKmh ?? 0)} km/h`;
}
