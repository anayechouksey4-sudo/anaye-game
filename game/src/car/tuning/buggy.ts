/**
 * Dune Goblin (buggy): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const BUGGY_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  longitudinalGripRatio: 0.8,
  sideStiffnessBase: 0.3,
  sideStiffnessPerTraction: 0.35,
  steerMax: 0.6,
  steerSpeedFalloff: 14,
  steerRate: 2.8,
  brakeForceG: 1.0,
  dampingCompressionRatio: 0.45,
  dampingRelaxationRatio: 0.6,
  airPitchStiffness: 140,
  airPitchDamping: 90,
  airPitchDampingBase: 520,
  airRollDamping: 900,
  // ── Handling v2 (plan §2 starting points; inert until handlingV2 is switched on for this class) ──
  loadSensitivity: 0.22,
  peakSlipRad: 0.2,
  antiRollFrontN_m: 6000,
  antiRollRearN_m: 5000,
  diffLock: 0.2,
};
