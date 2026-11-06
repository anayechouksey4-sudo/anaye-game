/**
 * Featherweight open-wheeler: wings, low ride, very stable at speed, twitchy everywhere else.
 *
 * Handling v2 re-sized its aero and tyre to the plan's row (1.6 g at 30 m/s, 2.4 g at 60 m/s, 100–0 in
 * 26 m): those two lateral numbers together fix the shape g(v) = μ·(1 + k·v²/W)^(1−loadSensitivity),
 * which solves to k ≈ 2.4 N/(m/s)² of total downforce at 50 % wing and μ ≈ 1.4 for a 670 kg car — the
 * old 8.3 N/(m/s)² (4.1 front + 4.2 rear) on 1.75 μ slicks held 3.4 g at 33 m/s, and no tuning knob
 * (load sensitivity floors at 0.6) can halve that. Front: 4.0 × wing − 1.0 body lift, rear 1.4, i.e.
 * 42 % of the downforce on the front axle against 45 % of the weight (a 4.5 / 1.15 split put the rear
 * on the limit first and the tier-3 arc at 33 m/s became a 16° slide). At the 14 % chaos JUMP preset the
 * front is −0.44 N/(m/s)² net (was +0.14): with 3.3 kN of static front load the estimated lift-off stays
 * far above top speed (the sim clears at 14/5/0 and 14/5/−20). Drag is untouched, so every top speed
 * is the same as before.
 */
import { type CarClass } from './types';

export const FORMULA: Readonly<CarClass> = {
  id: 'formula',
  name: 'Razorwing',
  frontDriveShare: 0,
  massBase: 600,
  massPerTier: 35,
  torqueBase: 420,
  torquePerTier: 420,
  dragBase: 1.75,
  dragPerAero: 2.4,
  frontWingMax: 4.0,
  traction: 1.4,
  frontBodyLift: 1.0,
  rearDownforce: 1.4,
  driveWheelRadius: 0.33,
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.014,
  wheelbase: 3.0,
  cgHeight: 0.3,
  frontWeightNeutral: 0.45,
  frontWeightRange: 0.2,
  suspensionStiffnessBase: 120,
  suspensionBalanceSplit: 0.4,
  jumpSpeedScale: 1.048,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 8,
  /**
   * Handling v2 engine: the 8-speed gearing of its engine sound (close ratios, 0.24 first-gear span),
   * a high-revving curve that peaks at 70–80 % of the redline and is 90 % of that at the top-gear fit
   * point (93 %), 50 ms shift cuts. Fitted so top gear at 93 % is exactly the estimated top speed.
   */
  engine: {
    gears: 8,
    firstGearFrac: 0.24,
    torqueCurve: [0.35, 0.5, 0.64, 0.76, 0.86, 0.94, 0.99, 1.0, 0.98, 0.93, 0.85],
    shiftUpFrac: 0.97,
    shiftCutS: 0.05,
  },
};
