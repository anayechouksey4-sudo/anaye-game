/**
 * The original wedge-nosed hypercar. Its physics are calibrated against the chaos track's big jump —
 * do not retune them. Its nose-lift rule (12 km/h reserve) was measured on the chaos jump: every
 * setting whose lift-off was less than 10.4 km/h above top speed lifted its nose and ran off.
 */
import { type CarClass, DRIVE_WHEEL_RADIUS, FRONT_BODY_LIFT, REAR_DOWNFORCE, SUSPENSION_STIFFNESS_BASE, SUSPENSION_BALANCE_SPLIT, FRONT_WING_DOWNFORCE_MAX, CG_HEIGHT, WHEELBASE, ROLLING_RESISTANCE, BASE_TRACTION } from './types';

export const HYPERCAR: Readonly<CarClass> = {
  id: 'hypercar',
  name: 'Neon Hypercar',
  frontDriveShare: 0,
  massBase: 1050,
  massPerTier: 60,
  torqueBase: 700,
  torquePerTier: 700,
  dragBase: 2.98,
  dragPerAero: 1.8,
  frontWingMax: FRONT_WING_DOWNFORCE_MAX,
  traction: BASE_TRACTION,
  frontBodyLift: FRONT_BODY_LIFT,
  rearDownforce: REAR_DOWNFORCE,
  driveWheelRadius: DRIVE_WHEEL_RADIUS,
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: ROLLING_RESISTANCE,
  wheelbase: WHEELBASE,
  cgHeight: CG_HEIGHT,
  frontWeightNeutral: 0.5,
  frontWeightRange: 0.2,
  suspensionStiffnessBase: SUSPENSION_STIFFNESS_BASE,
  suspensionBalanceSplit: SUSPENSION_BALANCE_SPLIT,
  jumpSpeedScale: 1,
  noseLiftMarginKmh: 1000,
  // Handling v2 (chaos jump, tier 5, sim): 15 % wing / balance −20 lifted the nose at 190.7 km/h with an
  // estimated lift-off 14.3 km/h above top speed, 17 % / −20 cleared (23.8 above), 27/4/50 lifted at 166
  // (13.4 above): the stronger mid-range of the geared engine unloads the nose a little earlier than the
  // flat-torque car did (reserve 12 then).
  noseLiftReserveKmh: 15,
  /**
   * Handling v2 engine (game tuning `handlingV2` on): the 7-speed gearing of its engine sound and a
   * boosted curve — a torque plateau from 30 % to 70 % of the redline that falls to 80 % of it by the
   * top-gear fit point (93 %) and 74 % at the limiter — fitted so top gear at 93 % of the redline is
   * exactly the estimated top speed (the legacy flat-torque number). The dashboard's engineTorque is
   * that top-end figure; the mid-range therefore pulls ~25 % harder, which is what gets a 1.2 t car
   * to 100 km/h in about three seconds at tier 3 while its top speed stays put. 50 ms shift cuts.
   */
  engine: {
    gears: 7,
    firstGearFrac: 0.27,
    torqueCurve: [0.45, 0.72, 0.92, 1.0, 1.0, 1.0, 1.0, 0.97, 0.9, 0.82, 0.74],
    shiftUpFrac: 0.96,
    shiftCutS: 0.05,
  },
};
