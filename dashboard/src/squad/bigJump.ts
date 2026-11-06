import {
  DEFAULT_CAR_CLASS_ID,
  SQUAD_CONTROL_SPECS,
  estimateTopSpeedKmh,
  getCarClass,
  isCarClassId,
  mapSquadControlsToPhysics,
  type BigJumpAssessment,
  type CarClass,
  type GameTelemetry,
} from '../../../shared/protocol';
import { formatKmh, formatNumber, formatSigned } from '../lib/format';
import { MAPS } from './garage';
import type { PlaySession } from './session';

/**
 * The Big Jump card's words and its speed trap, kept free of React Native so the node tests can pin
 * them: the hint under each verdict, and CLEARED / SHORT for the latest jump, judged by what happened
 * next in the game (finish or fall), with the measured landing speed as the guess while it is unknown.
 */

// ── Verdict hints ────────────────────────────────────────────────────────────

const { engineTier: TIER, frontWingAero: WING } = SQUAD_CONTROL_SPECS;

export interface BestTopSpeed {
  kmh: number;
  tier: number;
  wing: number;
}

const bestTopCache = new Map<string, BestTopSpeed>();

/** The highest estimated top speed any slider setting gives this car (balance doesn't move it). */
export function bestTopSpeedKmh(car: Readonly<CarClass>): BestTopSpeed {
  const cached = bestTopCache.get(car.id);
  if (cached) return cached;
  let best: BestTopSpeed = { kmh: 0, tier: TIER.min, wing: WING.min };
  for (let tier = TIER.min; tier <= TIER.max; tier++) {
    for (let wing = WING.min; wing <= WING.max; wing++) {
      const kmh = estimateTopSpeedKmh(mapSquadControlsToPhysics({ frontWingAero: wing, engineTier: tier, chassisBalance: 0 }, car), car);
      if (kmh > best.kmh) best = { kmh, tier, wing };
    }
  }
  bestTopCache.set(car.id, best);
  return best;
}

/**
 * TOO SLOW with lift-off this close above top speed: the nose is already light on the run-up, and less
 * wing (the usual "less drag" advice) lowers lift-off far faster than it raises top speed (median per
 * wing point in this window: hypercar −2.5 / +0.5 km/h, rally −3.5 / +0.4, muscle −1.9 / +0.3,
 * formula −8.3 / +1.1). The window is the car's noseLiftReserveKmh (8–12 km/h), the same reserve the
 * fast-enough NOSE LIFT rule uses. Sim check (game build, chaos jump, standstill at the jump's
 * checkpoint, full throttle; 88 TOO SLOW settings with a lift-off, tiers 2–5, balance −45…+50): 30 lifted
 * the nose or ran off before the lip (hypercar 12 / 4 / 0 at 171.5 km/h, rally 5 / 4 / 30, muscle
 * 18 / 4 / 36, formula 1 / 4 / −40), every one with lift-off less than 10.0 km/h above top speed and
 * inside its car's reserve (largest: hypercar 10.0 of 12, muscle 8.7 of 12, rally 8.5 of 10, formula
 * 4.6 of 8; rearward balance lifts at the larger gaps, forward balance only within ~3 km/h); none of the 19 runs at or above the reserve
 * lifted. See game/README.md "Big jump honesty".
 */
export function liftOffNearTopSpeed(jump: BigJumpAssessment, car: Readonly<CarClass>): boolean {
  return jump.liftOffKmh !== null && jump.liftOffKmh < jump.topSpeedKmh + car.noseLiftReserveKmh;
}

/**
 * At the top Engine Tier, too slow, with the nose light (NOSE LIFT, or TOO SLOW inside the lift-off
 * window): the only speed left is less wing, and less wing lifts the nose, so the balance has to move
 * forward first. Every such setting on both jump maps has a READY with the balance further forward and
 * less wing at tier 5 (rally 177 + 255, muscle 72 + 36 settings on chaos; none on the Isles), and the
 * car's JUMP ATTEMPT preset is one of them (test/bigJump.test.ts). Sim check (chaos, standstill at the
 * jump's checkpoint, full throttle): rally 5 / 5 / 0 falls short at 179.8 and 3 / 5 / 0 lifts the nose,
 * while 5 / 5 / −40 clears at 184.3 and 2 / 5 / −40 at 185.0; muscle 23 / 5 / 30 lifts at 182.4 and
 * 20 / 5 / 0 clears at 182.6.
 */
const TOP_TIER_FIX = 'move Chassis Balance forward first, then trim the front wing, or tap the JUMP ATTEMPT preset.';

