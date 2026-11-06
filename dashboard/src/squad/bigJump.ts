import {
  DEFAULT_CAR_CLASS_ID,
  SQUAD_CONTROL_SPECS,
  estimateTopSpeedKmh,
  getCarClass,
  isCarClassId,
  mapSquadControlsToPhysics,
  type BigJumpAssessment,
  type CarClass,
} from '../../../shared/protocol';
import { formatKmh, formatNumber, formatSigned } from '../lib/format';
import { MAPS } from './garage';
import type { PlaySession } from './session';

/**
 * The Big Jump card's words and its speed trap, kept free of React Native so the node tests can pin
 * them: the hint under each verdict, and CLEARED / SHORT for the lip speed the game measured.
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

/** What to change, for the verdict on screen. Every hint points the same way as its verdict. */
export function bigJumpHint(jump: BigJumpAssessment, car: Readonly<CarClass>): string {
  const tooSlow = jump.topSpeedKmh < jump.requiredKmh;
  switch (jump.verdict) {
    case 'READY':
      return 'Carries lip speed with the nose planted. Send it.';
    case 'NOSE LIFT':
      // Fast enough: the nose lifts (or goes too light to steer) on the run-up. Too slow as well: the
      // car does reach its lift-off speed, so the nose comes up first, and it needs more speed after.
      return tooSlow
        ? 'Front lifts on the run-up, and the car is too slow for the lip anyway: shift Chassis Balance forward or add front wing to keep the nose down, then raise Engine Tier.'
        : 'Front lifts (or goes too light to steer) on the run-up: add front wing or shift Chassis Balance forward.';
    case 'TOO SLOW': {
      const best = bestTopSpeedKmh(car);
      if (best.kmh < jump.requiredKmh) {
        return `No setup gets the ${car.name} to ${formatKmh(jump.requiredKmh)} km/h: its best estimate is ${formatKmh(best.kmh)} km/h (Engine Tier ${best.tier}, ${best.wing} % wing). Pick another car for this jump.`;
      }
      return 'Not enough top speed: raise Engine Tier or trim the front wing (less drag).';
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
 * The speed the speed trap is judged against: the measured landing lip speed (garage.ts MAPS
 * landKmhByCar / landKmh, copied from the game's catalog), not the estimate target (bigJumpKmh). On
 * Cloudbreak Isles the sign says 163 but anything over 160 at the lip lands.
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

export interface SpeedTrapReading {
  cleared: boolean;
  /** Measured lip speed − landing speed, km/h. */
  marginKmh: number;
  /** 'CLEARED +1.0' / 'SHORT −2.0'. */
  label: string;
}

export function judgeSpeedTrap(trapKmh: number, landing: LandingSpeed): SpeedTrapReading {
  const marginKmh = trapKmh - landing.kmh;
  const cleared = marginKmh >= 0;
  return { cleared, marginKmh, label: `${cleared ? 'CLEARED' : 'SHORT'} ${formatSigned(marginKmh, 1)}` };
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
