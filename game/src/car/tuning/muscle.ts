/**
 * Bruiser V8 (muscle): handling overrides on top of tuning/base.ts. Only this class reads them, so it
 * can be tuned without touching any other car.
 */
import type { CarTuning } from '../tuning';

export const MUSCLE_TUNING: Partial<CarTuning> = {
  aeroNormalToFlow: 1,
  // Handling v2: drag-style rears, more forward bite than side bite (0.95 before v2).
  longitudinalGripRatio: 1.1,
  spinGripLoss: 0.6,
  steerMax: 0.52,
  steerSpeedFalloff: 12,
  steerRate: 2.3,
  steerReturnRate: 4,
  // 1.05 g of pedal stopped it in 33 m from 100 km/h; the plan's 40 m wants about 0.88 g plus drag.
  brakeForceG: 0.88,
  burnoutRearGrip: 0.3,
  handbrakeForceN: 11000,
  airPitchStiffness: 80,
  airPitchDamping: 70,
  airPitchDampingBase: 400,
  airRollDamping: 650,
  // ── Handling v2 (plan §1 row: 0–100 4.2 s at tier 5, 0.95 g skidpad, 100–0 in 40 m) ──
  handlingV2: true,
  // Heavy nose: the loaded outer front gives up first (0.22), the stiff front bar adds to it on entry,
  // the half-locked diff hands the exit to the rears (power oversteer).
  loadSensitivity: 0.22,
  // Tall soft sidewalls: the peak is a wide slip angle. At 0.15 the slip-aware steer cap held the lock
  // short in 50–80 km/h bends (front slip ≈ 0.12 rad in a steady 1 g arc at 80) and the autopilot
  // pushed it off the ribbon eleven times a lap; at 0.19 it finishes clean.
  peakSlipRad: 0.19,
  antiRollFrontN_m: 22000,
  antiRollRearN_m: 14000,
  diffLock: 0.5,
};
