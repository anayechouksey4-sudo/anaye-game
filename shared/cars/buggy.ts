/**
 * Big-wheeled all-wheel-drive desert buggy: long soft suspension, high centre of mass, lands anything,
 * slow. Handling v2 (game tuning `handlingV2` on): the 4 gears of its air-cooled flat-four sound and
 * a low-revving curve — all its torque between 30 % and 50 % of the redline, down to 61 % of it at the
 * top-gear fit point (93 %) and 55 % at the limiter — so the mid-range pulls 1.6× the top-end figure
 * the dashboard shows. Knobbly off-road tyres on asphalt: 0.97 μ (1.3 before v2, 1.14 g on the skidpad
 * against the plan's 0.8 g row); the top-gear shift sits at 94 % of the redline (the gear held at top
 * speed must be top gear, TOP_GEAR_RPM_FRAC 0.93).
 */
import { type CarClass } from './types';

export const BUGGY: Readonly<CarClass> = {
  id: 'buggy',
  name: 'Dune Goblin',
  frontDriveShare: 0.4,
  massBase: 1150,
  massPerTier: 50,
  torqueBase: 800,
  torquePerTier: 420,
  dragBase: 3.6,
  dragPerAero: 1.2,
  frontWingMax: 3,
  traction: 0.97,
  frontBodyLift: 1.2,
  rearDownforce: 1,
  driveWheelRadius: 0.48,
  // The legacy launch boost (1.3 to 70 km/h) is 1st gear now: unused while `engine` is set.
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.02,
  wheelbase: 2.75,
  cgHeight: 0.78,
  frontWeightNeutral: 0.48,
  frontWeightRange: 0.2,
  suspensionStiffnessBase: 26,
  suspensionBalanceSplit: 0.4,
  jumpSpeedScale: 1,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 10,
  engine: {
    gears: 4,
    firstGearFrac: 0.36,
    torqueCurve: [0.6, 0.85, 1.0, 1.0, 1.0, 1.0, 0.96, 0.88, 0.78, 0.64, 0.55],
    shiftUpFrac: 0.94,
    shiftCutS: 0.12,
  },
};
