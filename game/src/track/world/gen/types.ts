/**
 * Tessera Isle data contract. Everything here is plain data (typed arrays + JSON-able objects) so
 * the generator can run in a Worker and transfer its result. PURE module: no three / react /
 * rapier / DOM imports, no aliases.
 *
 * Frame (same as track/types.ts): metres, +Y up, yaw 0 faces +Z (direction (sin yaw, 0, cos yaw)).
 * Map north is -Z, east is +X. The world covers x, z in [-1024, 1024]; heightfield vertex (ix, iz)
 * sits at (-1024 + 4 ix, h, -1024 + 4 iz) with ix, iz in [0, 512].
 */

export type Vec3 = [number, number, number];

/** Vertices per heightfield side. */
export const WORLD_N = 513;
/** Cells per heightfield side. */
export const WORLD_CELLS = 512;
/** Heightfield spacing, m. */
export const CELL = 4;
export const WORLD_HALF = 1024;
export const WORLD_SIZE = 2048;
/** Districts per side (256 m each, same grid as the terrain chunks). */
export const DISTRICTS = 8;
export const DISTRICT_SIZE = 256;
/** Glassmere water level, m (the sea is y = 0). */
export const LAKE_LEVEL = 18;

// ── Surfaces ────────────────────────────────────────────────────────────────────────────────

/** Index = surface id stored in WorldData.surface and the road field. */
export const SURFACE_KINDS = ['asphalt', 'cobble', 'dirt', 'grass', 'sand', 'salt', 'rock', 'snow', 'water'] as const;
export type SurfaceName = (typeof SURFACE_KINDS)[number];
export const SURF = {
  asphalt: 0,
  cobble: 1,
  dirt: 2,
  grass: 3,
  sand: 4,
  salt: 5,
  rock: 6,
  snow: 7,
  water: 8,
} as const satisfies Record<SurfaceName, number>;

// ── Regions ─────────────────────────────────────────────────────────────────────────────────

/** Index = region id stored in WorldData.region (16 m cells). */
export const REGION_IDS = ['sea', 'prism-city', 'kite-bay', 'cinnabar-reach', 'shell-cove', 'patchwork-downs', 'lantern-bay', 'the-crown'] as const;
export type RegionId = (typeof REGION_IDS)[number];
export const REGION_LABELS: Readonly<Record<RegionId, { name: string; tag: string }>> = {
  sea: { name: 'Open Sea', tag: 'SEA' },
  'prism-city': { name: 'Prism City', tag: 'NEON CITY' },
  'kite-bay': { name: 'Kite Bay', tag: 'COAST' },
  'cinnabar-reach': { name: 'Cinnabar Reach', tag: 'FRONTIER' },
  'shell-cove': { name: 'Shell Cove', tag: 'COAST' },
  'patchwork-downs': { name: 'Patchwork Downs', tag: 'VOXEL VILLAGE' },
  'lantern-bay': { name: 'Lantern Bay', tag: 'COAST' },
  'the-crown': { name: 'The Crown', tag: 'MOUNTAIN' },
};

// ── Road field (fieldTex) encoding ──────────────────────────────────────────────────────────

/**
 * fieldTex (RGBA8, 513², per vertex, sample with LINEAR filtering):
 *   R = distance to the nearest road centreline in 0.25 m steps (0..63.75 m; 255 = none near)
 *   G = 128 + 127 sin(2π station / 16 m), B = 128 + 127 cos(2π station / 16 m)
 *   A = kind (bits 0-2) | width class (bits 3-5) | FIELD_KERB (bit 6) | FIELD_NEON (bit 7)
 */
export const FIELD_KIND = { none: 0, asphalt: 1, dirt: 2, cobble: 3, rail: 4, plank: 5, salt: 6 } as const;
export type FieldKind = keyof typeof FIELD_KIND;
/** Width class index → road width, m. */
export const FIELD_WIDTHS = [0, 6, 8, 10, 12, 14, 16] as const;
export const FIELD_KERB = 64;
export const FIELD_NEON = 128;
export const FIELD_PHASE_M = 16;

// ── Meshes ──────────────────────────────────────────────────────────────────────────────────

/**
 * Merged voxel geometry in the VoxelBuilder attribute layout (position, normal, color, glow; flat
 * faces, CCW from outside). Compact types: normal Int8 normalized, color Uint8 normalized
 * (linear-space RGB, the same values VoxelBuilder would compute), glow Float32 (can exceed 1).
 */
export interface MeshArrays {
  position: Float32Array;
  normal: Int8Array;
  color: Uint8Array;
  glow: Float32Array;
  index: Uint16Array | Uint32Array;
  boxes: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ] */
  bounds: [number, number, number, number, number, number];
}

/** Trimesh collider input (Rapier ColliderDesc.trimesh(vertices, indices, FIX_INTERNAL_EDGES)). */
export interface ColliderArrays {
  vertices: Float32Array;
  indices: Uint32Array;
  triangles: number;
}

export interface DistrictData {
  ix: number;
  iz: number;
  /** Everything (use < 300 m). */
  near: MeshArrays | null;
  /** Buildings as 1-2 boxes, trees as 1 box (use to 540 m). */
  far: MeshArrays | null;
  /** Solid props only (ghost props have no collider). */
  collider: ColliderArrays | null;
  bounds: [number, number, number, number, number, number];
}

/** A cuboid collider on the world's fixed body (ramps). */
export interface RampCuboid {
  rampId: string;
  center: Vec3;
  /** Half extents [x, y, z] in the box frame. */
  half: Vec3;
  /** Yaw (about +Y) then pitch (about the box's +X, three.js sign: negative climbs toward +Z). */
  yaw: number;
  pitch: number;
}

