/**
 * Ion Dragonfly (electric): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const ELECTRIC_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.85,
  steerMax: 0.54,
  steerSpeedFalloff: 13,
  steerRate: 2.6,
  brakeForceG: 1.3,
  airPitchStiffness: 90,
  airPitchDamping: 80,
  airPitchDampingBase: 450,
  airRollDamping: 700,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.18,
  peakSlipRad: 0.15,
  antiRollFrontN_m: 30000,
  antiRollRearN_m: 26000,
  diffLock: 0.2,
};