/** The hint for a car whose best estimated top speed is below the jump's requirement (buggy anywhere, kart on chaos). */
function noSetupHint(car: Readonly<CarClass>, requiredKmh: number, best: BestTopSpeed): string {
  return `No setup gets the ${car.name} to ${formatKmh(requiredKmh)} km/h: its best estimate is ${formatKmh(best.kmh)} km/h (Engine Tier ${best.tier}, ${best.wing} % wing). Pick another car for this jump.`;
}

/**
 * What to change, for the verdict on screen. Every hint points the same way as its verdict and only
 * suggests moves the sliders still allow: `engineTier` is the setting being judged, so at the top tier
 * no hint says "raise Engine Tier".
 */
export function bigJumpHint(jump: BigJumpAssessment, car: Readonly<CarClass>, engineTier: number): string {
  const tooSlow = jump.topSpeedKmh < jump.requiredKmh;
  const topTier = engineTier >= TIER.max;
  switch (jump.verdict) {
    case 'READY':
      return 'Carries lip speed with the nose planted. Send it.';
    case 'NOSE LIFT': {
      // Fast enough: the nose lifts (or goes too light to steer) on the run-up. Too slow as well: the
      // car does reach its lift-off speed, so the nose comes up first, and it needs more speed after.
      if (!tooSlow) return 'Front lifts (or goes too light to steer) on the run-up: add front wing or shift Chassis Balance forward.';
      // …unless no setup is ever fast enough (the kart on chaos lifts its nose at 0 % wing and still
      // tops out below the lip speed): then no preset can help, say so.
      const best = bestTopSpeedKmh(car);
      if (best.kmh < jump.requiredKmh) return noSetupHint(car, jump.requiredKmh, best);
      return topTier
        ? `Front lifts on the run-up, and the car is too slow for the lip even at Engine Tier ${TIER.max}: ${TOP_TIER_FIX}`
        : 'Front lifts on the run-up, and the car is too slow for the lip anyway: shift Chassis Balance forward or add front wing to keep the nose down, then raise Engine Tier.';
    }
    case 'TOO SLOW': {
      const best = bestTopSpeedKmh(car);
      if (best.kmh < jump.requiredKmh) return noSetupHint(car, jump.requiredKmh, best);
      if (jump.liftOffKmh !== null && liftOffNearTopSpeed(jump, car)) {
        const near = `lift-off ${formatKmh(jump.liftOffKmh)} km/h is close to top speed ${formatKmh(jump.topSpeedKmh)}`;
        if (topTier) return `Not enough top speed, and less wing lifts the nose at this balance (${near}): ${TOP_TIER_FIX}`;
        // Raising Engine Tier lowers lift-off as well (more torque unloads the nose), so the next stop is
        // usually NOSE LIFT, whose hint takes over from there.
        return `Not enough top speed: raise Engine Tier and keep the front wing (${near}; less wing lifts the nose). More engine lifts it too: if it turns NOSE LIFT, add wing or move the balance forward.`;
      }
      return topTier
        ? `Not enough top speed at Engine Tier ${TIER.max}: trim the front wing (less drag).`
        : 'Not enough top speed: raise Engine Tier or trim the front wing (less drag).';
    }
  }
}

// ── Speed trap ───────────────────────────────────────────────────────────────

/** The lip speed that lands this map's big jump with this car, and where the number comes from. */
export interface LandingSpeed {
  kmh: number;
  /**
   * 'car': measured in the game's sim for this car on this map. 'hypercar': measured with the Neon
   * Hypercar only (this car may need a few km/h more or less). 'sign': no landing measurement for
   * this map in this build (an unknown map, or the game reports a different lip than our copy), so
   * the map's lip sign stands in.
   */
  source: 'car' | 'hypercar' | 'sign';
}

/**
 * The speed the speed trap's guess (LIKELY CLEARS / LIKELY SHORT, while the outcome is unknown) and
 * its margin use: the measured landing lip speed (garage.ts MAPS landKmhByCar / landKmh, copied from
 * the game's catalog), not the estimate target (bigJumpKmh). On Cloudbreak Isles the sign says 163
 * but anything over 160 at the lip lands.
 */
