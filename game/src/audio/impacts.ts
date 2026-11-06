/**
 * Hard landings and hits from `carRuntime`, sampled once per audio frame (allocation-free).
 *
 *   - Landing: the car was fully airborne for ≥ MIN_AIR_S at the previous frame and has a wheel down
 *     now. Intensity comes from the approach speed INTO the surface (velocity before touchdown ·
 *     mean contact normal), so a long jump onto a matching downslope is a soft landing and a flat
 *     drop is a slam.
 *   - Hit: a sudden change of horizontal velocity beyond what tyres can do (walls, pendulums,
 *     shutters, debris). A grip + downforce acceleration budget is subtracted per simulated second,
 *     so braking and cornering never count. Vertical changes are left to landings.
 *
 * Frames with no new physics steps (paused) are ignored, and a large jump in step count
 * (scripted `advance`, a stalled tab) or a teleport re-arms the detector instead of reading the
 * gap as an impact.
 */
import { PHYSICS_DT } from '../config';
import type { CarRuntime } from '../car/runtime';

export const IMPACT_NONE = 0;
export const IMPACT_LAND = 1;
export const IMPACT_HIT = 2;

const MIN_AIR_S = 0.12;
/** Approach speed into the ground, m/s: the first audible thud, and the range to full intensity. */
const LAND_MIN = 2.6;
const LAND_RANGE = 10;
/** Horizontal Δv beyond tyre acceleration, m/s, for a hit; and the range to full intensity. */
const HIT_MIN = 2.2;
const HIT_RANGE = 8;
/**
 * Tyre acceleration budget, m/s², times the frame's simulated time: what grip alone can do (≈ 1.8 g,
 * the grippiest class sliding) plus what downforce adds at speed (up to +2 g by AERO_SPEED). At phone
 * frame rates (1–2 steps per frame) that is well under 1 m/s, so any real knock shows; on very slow
 * frames hits get harder to see, but hard braking or cornering never reads as one.
 */
const GRIP_ACCEL = 18;
const AERO_ACCEL = 20;
const AERO_SPEED = 50;
/**
 * More steps than this between two frames = discontinuity (scripted advance, stalled tab). Up to
 * this gap a landing is still read correctly (it compares the last airborne frame with the first
 * grounded one) and the hit threshold scales with the gap; teleports re-arm through game events.
 */
const MAX_STEPS = 60;
const HIT_COOLDOWN_S = 0.25;
const AFTER_LANDING_S = 0.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class ImpactDetector {
  landings = 0;
  hits = 0;
  /** Intensity 0…1 of the impact the latest update returned. */
  intensity = 0;
  /** Approach speed (landing) or excess Δv (hit) of the latest impact, m/s. */
  lastSpeed = 0;
  lastKind = IMPACT_NONE;

  private armed = false;
  private prevStep = 0;
  private pvx = 0;
  private pvy = 0;
  private pvz = 0;
  private prevGrounded = 4;
  private prevAirTime = 0;
  private sinceLanding = 10;
  private sinceHit = 10;

  /** Forget the baseline (teleport, respawn, restart, car change). */
  reset(): void {
    this.armed = false;
  }

  private snapshot(rt: CarRuntime): void {
    this.prevStep = rt.stepCount;
    this.pvx = rt.velocity.x;
    this.pvy = rt.velocity.y;
    this.pvz = rt.velocity.z;
    this.prevGrounded = rt.wheelsGrounded;
    this.prevAirTime = rt.airborneTime;
  }

  update(rt: CarRuntime): number {
    if (!rt.ready) {
      this.armed = false;
      return IMPACT_NONE;
    }
    const steps = rt.stepCount - this.prevStep;
    if (!this.armed || steps < 0 || steps > MAX_STEPS) {
      this.snapshot(rt);
      this.armed = true;
      return IMPACT_NONE;
    }
    if (steps === 0) return IMPACT_NONE;
    const simDt = steps * PHYSICS_DT;
    this.sinceLanding += simDt;
    this.sinceHit += simDt;

    let result = IMPACT_NONE;
    if (this.prevGrounded === 0 && this.prevAirTime >= MIN_AIR_S && rt.wheelsGrounded > 0) {
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let i = 0; i < rt.wheels.length; i++) {
        const w = rt.wheels[i]!;
        if (!w.inContact) continue;
        nx += w.contactNormalWorld.x;
        ny += w.contactNormalWorld.y;
        nz += w.contactNormalWorld.z;
      }
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        nx /= len;
        ny /= len;
        nz /= len;
      } else {
        nx = 0;
        ny = 1;
        nz = 0;
      }
      const approach = -(this.pvx * nx + this.pvy * ny + this.pvz * nz);
      this.sinceLanding = 0;
      if (approach > LAND_MIN) {
        this.intensity = clamp01((approach - LAND_MIN) / LAND_RANGE);
        this.lastSpeed = approach;
        this.lastKind = IMPACT_LAND;
        this.landings += 1;
        result = IMPACT_LAND;
      }
    } else if (this.sinceLanding > AFTER_LANDING_S && this.sinceHit > HIT_COOLDOWN_S) {
      const dvx = rt.velocity.x - this.pvx;
      const dvz = rt.velocity.z - this.pvz;
      const v = Math.hypot(this.pvx, this.pvy, this.pvz) / AERO_SPEED;
      const budget = (GRIP_ACCEL + AERO_ACCEL * Math.min(1, v * v)) * simDt;
      const excess = Math.hypot(dvx, dvz) - budget;
      if (excess > HIT_MIN) {
        this.intensity = clamp01((excess - HIT_MIN) / HIT_RANGE);
        this.lastSpeed = excess;
        this.lastKind = IMPACT_HIT;
        this.hits += 1;
        this.sinceHit = 0;
        result = IMPACT_HIT;
      }
    }
    this.snapshot(rt);
    return result;
  }
}
