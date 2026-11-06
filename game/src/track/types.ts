/**
 * Track contract. A track component builds its colliders/visuals and registers ONE
 * `TrackLayout` via `useGameStore.getState().setTrackLayout(layout)`; the run controller,
 * car spawn, HUD and telemetry only ever look at the layout.
 *
 * Conventions (world space, metres):
 *   - +Y is up. `yaw` is a rotation about +Y; yaw 0 faces +Z, direction = (sin yaw, 0, cos yaw).
 *   - Positions of spawn / checkpoints / finish are points ON the driving surface (ground
 *     level, centre of the lane). The car is placed at that point + its ride height.
 *   - Trigger volumes (`size`) are boxes centred `size[1] / 2` above `position`, rotated by
 *     `yaw`: size = [width across the track, height, depth along the direction of travel].
 */

export type Vec3 = [number, number, number];

export interface TrackCheckpoint {
  /** Equals its index in `TrackLayout.checkpoints`. 0 is the spawn. */
  index: number;
  position: Vec3;
  yaw: number;
  size: Vec3;
}

export interface TrackFinish {
  position: Vec3;
  yaw: number;
  size: Vec3;
}

export interface TrackBigJump {
  /** Point on the lip edge of the ramp (ground level at the very top of the ramp). */
  lipPosition: Vec3;
  /** Direction of travel over the lip. */
  yaw: number;
  /** Speed the car must carry off the lip to clear the gap, km/h. */
  requiredKmh: number;
  /** Half-width of the speed-trap gate across the track, m (default 15). */
  halfWidth?: number;
}

export interface TrackLayout {
  /** Stable id: used for best-time storage and as the React key of the car. */
  id: string;
  name: string;
  spawn: { position: Vec3; yaw: number };
  /** checkpoints[0] is the spawn; respawns go to the highest index reached. */
  checkpoints: TrackCheckpoint[];
  finish: TrackFinish;
  /** Car body origin below this Y counts as a fall into the void. */
  killY: number;
  bigJump?: TrackBigJump;
  /** Total driving length in metres (HUD progress only). */
  lengthM?: number;
  /**
   * Tyre-grip multiplier of the driving surface (1 = normal tarmac, < 1 = slippery, e.g. ice).
   * The car controller multiplies its tyre friction by this; omitted = 1.
   */
  surfaceGrip?: number;
  /** Sky, fog and lights for this map (scene/Environment.tsx); omitted = the default neon night. */
  atmosphere?: TrackAtmosphere;
  /**
   * 'roam' = free drive (open worlds): no start lights, timer, checkpoints, finish or results; the
   * kill plane and flip recovery still apply. Omitted = 'race' (every existing map).
   */
  mode?: 'race' | 'roam';
  /**
   * Checkpoints count only in order (the next one), and the finish only after the last one: courses
   * that cross themselves or finish where they start. Omitted = any later checkpoint counts.
   */
  strictOrder?: boolean;
}

/**
 * Per-map sky / fog / light colours (CSS colours). Read by scene/Environment.tsx from the
 * registered layout, so they switch together with the map.
 */
export interface TrackAtmosphere {
  /** Clear colour (the sky / void). */
  background: string;
  /** Linear fog: colour, start and end distance, m. */
  fog: [color: string, near: number, far: number];
  /** Hemisphere light: sky colour, ground colour, intensity. */
  hemisphere: [sky: string, ground: string, intensity: number];
  ambient: number;
  /** The shadow-casting sun that follows the car. */
  sun: { color: string; intensity: number };
  /** Star field: 1 = shown, 0 = hidden (day skies). */
  stars: number;
  /** The faint grid far below the track: [main line colour, sub line colour], or null for none. */
  voidGrid: [string, string] | null;
}

/** Number shown as "x / total" in the HUD: intermediate checkpoints plus the finish line. */
export function totalCheckpointsOf(layout: TrackLayout | null): number {
  if (!layout) return 0;
  return Math.max(0, layout.checkpoints.length - 1) + 1;
}

export function yawToDirection(yaw: number): Vec3 {
  return [Math.sin(yaw), 0, Math.cos(yaw)];
}

/**
 * Is a world point inside an oriented trigger volume? Shared by checkpoints, the finish
 * line and any track-specific gates so they all agree on the convention above.
 */
export function isInsideGate(point: { x: number; y: number; z: number }, gate: { position: Vec3; yaw: number; size: Vec3 }): boolean {
  const dx = point.x - gate.position[0];
  const dy = point.y - gate.position[1];
  const dz = point.z - gate.position[2];
  const c = Math.cos(gate.yaw);
  const s = Math.sin(gate.yaw);
  // Local frame: z' along travel (sin, cos), x' across ( cos, -sin).
  const along = dx * s + dz * c;
  const across = dx * c - dz * s;
  return (
    Math.abs(across) <= gate.size[0] / 2 &&
    dy >= -1 &&
    dy <= gate.size[1] &&
    Math.abs(along) <= gate.size[2] / 2
  );
}