export function landingSpeedFor(session: Pick<PlaySession, 'carId' | 'trackId' | 'bigJumpKmh'>): LandingSpeed | null {
  const lip = session.bigJumpKmh;
  if (lip === null) return null;
  const map = session.trackId === null ? undefined : MAPS.find((m) => m.id === session.trackId);
  // A game build whose lip differs from our copy has other landing numbers too: trust only its lip.
  if (!map || map.bigJumpKmh !== lip) return { kmh: lip, source: 'sign' };
  const perCar = isCarClassId(session.carId) ? map.landKmhByCar?.[session.carId] : undefined;
  if (perCar !== undefined) return { kmh: perCar, source: 'car' };
  return { kmh: map.landKmh ?? lip, source: session.carId === DEFAULT_CAR_CLASS_ID ? 'car' : 'hypercar' };
}

// ── Jump outcome, from the telemetry stream ──────────────────────────────────
//
// The game sends speedTrapKmh (the lip speed of the latest crossing; null until the first one and
// after a restart), falls (pit falls this run) and finished at 10 Hz. On both jump maps (GamerFleet
// Chaos, Cloudbreak Isles) the big jump is the last section: one checkpoint at the start of its
// run-up, then the lip, the landing hill and the finish gate 36 m into the run-out, with no
// checkpoint after the lip (game/src/track/chaos/plan.ts bigJump()). So the finish line is only
// reachable by landing a jump, and the run finishing proves that the latest crossing landed. A
// short jump drops into the void under the landing and counts a fall. A respawn puts the car back at
// the run-up checkpoint without clearing the reading; a restart, a car change or a map change clear
// it (null).

export type JumpOutcome =
  /** No finish or fall seen since this reading: in the air, or we couldn't tell (see watchSpeedTrap). */
  | 'pending'
  /** The run finished after this reading: it landed. */
  | 'cleared'
  /** A fall followed this reading. */
  | 'short';

/** The latest lip crossing and what came of it. */
export interface JumpAttempt {
  /** The game's lip speed for the crossing, km/h. */
  trapKmh: number;
  /** telemetry.falls when the reading arrived: any higher count later means this jump fell. */
  falls: number;
  outcome: JumpOutcome;
}

/** watchSpeedTrap's memory between telemetry frames. */
export interface SpeedTrapWatch {
  attempt: JumpAttempt | null;
  /** The previous frame's finished flag; null before the first frame (a dashboard that just joined). */
  lastFinished: boolean | null;
  /**
   * The previous frame's finish time (telemetry elapsedMs, which the game freezes at the finish) while
   * finished, else null. A finished frame with a different time is a new finish: the run was restarted
   * and finished again while this dashboard got no frames (dropped link, relay reconnect).
   */
  finishElapsedMs: number | null;
  /**
   * The attempt's CLEARED comes only from the first frame this dashboard saw being finished, so the
   * reading may be a crossing made after the finish (RESPAWN after finishing keeps finished = true). A
   * later fall can still prove it SHORT; a finish this dashboard saw happen can't be undone.
   */
  clearedOnJoin: boolean;
}

export const NO_SPEED_TRAP_WATCH: Readonly<SpeedTrapWatch> = Object.freeze({
  attempt: null,
  lastFinished: null,
  finishElapsedMs: null,
  clearedOnJoin: false,
});

/**
 * Fold one telemetry frame into the jump attempt. Frames can go missing (backgrounded tab, relay
 * reconnect, a dashboard that joins mid-run), so each rule only uses what the frame proves:
 *   - speedTrapKmh null: no attempt (before the first jump, or the game restarted the run).
 *   - A different reading, or fewer falls than at the reading (a restart we missed): a new attempt,
 *     pending, remembering the current fall count.
 *   - A finish we haven't counted (finished turned true; the first frame we ever see is finished; or a
 *     finished frame with a different finish time, i.e. a restart and a new finish we missed): CLEARED.
 *     This also corrects a SHORT whose retry crossed the lip at exactly the same speed.
 *   - Pending and falls went up: SHORT. Also for a CLEARED that only came from the first frame we saw
 *     (clearedOnJoin): that reading may have been a jump made after the finish.
 * A crossing made after a finish we saw can only go SHORT or stay pending. A jump that lands and then
 * flips (respawn without a fall) stays pending until the next crossing. Not provable either way: a
 * dashboard that joins after the finish, then sees a fall on the run-up with no new crossing, calls
 * the jump it never saw SHORT.
 * Returns `prev.attempt`'s object when the attempt didn't change, so store subscribers don't re-render.
 */
