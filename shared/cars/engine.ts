/**
 * Handling v2 engine math, shared by the game's car controller (which steps a gearbox with it) and
 * the protocol's estimates (which must predict the same forces). Pure functions, no allocation.
 *
 * Gearing: the speed at the redline in gear g (1-based, n gears) is
 *   vRed(g) = vTop · firstGearFrac^((n − g) / (n − 1)),  vTop = topSpeed / TOP_GEAR_RPM_FRAC
 * so top gear reaches the class's estimated top speed at TOP_GEAR_RPM_FRAC of the redline (the same
 * fit the engine sound always used). Wheel torque in gear g at rpm fraction f:
 *   engineTorque · torqueCurve(f) / torqueCurve(TOP_GEAR_RPM_FRAC) · vRed(n) / vRed(g)
 */
import type { EngineModel } from './types';

/** Top speed is reached in top gear at this fraction of the redline. */
export const TOP_GEAR_RPM_FRAC = 0.93;
/** Clutch-slip launch rpm at full throttle, fraction of the redline (1st gear only). */
export const LAUNCH_RPM_FRAC = 0.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** The normalised torque curve at an rpm fraction (linear between samples, held outside 0…1). */
export function torqueCurveAt(curve: readonly number[], rpmFrac: number): number {
  const n = curve.length;
  if (n === 0) return 1;
  if (n === 1) return curve[0]!;
  const x = clamp(rpmFrac, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const t = x - i;
  return curve[i]! + (curve[i + 1]! - curve[i]!) * t;
}

/** Torque multiplier at an rpm fraction, 1 at TOP_GEAR_RPM_FRAC (where the top-speed estimate is exact). */
export function torqueShape(engine: EngineModel, rpmFrac: number): number {
  const ref = torqueCurveAt(engine.torqueCurve, TOP_GEAR_RPM_FRAC);
  return ref > 1e-6 ? torqueCurveAt(engine.torqueCurve, rpmFrac) / ref : 1;
}

/** Number of forward gears, clamped to what the model supports. */
export function gearCount(engine: EngineModel): number {
  return clamp(Math.round(engine.gears), 1, 10);
}

/** Speed (m/s) at the redline in forward gear `gear` (1-based) for a top speed in m/s. */
export function redlineSpeedMs(engine: EngineModel, gear: number, topSpeedMs: number): number {
  const n = gearCount(engine);
  const vTop = topSpeedMs / TOP_GEAR_RPM_FRAC;
  const g = clamp(Math.round(gear), 1, n);
  return n === 1 ? vTop : vTop * Math.pow(engine.firstGearFrac, (n - g) / (n - 1));
}

/** Torque multiplication of gear `gear` relative to top gear (= vRed(top) / vRed(gear) ≥ 1). */
export function gearRatioToTop(engine: EngineModel, gear: number): number {
  const n = gearCount(engine);
  if (n === 1) return 1;
  const g = clamp(Math.round(gear), 1, n);
  return Math.pow(engine.firstGearFrac, -(n - g) / (n - 1));
}

/** The gear a full-throttle automatic holds at a road speed: the lowest gear below its upshift point. */
export function gearForSpeed(engine: EngineModel, speedMs: number, topSpeedMs: number): number {
  const n = gearCount(engine);
  const v = Math.abs(speedMs);
  for (let g = 1; g < n; g++) {
    if (v / redlineSpeedMs(engine, g, topSpeedMs) <= engine.shiftUpFrac) return g;
  }
  return n;
}

/** Engine rpm fraction at a road speed in a gear, with the clutch-slip launch floor in 1st. */
export function engineRpmFrac(engine: EngineModel, gear: number, speedMs: number, topSpeedMs: number): number {
  const f = Math.abs(speedMs) / redlineSpeedMs(engine, gear, topSpeedMs);
  return gear <= 1 && f < LAUNCH_RPM_FRAC ? LAUNCH_RPM_FRAC : f;
}

/** Wheel torque (whole car, N·m) in a gear at an rpm fraction. */
export function engineWheelTorqueNm(engine: EngineModel, engineTorqueNm: number, gear: number, rpmFrac: number): number {
  return engineTorqueNm * torqueShape(engine, rpmFrac) * gearRatioToTop(engine, gear);
}

/** Full-throttle drive force at the contact patches (N) at a road speed: the gear a full-throttle automatic holds, its rpm, the curve. */
export function engineDriveForceN(engine: EngineModel, engineTorqueNm: number, wheelRadius: number, speedMs: number, topSpeedMs: number): number {
  const gear = gearForSpeed(engine, speedMs, topSpeedMs);
  const rpmFrac = engineRpmFrac(engine, gear, speedMs, topSpeedMs);
  return engineWheelTorqueNm(engine, engineTorqueNm, gear, rpmFrac) / wheelRadius;
}
