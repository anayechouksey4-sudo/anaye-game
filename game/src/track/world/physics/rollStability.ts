/**
 * Island-only roll-damping stability floor (installed by WorldRules through the car's chassis
 * inertia seam, car/surfaceGrip.ts).
 *
 * Rapier's raycast suspension applies its damper explicitly: each wheel pushes c·m·v, where c is the
 * damping ratio × √stiffness and m the chassis mass. Rolling at ω moves each wheel at ω·track/2, so
 * one 1/60 s step changes the roll rate by dt·m·(c_f·t_f² + c_r·t_r²)/2 / I_roll · ω. Above 1 the
 * correction overshoots (the roll rate flips sign every step); above 2 it grows. The formula's narrow
 * inertia box sits at 2.3–2.4, so a crest or a terrain crease starts a 30 Hz side-to-side chatter that
 * unloads one side every other step and halves its traction (it stalled on the Crown Climb). Every
 * other car is ≤ 0.75 except the kart (≈ 1.6, decaying).
 *
 * Off the island no resolver is installed and nothing changes. On the island the roll inertia (about
 * the chassis Z axis only: pitch and yaw stay as specified) is raised just enough to bring that number
 * down to ROLL_STABILITY_MAX. Today only the formula is affected.
 */
import { PHYSICS_DT } from '../../../config';
import type { Tuple3, VehicleSpec } from '../../../car/vehicleSpec';

/** Target for dt·m·(c_f·t_f² + c_r·t_r²)/2 / I_roll (explicit-damping limit 2; overshoot above 1). */
export const ROLL_STABILITY_MAX = 1.6;

/** The roll-damping stability number of a car at a mass / suspension setting. */
export function rollStabilityNumber(spec: VehicleSpec, mass: number, stiffness: { front: number; rear: number }, rollInertia: number): number {
  const ratio = Math.max(spec.tuning.dampingCompressionRatio, spec.tuning.dampingRelaxationRatio);
  let front = 0;
  let rear = 0;
  for (const w of spec.wheels) {
    const t = Math.abs(w.connection[0]);
    if (w.axle === 'front') front = Math.max(front, t);
    else rear = Math.max(rear, t);
  }
  const cf = ratio * Math.sqrt(stiffness.front);
  const cr = ratio * Math.sqrt(stiffness.rear);
  const tf = 2 * front;
  const tr = 2 * rear;
  return (PHYSICS_DT * mass * (cf * tf * tf + cr * tr * tr)) / 2 / rollInertia;
}

/** The chassis-inertia resolver the island installs: raises I_roll (Z) only where the number exceeds the target. */
export function stableRollInertia(spec: VehicleSpec, mass: number, stiffness: { front: number; rear: number }, inertia: Tuple3): Tuple3 {
  const n = rollStabilityNumber(spec, mass, stiffness, inertia[2]);
  if (!(n > ROLL_STABILITY_MAX)) return inertia;
  return [inertia[0], inertia[1], (inertia[2] * n) / ROLL_STABILITY_MAX];
}
