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
  traction: 1.6,
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
};
