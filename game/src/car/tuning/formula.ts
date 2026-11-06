/**
 * Razorwing (formula): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const FORMULA_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: a slick's longitudinal peak sits well above its lateral one here (1.4 μ × 1.5 = 2.1 off
  // the line; with the small rear wing the launch is grip-limited to 100 km/h, and 2.4 s needs 1.2 g of
  // it; the close 8-speed box decides where the rears spin); the 2.0 g pedal stopped in 18 m from
  // 100 km/h, the 26 m row wants about 1.35 g of pedal plus drag.
  longitudinalGripRatio: 1.5,
  sideStiffnessBase: 0.5,
  steerMax: 0.5,
  steerSpeedFalloff: 10,
  steerMin: 0.06,
  steerRate: 3.8,
  steerReturnRate: 7,
  brakeForceG: 1.35,
  airPitchStiffness: 32,
  airPitchDamping: 30,
  airPitchDampingBase: 150,
  airRollDamping: 250,
  // ── Handling v2 (plan §1 row: 0–100 2.4 s, top speed kept, 1.6 g at 30 m/s, 100–0 in 26 m) ──
  handlingV2: true,
  loadSensitivity: 0.18,
  peakSlipRad: 0.12,
  // The plan's 60000 / 45000 bars read 2.2 g at 33 m/s on the bench against a tyre budget of 1.96
  // (μ 1.4 × 1.4 of load): the bar's per-step vertical impulses pump the suspension forces the friction
  // cap reads. With the base bars the same car reads 1.62 g, which is the row. Still the stiffest car
  // by spring rate (120 vs 50); the bars are the hypercar's.
  antiRollFrontN_m: 24000,
  antiRollRearN_m: 18000,
  diffLock: 0.2,
};
