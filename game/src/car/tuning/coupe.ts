/**
 * Ember Swallowtail (coupe): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const COUPE_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: longitudinal μ = lateral μ (3rd gear, not a low ratio, decides where the rears spin);
  // the 1.4 g pedal stopped in 26 m from 100 km/h, the 34 m row wants about 1.05 g plus drag.
  longitudinalGripRatio: 1.0,
  steerMax: 0.6,
  steerSpeedFalloff: 14,
  steerRate: 3.0,
  steerReturnRate: 5,
  brakeForceG: 1.05,
  airPitchStiffness: 55,
  airPitchDamping: 50,
  airPitchDampingBase: 280,
  airRollDamping: 450,
  // ── Handling v2 (plan §1 row: 0–100 3.4 s, top speed kept, 1.15 g skidpad, 100–0 in 34 m) ──
  handlingV2: true,
  loadSensitivity: 0.18,
  peakSlipRad: 0.16,
  antiRollFrontN_m: 22000,
  antiRollRearN_m: 20000,
  diffLock: 0.2,
};
