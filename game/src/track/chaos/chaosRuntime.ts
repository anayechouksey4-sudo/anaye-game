/**
 * Live hazard state published by the mounted hazard components for `window.__CHAOS__` and
 * tests. Hazards register on mount and unregister on unmount; nothing here drives gameplay.
 */

export type TileState = 'solid' | 'armed' | 'falling' | 'gone';

export interface TileProbe {
  segment: string;
  index: number;
  state: TileState;
  /** Physics step at which a wheel / the chassis first touched it (since this tile's last reset). */
  touchedStep: number | null;
  droppedStep: number | null;
  y: number;
}

export interface CollapseRecord {
  segment: string;
  tile: number;
  touchedStep: number;
  droppedStep: number;
  /** (dropped − touched) steps × PHYSICS_DT, s. */
  delayS: number;
  /** What touched it first. */
  by: 'wheel' | 'chassis';
}

export interface PendulumProbe {
  id: string;
  /** Measured swing angle about the hinge (track) axis, deg; + swings toward +X. */
  angleDeg: number;
  /** Motor target angle for the same instant, deg. */
  targetDeg: number;
  angularVelocity: number;
  bob: { x: number; y: number; z: number };
  bobVelocity: { x: number; y: number; z: number };
}

export interface ShutterProbe {
  id: string;
  /** 0 = fully open, 1 = closed. */
  closure: number;
  gap: number;
}

interface Source<T> {
  probe(): T[];
}

export const chaosRuntime = {
  tileSources: new Set<Source<TileProbe>>(),
  pendulumSources: new Set<Source<PendulumProbe>>(),
  shutterSources: new Set<Source<ShutterProbe>>(),
  /** Every tile collapse since load (bounded). */
  collapses: [] as CollapseRecord[],
};

const MAX_COLLAPSE_LOG = 400;

export function recordCollapse(record: CollapseRecord): void {
  chaosRuntime.collapses.push(record);
  if (chaosRuntime.collapses.length > MAX_COLLAPSE_LOG) chaosRuntime.collapses.splice(0, chaosRuntime.collapses.length - MAX_COLLAPSE_LOG);
}

export function register<T>(set: Set<Source<T>>, source: Source<T>): () => void {
  set.add(source);
  return () => {
    set.delete(source);
  };
}

export function collect<T>(set: Set<Source<T>>): T[] {
  const out: T[] = [];
  for (const s of set) out.push(...s.probe());
  return out;
}
