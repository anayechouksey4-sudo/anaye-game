/**
 * Which tyres smoke, and how hard: pure functions of the car runtime's wheel state (no three.js,
 * no React), used by TireSmoke.tsx and checked on their own.
 */
import type { WheelSpec } from '../vehicleSpec';

/** slip01 where smoke starts, and where it reaches full intensity. */
export const SLIP_START = 0.25;
export const SLIP_FULL = 0.85;
/** Throttle above which a spinning driven front wheel counts as drive wheelspin. */
export const FRONT_SPIN_THROTTLE = 0.05;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Smoke intensity 0…1 for one rear wheel (0 when gripping or airborne). */
export function smokeIntensity(inContact: boolean, slip01: number): number {
  return inContact ? smoothstep(SLIP_START, SLIP_FULL, slip01) : 0;
}

/**
 * Smoke intensity 0…1 for a driven FRONT wheel: only drive wheelspin counts (throttle on, tread
 * faster than the car, longitudinal slip bigger than the sideways slide). A front tyre that scrubs
 * through a corner or locks under braking stays clean, so steering never smokes the fronts.
 */
export function frontSpinIntensity(
  w: { inContact: boolean; slip01: number; spinRate: number; longitudinalSlip: number; lateralSlip: number },
  wheel: Pick<WheelSpec, 'driven' | 'radius'>,
  throttle: number,
  forwardSpeed: number,
): number {
  if (!wheel.driven || throttle <= FRONT_SPIN_THROTTLE) return 0;
  if (w.spinRate * wheel.radius <= forwardSpeed || w.longitudinalSlip <= w.lateralSlip) return 0;
  return smokeIntensity(w.inContact, w.slip01);
}

