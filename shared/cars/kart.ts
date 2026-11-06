/**
 * Tiny single-speed kart: 430 kg, stiff springs (no suspension to speak of), sticky, darts anywhere
 * and tops out around 175 km/h at tier 5 — it can make the Isles leap and never the chaos jump
 * (the garage shows JUMP OUT OF REACH there, like the buggy).
 */
import { type CarClass } from './types';

export const KART: Readonly<CarClass> = {
  id: 'kart',
  name: 'Pixel Gnat',
  frontDriveShare: 0,
  massBase: 430,
  massPerTier: 15,
  torqueBase: 260,
  torquePerTier: 250,
  dragBase: 2.0,
  dragPerAero: 1.0,
  frontWingMax: 2.5,
  // Handling v2: 1.6 held 1.59 g at 33 m/s on the bench; the plan's 1.4 g row.
  traction: 1.42,
  frontBodyLift: 0.6,
  rearDownforce: 0.6,
  driveWheelRadius: 0.26,
  launchBoost: 1,
  launchFadeKmh: 0,
  rollingResistance: 0.018,
  wheelbase: 1.5,
  cgHeight: 0.3,
  frontWeightNeutral: 0.42,
  frontWeightRange: 0.15,
  suspensionStiffnessBase: 90,
  suspensionBalanceSplit: 0.3,
  // Isles leap, tier 5 (sim): 18 % wing (estimated top 168.2) fell at 162.5 at the lip, 12 % cleared at
  // 166.2 (a light car slows more in the air) → 1.04. Chaos stays out of reach (max 175.6 vs 190.3).
  jumpSpeedScale: 1.04,
  noseLiftMarginKmh: 1000,
  noseLiftReserveKmh: 8,
  /**
   * Handling v2 engine: single speed (a centrifugal clutch is the 1st-gear launch floor of the model),
   * a two-stroke's peaky curve that climbs to its best at 75–85 % of the redline and holds 98 % of it at
   * the top-speed fit point (93 %). No shifts, no cuts.
   */
  engine: {
    gears: 1,
    firstGearFrac: 1,
    torqueCurve: [0.6, 0.65, 0.7, 0.78, 0.86, 0.93, 0.98, 1.02, 1.03, 1.0, 0.94],
    shiftUpFrac: 1,
    shiftCutS: 0,
  },
};