export interface RampInfo {
  id: string;
  name: string;
  /** Lip (top edge of the kicker), surface point. */
  lip: Vec3;
  yaw: number;
  /** Footprint centre and radius (for "no ramp within N m" checks). */
  center: Vec3;
  radius: number;
  /** Footprint rectangle half extents (along the yaw, across). */
  halfLength: number;
  halfWidth: number;
}

/** Distance from (x, z) to a ramp's footprint rectangle (0 inside). */
export function rampDistance(r: RampInfo, x: number, z: number): number {
  const s = Math.sin(r.yaw);
  const c = Math.cos(r.yaw);
  const dx = x - r.center[0];
  const dz = z - r.center[2];
  const along = Math.abs(dx * s + dz * c) - r.halfLength;
  const across = Math.abs(dx * c - dz * s) - r.halfWidth;
  return Math.hypot(Math.max(along, 0), Math.max(across, 0));
}

// ── Roads ───────────────────────────────────────────────────────────────────────────────────

export type RoadKind = 'highway' | 'street' | 'mountain' | 'dirt' | 'lane' | 'rail';

/** Per-sample flags in RoadData.flags. */
export const ROAD_PAD = 1;
export const ROAD_HOP = 2;
export const ROAD_SAFE = 4;
export const ROAD_JUNCTION = 8;

export interface RoadData {
  id: string;
  name: string;
  kind: RoadKind;
  surface: SurfaceName;
  width: number;
  closed: boolean;
  /** Sample spacing along the centreline, m (≈ 2). */
  ds: number;
  length: number;
  /** x, y, z per sample (y = road profile height). */
  points: Float32Array;
  /** Base terrain height under each sample before the road was cut in (cut/fill = y - base). */
  base: Float32Array;
  /** Unit tangent x, z per sample (direction of increasing station). */
  tangents: Float32Array;
  /** ROAD_* flags per sample. */
  flags: Uint8Array;
}

// ── Events, spots, signs ────────────────────────────────────────────────────────────────────

export interface GateData {
  position: Vec3;
  yaw: number;
  size: Vec3;
}

export interface WorldEvent {
  /** Catalog entry id (passes sanitizeId). */
  id: string;
  name: string;
  mode: 'race' | 'roam';
  accent: string;
  spawn: { position: Vec3; yaw: number };
  /** checkpoints[0] is the spawn (index 0). */
  checkpoints: (GateData & { index: number })[];
  finish: GateData;
  lengthM: number;
  /** Route polyline x, y, z every ≈ 2 m (empty for roam). */
  route: Float32Array;
  /** Planned speed per route point, m/s (asphalt-grip curvature + braking plan). */
  speeds: Float32Array;
  /** Route point index of each checkpoint (1..n) and, last, the finish. */
  gates: number[];
  /** Route point indices where the route turns off onto another road (holo arrows). */
  turnOffs: number[];
  /** Route point index ranges [start, end) of bends tighter than 120 m (chevron boards). */
  tightBends: [number, number][];
}

export interface TravelSpot {
  id: string;
  label: string;
  position: Vec3;
  yaw: number;
}

export interface EventPad {
  eventId: string;
  position: Vec3;
  yaw: number;
  radius: number;
  accent: string;
}

export interface SignData {
  id: string;
  text: string;
  sub: string;
  kind: 'place' | 'ramp';
  rampId: string | null;
  position: Vec3;
  yaw: number;
  width: number;
  height: number;
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
  y: number;
  glyph: 'spire' | 'light' | 'tower' | 'arch' | 'castle' | 'mill' | 'peak' | 'dock' | 'town' | 'flats' | 'lake' | 'pass' | 'strip';
}

export interface ProbePose {
  id: string;
  label: string;
  position: Vec3;
  yaw: number;
}

export interface WorldStats {
  boxes: number;
  trees: number;
  solidBoxes: number;
  ghostBoxes: number;
  colliderTriangles: number;
  colliders: number;
  nearVertices: number;
  farVertices: number;
  bytes: number;
  rampCuboids: number;
  timings: Record<string, number>;
}

export interface WorldData {
  seed: number;
  /** FNV-1a over every array and the JSON of the rest (16 hex chars). */
  hash: string;
  genMs: number;
  /** Row-major heights[iz * 513 + ix], rounded to 1/256 m. */
  heights: Float32Array;
  /** Column-major copy for Rapier: hf[ix * 513 + iz]. */
  hf: Float32Array;
  /** RGBA8 512²: RGB tile colour (with baked prop shadows / AO), A = water depth in 0.1 m steps. */
  tileTex: Uint8Array;
  /** RGBA8 513² road field (see FIELD_*). */
  fieldTex: Uint8Array;
  /** Surface id per cell (512², SURFACE_KINDS). */
  surface: Uint8Array;
  /** Region id per 16 m cell (128², REGION_IDS). */
  region: Uint8Array;
  /** Cliff mask per cell (512²): 1 = steep terrain allowed (strata rendering hint). */
  cliff: Uint8Array;
  /** RGBA8 512², 4 m per pixel, north-up (row 0 = z -1024). */
  minimap: Uint8Array;
  districts: DistrictData[];
  ramps: RampCuboid[];
  rampInfo: RampInfo[];
  roads: RoadData[];
  events: WorldEvent[];
  spots: TravelSpot[];
  pads: EventPad[];
  signs: SignData[];
  landmarks: Landmark[];
  probes: ProbePose[];
  stats: WorldStats;
}
