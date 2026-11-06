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
  noseLiftReserveKmh: 12,
};
