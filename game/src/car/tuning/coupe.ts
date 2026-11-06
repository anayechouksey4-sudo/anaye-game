/**
 * Ember Swallowtail (coupe): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const COUPE_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.78,
  steerMax: 0.6,
  steerSpeedFalloff: 14,
  steerRate: 3.0,
  steerReturnRate: 5,
  brakeForceG: 1.4,
  airPitchStiffness: 55,
  airPitchDamping: 50,
  airPitchDampingBase: 280,
  airRollDamping: 450,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.18,
  peakSlipRad: 0.16,
  antiRollFrontN_m: 22000,
  antiRollRearN_m: 20000,
  diffLock: 0.2,
};
