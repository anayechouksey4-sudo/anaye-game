/**
 * Per-wheel tyre-grip seam (1 = tarmac). Only an open world installs a resolver; without one the
 * car controller multiplies by exactly 1 (x * 1 === x in IEEE-754), so every other map is
 * bit-identical. The resolver must be O(1): index a buffer filled after the previous step.
 */
export type WheelGripResolver = (wheelIndex: number) => number;

let resolver: WheelGripResolver | null = null;

export function setWheelGripResolver(fn: WheelGripResolver): () => void {
  resolver = fn;
  return () => {
    if (resolver === fn) resolver = null;
  };
}

export const wheelGrip = (wheelIndex: number): number => (resolver ? resolver(wheelIndex) : 1);
