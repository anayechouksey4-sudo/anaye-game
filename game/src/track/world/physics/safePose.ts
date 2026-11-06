/**
 * Free-roam respawn poses (PLAN §3.10): a 16-entry ring of road-centreline poses pushed by
 * WorldRules every 0.5 s while the car is driving cleanly on a road, plus the one pending travel
 * pose (TRAVEL, FREE ROAM, car swap) that the next `respawn('travel')` consumes. Module state,
 * reset when the world unmounts. No allocation on the per-step paths.
 */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Simulated time it was recorded, s (carRuntime.simTime). */
  t: number;
}

export const RING_SIZE = 16;
/** A respawn uses the newest entry at least this old. */
export const MIN_AGE_S = 1.5;

const ring: Pose[] = Array.from({ length: RING_SIZE }, () => ({ x: 0, y: 0, z: 0, yaw: 0, t: 0 }));
let head = 0;
let size = 0;
/** Newest pose ever pushed (kept across ring clears, for car swaps). */
const lastSafe: Pose = { x: 0, y: 0, z: 0, yaw: 0, t: 0 };
let hasLast = false;

let pending: Pose | null = null;

export function pushSafePose(x: number, y: number, z: number, yaw: number, t: number): void {
  const p = ring[head]!;
  p.x = x;
  p.y = y;
  p.z = z;
  p.yaw = yaw;
  p.t = t;
  head = (head + 1) % RING_SIZE;
  if (size < RING_SIZE) size++;
  lastSafe.x = x;
  lastSafe.y = y;
  lastSafe.z = z;
  lastSafe.yaw = yaw;
  lastSafe.t = t;
  hasLast = true;
}

/** Newest entry ≥ MIN_AGE_S old (relative to `now`); drops every newer entry. Null if none. */
export function takeSafePose(now: number): Pose | null {
  while (size > 0) {
    const i = (head - 1 + RING_SIZE) % RING_SIZE;
    const p = ring[i]!;
    if (now - p.t >= MIN_AGE_S) return { ...p };
    head = i;
    size--;
  }
  return null;
}

export function newestSafePose(): Pose | null {
  if (size > 0) return { ...ring[(head - 1 + RING_SIZE) % RING_SIZE]! };
  return hasLast ? { ...lastSafe } : null;
}

export function clearSafePoses(keepLast = true): void {
  head = 0;
  size = 0;
  if (!keepLast) hasLast = false;
}

/** The ring, newest first (window.__WORLD__.safePoses()). */
export function safePoses(): Pose[] {
  const out: Pose[] = [];
  for (let k = 0; k < size; k++) out.push({ ...ring[(head - 1 - k + 2 * RING_SIZE) % RING_SIZE]! });
  return out;
}

export function setPendingTravel(pose: Pose | null): void {
  pending = pose ? { ...pose } : null;
}

export const pendingTravel = (): Pose | null => pending;

export function takePendingTravel(): Pose | null {
  const p = pending;
  pending = null;
  return p;
}

export function resetSafePoses(): void {
  clearSafePoses(false);
  pending = null;
}
