/**
 * Handling v2's pure tyre / brake / steering formulas, kept out of the controller so they can be
 * unit-tested (game/test/handling.test.ts) and read on their own. All allocation-free.
 */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Lowest / highest grip multiplier load sensitivity may produce. */
export const LOAD_SCALE_MIN = 0.6;
export const LOAD_SCALE_MAX = 1.25;

/**
 * Tyre load sensitivity: grip coefficient × (N / N0)^−sensitivity, where N0 is the tyre's static
 * load. A tyre carrying twice its static load gains less than twice the force (0.18 → ×0.88 of μ),
 * so load transfer costs total grip and downforce buys less than 1:1. Clamped to 0.6…1.25; an
 * unloaded tyre (N → 0) saturates at the top of the band instead of blowing up.
 */
export function loadSensitivityScale(loadN: number, staticLoadN: number, sensitivity: number): number {
  if (staticLoadN <= 0 || sensitivity === 0) return 1;
  return clamp(Math.pow(Math.max(loadN, 0.1 * staticLoadN) / staticLoadN, -sensitivity), LOAD_SCALE_MIN, LOAD_SCALE_MAX);
}

/**
 * Friction ellipse: the tyre's demand from longitudinal slip (m/s, or a brake demand ratio × longRef)
 * and lateral patch speed (m/s), each against the speed where it alone saturates the tyre; past a
 * combined demand of 1 the grip left for everything scales by 1 / demand.
 */
export function frictionEllipseScale(longSlipMs: number, latSlipMs: number, longRefMs: number, latRefMs: number): number {
  const demand = Math.hypot(longSlipMs / longRefMs, latSlipMs / latRefMs);
  return 1 / Math.max(1, demand);
}

/** Share of a driven tyre's longitudinal budget left under lateral slip (k_lat of it goes at latRef). */
export function lateralBudgetScale(latSlipMs: number, latRefMs: number, kLat: number): number {
  return 1 - kLat * Math.min(1, latSlipMs / latRefMs);
}

export interface SteerAngles {
  left: number;
  right: number;
}

/**
 * Ackermann steering: for a bicycle-model angle `steer` (rad, + = left) the inner wheel turns more
 * and the outer less so both front wheels roll about the same centre: tan(inner) = L / (R − t/2),
 * tan(outer) = L / (R + t/2) with R = L / tan(steer). `share` blends from parallel (0) to full (1).
 * Writes `out` (no allocation). Steering left, the left wheel is the inner one.
 */
export function ackermannAngles(steer: number, wheelbase: number, halfTrack: number, share: number, out: SteerAngles): SteerAngles {
  const d = Math.abs(steer);
  if (share <= 0 || d < 1e-4) {
    out.left = steer;
    out.right = steer;
    return out;
  }
  const radius = wheelbase / Math.tan(d);
  const inner = Math.atan(wheelbase / Math.max(1e-3, radius - halfTrack));
  const outer = Math.atan(wheelbase / (radius + halfTrack));
  const sign = steer > 0 ? 1 : -1;
  const innerAngle = sign * (d + (inner - d) * share);
  const outerAngle = sign * (d + (outer - d) * share);
  out.left = sign > 0 ? innerAngle : outerAngle;
  out.right = sign > 0 ? outerAngle : innerAngle;
  return out;
}

/** ABS: the largest brake impulse (N·s) a tyre of friction μ under load N can take in one step. */
export function absBrakeCap(friction: number, loadN: number, dt: number, slipFactor: number): number {
  return slipFactor * friction * Math.max(0, loadN) * dt;
}

/**
 * Rear differential lock: torque (N·m) moved from the left wheel to the right one, positive when the
 * left wheel runs faster (dOmegaSpeed = (ω_L − ω_R)·r in m/s), saturating at diffLock × half the axle
 * torque once the speed difference reaches slipRef.
 */
export function diffLockTransfer(diffLock: number, axleTorque: number, dOmegaSpeedMs: number, slipRefMs: number): number {
  return diffLock * 0.5 * Math.abs(axleTorque) * clamp(dOmegaSpeedMs / slipRefMs, -1, 1);
}

/** Live brake bias: the static front share blended toward the axle-load split (clamped 0.4…0.8). */
export function brakeFrontShare(staticShare: number, frontLoadN: number, rearLoadN: number, liveBlend: number): number {
  const total = frontLoadN + rearLoadN;
  const live = total > 1 ? clamp(frontLoadN / total, 0.4, 0.8) : staticShare;
  return staticShare + (live - staticShare) * liveBlend;
}
