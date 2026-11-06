/**
 * Dune Goblin (buggy): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const BUGGY_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: the knobblies bite forward as well as they do sideways (0.8 before v2).
  longitudinalGripRatio: 1.0,
  sideStiffnessBase: 0.3,
  sideStiffnessPerTraction: 0.35,
  steerMax: 0.6,
  steerSpeedFalloff: 14,
  steerRate: 2.8,
  // 1.0 g of pedal stopped it in 34 m from 99 km/h; the plan's 44 m wants about 0.78 g plus drag.
  brakeForceG: 0.78,
  dampingCompressionRatio: 0.45,
  dampingRelaxationRatio: 0.6,
  airPitchStiffness: 140,
  airPitchDamping: 90,
  airPitchDampingBase: 520,
  airRollDamping: 900,
  // ── Handling v2 (plan §1 row: 0–100 5.0 s at tier 5, 0.8 g skidpad, 100–0 in 44 m) ──
  handlingV2: true,
  // Soft and rolling: the softest bars of the set, big peak slip angles (0.2) and tyres that give up
  // early under load (0.22).
  loadSensitivity: 0.22,
  peakSlipRad: 0.2,
  antiRollFrontN_m: 6000,
  antiRollRearN_m: 5000,
  diffLock: 0.2,
};
