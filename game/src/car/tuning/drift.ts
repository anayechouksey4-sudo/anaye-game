/**
 * Smoke Lantern (drift): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const DRIFT_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: forward μ ≈ side μ (0.8 before v2); the gears, not a low ratio, decide when the rears spin.
  longitudinalGripRatio: 1.1,
  // Spinning rears shed most of their side grip: power oversteer is the drift car's character.
  spinGripLoss: 0.7,
  steerMax: 0.78,
  steerSpeedFalloff: 16,
  steerRate: 3.4,
  steerReturnRate: 6,
  // 1.2 g of pedal stopped it in 30 m from 100 km/h; the plan's 37 m wants about 0.95 g plus drag.
  brakeForceG: 0.95,
  handbrakeRearFriction: 0.3,
  handbrakeRearSideStiffness: 0.35,
  // ── Handling v2 (plan §1 row: 0–100 4.0 s at tier 5, 1.0 g skidpad, 100–0 in 37 m) ──
  handlingV2: true,
  // Easy to hold a slide: the widest peak slip angle (0.2: the steer keeps adding lock deep into the
  // slide), an 0.8 LSD so both rears spin together, bars soft at the rear.
  loadSensitivity: 0.18,
  peakSlipRad: 0.2,
  antiRollFrontN_m: 18000,
  antiRollRearN_m: 12000,
  diffLock: 0.8,
};