export function watchSpeedTrap(
  prev: Readonly<SpeedTrapWatch>,
  frame: Pick<GameTelemetry, 'speedTrapKmh' | 'falls' | 'finished' | 'elapsedMs'>,
): SpeedTrapWatch {
  const { speedTrapKmh, falls, finished, elapsedMs } = frame;
  const finishElapsedMs = finished ? elapsedMs : null;
  if (speedTrapKmh === null) return { attempt: null, lastFinished: finished, finishElapsedMs, clearedOnJoin: false };
  let attempt = prev.attempt;
  let clearedOnJoin = prev.clearedOnJoin;
  if (attempt === null || attempt.trapKmh !== speedTrapKmh || falls < attempt.falls) {
    attempt = { trapKmh: speedTrapKmh, falls, outcome: 'pending' };
    clearedOnJoin = false;
  }
  const newFinish = finished && (prev.lastFinished !== true || elapsedMs !== prev.finishElapsedMs);
  if (newFinish) {
    if (attempt.outcome !== 'cleared') attempt = { ...attempt, outcome: 'cleared' };
    clearedOnJoin = prev.lastFinished === null;
  } else if (falls > attempt.falls && (attempt.outcome === 'pending' || (attempt.outcome === 'cleared' && clearedOnJoin))) {
    attempt = { ...attempt, outcome: 'short' };
    clearedOnJoin = false;
  }
  return { attempt, lastFinished: finished, finishElapsedMs, clearedOnJoin };
}

export type SpeedTrapVerdict = 'CLEARED' | 'SHORT' | 'LIKELY CLEARS' | 'LIKELY SHORT';

export interface SpeedTrapReading {
  verdict: SpeedTrapVerdict;
  /** True once the game showed what happened (finish or fall); false while it is the landing-speed guess. */
  settled: boolean;
  /** Measured lip speed − landing speed, km/h (for information once settled). */
  marginKmh: number;
  /** 'CLEARED +1.0', 'SHORT −2.0', 'LIKELY CLEARS +0.5', 'LIKELY SHORT −1.5'. */
  label: string;
  /** One line under the reading: what decided the verdict. */
  status: string;
}

/**
 * The speed trap's verdict for an attempt: CLEARED / SHORT from what the game reported after the
 * reading, else LIKELY CLEARS / LIKELY SHORT from the measured landing speed (landingSpeedFor).
 */
export function judgeSpeedTrap(attempt: Pick<JumpAttempt, 'trapKmh' | 'outcome'>, landing: LandingSpeed): SpeedTrapReading {
  const marginKmh = attempt.trapKmh - landing.kmh;
  const margin = formatSigned(marginKmh, 1);
  const under = formatNumber(Math.abs(marginKmh), 1);
  const ref = `the measured landing speed (${formatNumber(landing.kmh, 1)})`;
  switch (attempt.outcome) {
    case 'cleared':
      return {
        verdict: 'CLEARED',
        settled: true,
        marginKmh,
        label: `CLEARED ${margin}`,
        status: marginKmh < 0 ? `Landed: the run finished, ${under} km/h under ${ref}. Little to spare.` : 'Landed: the run finished.',
      };
    case 'short':
      return {
        verdict: 'SHORT',
        settled: true,
        marginKmh,
        label: `SHORT ${margin}`,
        status: marginKmh >= 0 ? `Fell after this lip reading, though it was over ${ref}.` : 'Fell after this lip reading.',
      };
    case 'pending': {
      const likely = marginKmh >= 0 ? 'LIKELY CLEARS' : 'LIKELY SHORT';
      return {
        verdict: likely,
        settled: false,
        marginKmh,
        label: `${likely} ${margin}`,
        status: 'No finish or fall seen yet: a guess from the landing speed.',
      };
    }
  }
}

/** The small print under the speed trap: what the reading was judged against. */
export function speedTrapNote(landing: LandingSpeed, lipKmh: number, carId: string): string {
  const lands = `lands from ${formatNumber(landing.kmh, 1)} km/h`;
  const sign = `lip sign ${formatKmh(lipKmh)}`;
  switch (landing.source) {
    case 'car':
      return Math.abs(landing.kmh - lipKmh) < 0.05 ? `${lands} (the lip sign) · measured for this car` : `${lands} · measured for this car · ${sign}`;
    case 'hypercar':
      return `${lands} with the ${getCarClass(DEFAULT_CAR_CLASS_ID).name} · this car may need a few km/h more or less · ${sign}`;
    case 'sign':
      return carId === DEFAULT_CAR_CLASS_ID
        ? `map ${sign} km/h · no landing measurement in this dashboard build`
        : `map ${sign} km/h · set for the ${getCarClass(DEFAULT_CAR_CLASS_ID).name}, this car may need a few km/h more or less`;
  }
}
