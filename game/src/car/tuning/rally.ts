/**
 * Glitch Rally (rally): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const RALLY_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: nearly all of the (lower) 1.14 μ tyre is forward budget on all four wheels (0.82 before v2).
  longitudinalGripRatio: 0.97,
  sideStiffnessBase: 0.45,
  steerMax: 0.62,
  steerSpeedFalloff: 17,
  steerRate: 3.6,
  steerReturnRate: 5.5,
  // 1.35 g of pedal stopped it in 26 m from 100 km/h; the plan's 36 m wants about 0.95 g plus drag.
  brakeForceG: 0.95,
  handbrakeForceN: 7000,
  handbrakeRearFriction: 0.3,
  handbrakeRearSideStiffness: 0.45,
  airPitchStiffness: 45,
  airPitchDamping: 45,
  airPitchDampingBase: 240,
  airRollDamping: 380,
  // ── Handling v2 (plan §1 row: 0–100 3.6 s at tier 5, 1.05 g skidpad on asphalt, 100–0 in 36 m) ──
  handlingV2: true,
  // Forgiving: a wide peak slip angle (0.17), bars nearly balanced, an open-ish rear diff (0.2) and the
  // torque-sensing centre split keep all four wheels working — the four-wheel drift on dirt comes from
  // the island's surface grip, not from the tyre model.
  loadSensitivity: 0.18,
  peakSlipRad: 0.17,
  antiRollFrontN_m: 20000,
  antiRollRearN_m: 16000,
  diffLock: 0.2,
};
