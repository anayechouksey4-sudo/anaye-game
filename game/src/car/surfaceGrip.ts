/**
 * Per-wheel tyre-grip seam (1 = tarmac). Only an open world installs a resolver; without one the
 * car controller multiplies by exactly 1 (x * 1 === x in IEEE-754), so every other map is
 * bit-identical. The resolver must be O(1): index a buffer filled after the previous step.
 */
import type { Tuple3, VehicleSpec } from './vehicleSpec';

export type WheelGripResolver = (wheelIndex: number) => number;

let resolver: WheelGripResolver | null = null;

export function setWheelGripResolver(fn: WheelGripResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = null;
  };
}

export const wheelGrip = (wheelIndex: number): number => (resolver ? resolver(wheelIndex) : 1);

/**
 * Chassis inertia seam. Only an open world installs a resolver; without one the controller uses
 * chassisInertiaFor() unchanged (the same array), so every other map is bit-identical. The island
 * uses it to keep the explicit roll damping of the raycast suspension stable on its terrain (the
 * formula's narrow inertia box puts dt·c·m·track²/I_roll above 2, a 30 Hz side-to-side chatter
 * once a crest or a terrain crease excites it). Consulted whenever the controller re-applies mass.
 */
export type ChassisInertiaResolver = (
  spec: VehicleSpec,
  mass: number,
  stiffness: { front: number; rear: number },
  inertia: Tuple3,
) => Tuple3;

let inertiaResolver: ChassisInertiaResolver | null = null;

export function setChassisInertiaResolver(fn: ChassisInertiaResolver): () => void {
  inertiaResolver = fn;
  return () => {
    if (inertiaResolver === fn) inertiaResolver = null;
  };
}

export const chassisInertia = (spec: VehicleSpec, mass: number, stiffness: { front: number; rear: number }, inertia: Tuple3): Tuple3 =>
  inertiaResolver ? inertiaResolver(spec, mass, stiffness, inertia) : inertia;
