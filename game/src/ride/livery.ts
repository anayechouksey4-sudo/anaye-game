/**
 * Livery application: a PURE function from a class's filled body grid + a look (ride config and/or
 * active driver) to a NEW grid and a material table ready for `VoxelGrid.build`. The input grid is
 * never written to; the same inputs always give the same cells (tested), so a preview can rebuild
 * freely and the game can cache by `rideLookKey`.
 *
 *   paint / trim / wheels   material-table overrides (no cell changes)
 *   spoiler                 voxels stamped on the rear deck (lip, GT wing on uprights, shark fin)
 *   exhaust                 the class's own tips recoloured away, new chrome tips stamped on the
 *                           rear face at the class's outlet height; `outlets` tells the flame where
 *   driver window           closed cabins: side-glass / windscreen voxels beside the seat recoloured
 *                           to the driver's helmet and face, so the driver shows without a bust
 *   stance                  not a voxel change: CarModel offsets the body mesh by `ride.stance`
 */
import { CAR_VOXEL_MATERIALS, M, materialsWithLivery } from '../car/model/carMaterial';
import type { CarModelDef } from '../car/model/shapeKit';
import { VoxelGrid, type VoxelMaterial } from '../car/model/voxelGrid';
import { DEFAULT_WHEEL_STYLE, type WheelStyle } from '../car/model/wheelVoxels';
import type { VehicleSpec } from '../car/vehicleSpec';
import { HAIR_COLORS, SKIN_TONES, type AvatarConfig } from '../drivers/avatar';
import { seatFor, seatKnown, type SeatAnchor } from './anchors';
import { EXHAUST_TIPS, type RideConfig, type TrimId, type WheelStyleId } from './config';

/** Extra palette slots the livery adds after the car's own (carMaterial.ts M ends at 22). */
export const RM = {
  driverHelmet: 23,
  driverFace: 24,
  rideAccent: 25,
  spoilerDark: 26,
} as const;

const TRIM_COLOR: Readonly<Record<Exclude<TrimId, 'none' | 'accent'>, string>> = {
  cyan: '#00F0FF',
  magenta: '#FF2A6D',
  yellow: '#F5E663',
  green: '#39FF14',
  white: '#F4F7FB',
};

/** Wheel presets over the voxel wheel builder's style knobs ('stock' = the class's own). */
export const WHEEL_PRESETS: Readonly<Record<Exclude<WheelStyleId, 'stock'>, Partial<WheelStyle>>> = {
  spoke5: { spokes: 5, bandSegments: 4, rimRatio: 0.7, knobby: false, disc: false },
  spoke6: { spokes: 6, bandSegments: 0, rimRatio: 0.72, knobby: false, disc: false },
  disc: { bandSegments: 0, rimRatio: 0.74, knobby: false, disc: true },
  turbofan: { bandSegments: 8, rimRatio: 0.66, knobby: false, disc: true },
  knobby: { spokes: 5, treadBlocks: 14, bandSegments: 0, rimRatio: 0.6, knobby: true, disc: false },
  retro: { spokes: 8, bandSegments: 6, rimRatio: 0.6, knobby: false, disc: false },
};

export interface LookSpec {
  /** The ride, or null for the stock look. */
  ride: RideConfig | null;
  /** The active driver's avatar, or null for an empty seat. */
  driver: AvatarConfig | null;
}

export interface LookResult {
  /** A new grid (the input is untouched), possibly larger than the input for stamped parts. */
  grid: VoxelGrid;
  materials: VoxelMaterial[];
  /** Exhaust outlets [x, h, z] (ground-relative h) for the flame: stamped tips, the class's own, or none. */
  outlets: (readonly [number, number, number])[];
  wheelStyle: WheelStyle;
  /** Cells written by stamps and recolours (diagnostics / tests). */
  changed: number;
}

/** Wheel style a look uses (class default, overridden by a ride's preset). */
export function wheelStyleFor(def: CarModelDef, ride: RideConfig | null): WheelStyle {
  const base = { ...DEFAULT_WHEEL_STYLE, ...def.wheel };
  if (!ride || ride.wheel === 'stock') return base;
  return { ...base, ...WHEEL_PRESETS[ride.wheel] };
}

/** The material table of a look: the class's palette + the ride's colours + the driver slots. */
export function lookMaterials(def: CarModelDef, look: LookSpec): VoxelMaterial[] {
  const table = materialsWithLivery(def.livery).slice();
  const ride = look.ride;
  if (ride) {
    table[M.paint] = { ...CAR_VOXEL_MATERIALS[M.paint]!, color: ride.paint };
    table[M.paint2] = { ...CAR_VOXEL_MATERIALS[M.paint2]!, color: ride.paint2 };
    table[M.rim] = { ...CAR_VOXEL_MATERIALS[M.rim]!, color: ride.wheelColor };
    table[M.hub] = { ...CAR_VOXEL_MATERIALS[M.hub]!, color: ride.accent };
    table[M.sidewallBand] = { ...CAR_VOXEL_MATERIALS[M.sidewallBand]!, color: ride.accent };
    if (ride.trim === 'none') {
      const matte: VoxelMaterial = { color: ride.paint2, roughness: 0.5, metalness: 0.2 };
      table[M.cyanStripe] = matte;
      table[M.magentaStripe] = matte;
    } else {
      const color = ride.trim === 'accent' ? ride.accent : TRIM_COLOR[ride.trim];
      table[M.cyanStripe] = { color, roughness: 0.4, metalness: 0, glow: 1.4 };
      table[M.magentaStripe] = { color, roughness: 0.4, metalness: 0, glow: 1.3 };
    }
  }
  const accent = ride?.accent ?? '#F5E663';
  table[RM.rideAccent] = { color: accent, roughness: 0.4, metalness: 0, glow: 1.2 };
  table[RM.spoilerDark] = { color: '#15171E', roughness: 0.5, metalness: 0.35, jitter: 0.1 };
  const d = look.driver;
  const helmetColor = d ? (d.helmet === 'none' ? (HAIR_COLORS[d.hairColor] ?? HAIR_COLORS[0]) : d.color) : '#1B3A5A';
  table[RM.driverHelmet] = { color: helmetColor, roughness: 0.3, metalness: 0.2, glow: d && d.helmet !== 'none' ? 0.35 : 0.05 };
  const faceColor = d ? (d.helmet === 'full' && d.visor !== 'none' ? VISOR_HEX[d.visor] : (SKIN_TONES[d.skin] ?? SKIN_TONES[3])) : '#1B3A5A';
  table[RM.driverFace] = { color: faceColor, roughness: 0.6, metalness: 0.1, glow: d && d.helmet === 'full' && d.visor !== 'none' && d.visor !== 'clear' ? 0.8 : 0.05 };
  return table;
}

const VISOR_HEX: Record<AvatarConfig['visor'], string> = { none: '#1B3A5A', clear: '#2A557D', cyan: '#00F0FF', magenta: '#FF2A6D', gold: '#F5E663' };

/** A copy of `g` with `up` extra rows above and `back` extra columns behind (−Z); cells are copied, never shared. */
export function enlargeGrid(g: VoxelGrid, up: number, back: number): VoxelGrid {
  const [nx, ny, nz] = g.n;
  const [sx, sy, sz] = g.size;
  const out = new VoxelGrid([nx, ny + up, nz + back], [sx, sy, sz], [g.origin[0], g.origin[1], g.origin[2] - back * sz]);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.set(i, j, k + back, g.get(i, j, k));
  return out;
}

/** Grid index helpers in the shape vocabulary (h ground-relative). */
function indexOfX(g: VoxelGrid, x: number): number {
  return Math.floor((x - g.origin[0]) / g.size[0]);
}
function indexOfH(g: VoxelGrid, spec: VehicleSpec, h: number): number {
  return Math.floor((h - spec.rideHeight - g.origin[1]) / g.size[1]);
}

/** Highest filled row at column (i, k), or -1. */
function topAt(g: VoxelGrid, i: number, k: number): number {
  for (let j = g.n[1] - 1; j >= 0; j--) if (g.filled(i, j, k)) return j;
  return -1;
}

/** Rearmost filled depth index at (i, j) (the rear face is just behind it), or -1. */
function rearFaceAt(g: VoxelGrid, i: number, j: number): number {
  for (let k = 0; k < g.n[2]; k++) if (g.filled(i, j, k)) return k;
  return -1;
}

/** Like rearFaceAt, but tries nearby rows and columns toward the centre line (narrow tails, light bars, diffusers). */
function nearestRearFace(g: VoxelGrid, i: number, j: number, iCentre: number): { i: number; j: number; k: number } | null {
  const step = i < iCentre ? 1 : i > iCentre ? -1 : 0;
  for (let di = 0; di <= 4; di++) {
    const ii = i + step * di;
    for (const dj of [0, 1, -1, 2, -2, 3, -3]) {
      const k = rearFaceAt(g, ii, j + dj);
      if (k >= 0) return { i: ii, j: j + dj, k };
    }
    if (step === 0) break;
  }
  return null;
}

/** The rear deck: depth index ~0.3 m ahead of the tail, its top row and half width (in cells). */
function deckAnchor(g: VoxelGrid): { k: number; jTop: number; iHalf: number; iCentre: number } | null {
  const iCentre = indexOfX(g, 0);
  // Tail = rearmost column with anything in it at mid height.
  let kTail = -1;
  for (let k = 0; k < g.n[2] && kTail < 0; k++) for (let j = 0; j < g.n[1]; j++) if (g.filled(iCentre, j, k)) { kTail = k; break; }
  if (kTail < 0) return null;
  const k = kTail + Math.round(0.3 / g.size[2]);
  let jTop = -1;
  for (let di = -3; di <= 3; di++) jTop = Math.max(jTop, topAt(g, iCentre + di, k));
  if (jTop < 0) return null;
  let iHalf = 0;
  for (let di = 0; iCentre + di < g.n[0]; di++) {
    if (!g.filled(iCentre + di, jTop, k) && !g.filled(iCentre + di, jTop - 1, k)) break;
    iHalf = di;
  }
  return { k, jTop, iHalf: Math.max(iHalf, 3), iCentre };
}

function stampSpoiler(g: VoxelGrid, ride: RideConfig): number {
  if (ride.spoiler === 'stock') return 0;
  const deck = deckAnchor(g);
  if (!deck) return 0;
  const { k, jTop, iHalf, iCentre } = deck;
  let n = 0;
  const put = (i: number, j: number, kk: number, m: number) => {
    if (g.inBounds(i, j, kk) && g.get(i, j, kk) !== m) {
      g.set(i, j, kk, m);
      n++;
    }
  };
  if (ride.spoiler === 'lip') {
    for (let di = -iHalf + 1; di <= iHalf - 1; di++) {
      put(iCentre + di, jTop + 1, k, M.paint2);
      put(iCentre + di, jTop + 1, k - 1, M.paint2);
      put(iCentre + di, jTop + 2, k - 1, RM.rideAccent);
    }
  } else if (ride.spoiler === 'gt') {
    const span = iHalf - 1;
    const post = span - 2;
    // Uprights (2 wide × 4 tall × 2 deep) and a 1-thick wing plane 3 deep with endplates.
    for (let j = jTop + 1; j <= jTop + 4; j++)
      for (const s of [-1, 1])
        for (let di = post - 1; di <= post; di++) for (let dk = -1; dk <= 0; dk++) put(iCentre + s * di, j, k + dk, RM.spoilerDark);
    for (let di = -span; di <= span; di++) {
      for (let dk = -2; dk <= 1; dk++) put(iCentre + di, jTop + 5, k + dk, dk === -2 ? RM.rideAccent : RM.spoilerDark);
    }
    for (const s of [-1, 1])
      for (let j = jTop + 4; j <= jTop + 6; j++) for (let dk = -2; dk <= 1; dk++) put(iCentre + s * (span + 1), j, k + dk, j === jTop + 6 ? RM.rideAccent : RM.spoilerDark);
  } else if (ride.spoiler === 'fin') {
    for (let dk = -1; dk <= 5; dk++) {
      const height = 4 - Math.floor(Math.max(0, dk) / 2);
      for (let j = jTop + 1; j <= jTop + height; j++) put(iCentre, j, k + dk, j === jTop + height ? RM.rideAccent : M.paint);
    }
  }
  return n;
}

function stampExhaust(g: VoxelGrid, spec: VehicleSpec, def: CarModelDef, ride: RideConfig): { changed: number; outlets: (readonly [number, number, number])[] } {
  const tips = EXHAUST_TIPS[ride.exhaust];
  if (tips < 0) return { changed: 0, outlets: def.exhaust.slice() };
  let n = 0;
  // The class's own tips lose their glow (carbon); the flame moves to the stamped tips.
  g.forEachFilled((i, j, k, m) => {
    if (m === M.exhaust) {
      g.set(i, j, k, M.carbon);
      n++;
    }
  });
  const stock = def.exhaust[0];
  const h = stock ? stock[1] : 0.45;
  const z = stock ? stock[2] : g.origin[2] + g.size[2] * 3;
  const xs = tips === 0 ? [] : tips === 1 ? [0] : tips === 2 ? [-0.28, 0.28] : [-0.5, -0.26, 0.26, 0.5];
  const outlets: (readonly [number, number, number])[] = [];
  const jWanted = indexOfH(g, spec, h);
  const iCentre = indexOfX(g, 0);
  for (const x of xs) {
    const face = nearestRearFace(g, indexOfX(g, x), jWanted, iCentre);
    if (!face) continue;
    const { i, j, k: kFace } = face;
    // A 3×3 chrome ring with a dark exhaust core, two cells proud of the face (the first layer bites into it).
    for (let dk = 0; dk <= 2; dk++)
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const core = di === 0 && dj === 0;
          const m = core ? M.exhaust : M.chrome;
          const kk = kFace - dk;
          if (g.inBounds(i + di, j + dj, kk) && g.get(i + di, j + dj, kk) !== m) {
            g.set(i + di, j + dj, kk, m);
            n++;
          }
        }
    outlets.push([g.cx(i), g.cy(j) + spec.rideHeight, g.cz(Math.max(0, kFace - 2)) - g.size[2] / 2] as const);
  }
  const zPlane = outlets[0]?.[2] ?? z;
  return { changed: n, outlets: outlets.map(([x, hh]) => [x, hh, zPlane] as const) };
}

/**
 * A seat guess for a class without an anchor (a newly added car): the glass of the driver's side
 * says where the cabin is. Null when the car has no side glass (open cockpit or glassless body).
 */
export function deriveSeat(g: VoxelGrid, spec: VehicleSpec): SeatAnchor | null {
  const zs: number[] = [];
  let hMin = Infinity;
  g.forEachFilled((i, j, k, m) => {
    if (m !== M.glass && m !== M.glassStreak) return;
    if (g.cx(i) <= 0.1 || g.filled(i + 1, j, k)) return;
    zs.push(g.cz(k));
    hMin = Math.min(hMin, g.cy(j) + spec.rideHeight);
  });
  if (zs.length < 4) return null;
  zs.sort((a, b) => a - b);
  // The front half of the side glass is the door window; the seat sits a little behind its middle.
  const z = zs[Math.floor(zs.length * 0.6)]! - 0.05;
  return { x: 0.36, h: hMin - 0.06, z, open: false };
}

function paintDriverWindow(g: VoxelGrid, spec: VehicleSpec, carId: string): number {
  const seat = seatKnown(carId) ? seatFor(carId) : deriveSeat(g, spec);
  if (!seat || seat.open) return 0;
  let n = 0;
  const h0 = seat.h + 0.1;
  const h1 = seat.h + 0.38;
  const face0 = seat.h + 0.17;
  const face1 = seat.h + 0.25;
  g.forEachFilled((i, j, k, m) => {
    if (m !== M.glass && m !== M.glassStreak) return;
    const x = g.cx(i);
    const h = g.cy(j) + spec.rideHeight;
    const z = g.cz(k);
    if (h < h0 || h > h1) return;
    const sideWindow = x > 0.1 && z >= seat.z - 0.16 && z <= seat.z + 0.18 && !g.filled(i + 1, j, k);
    const screen = z > seat.z + 0.18 && z < seat.z + 0.7 && x > seat.x - 0.18 && x < seat.x + 0.18 && !g.filled(i, j, k + 1);
    if (!sideWindow && !screen) return;
    g.set(i, j, k, h >= face0 && h <= face1 ? RM.driverFace : RM.driverHelmet);
    n++;
  });
  return n;
}

/** Room stamps may need above and behind the stock grid (cells). */
const EXTRA_UP = 7;
const EXTRA_BACK = 3;

/** The look applied to a class's body grid: see the module comment. Pure; `grid` is only read. */
export function applyLook(grid: VoxelGrid, spec: VehicleSpec, def: CarModelDef, look: LookSpec): LookResult {
  const ride = look.ride;
  const needsRoom = ride !== null && (ride.spoiler !== 'stock' || ride.exhaust !== 'stock');
  const g = enlargeGrid(grid, needsRoom ? EXTRA_UP : 0, needsRoom ? EXTRA_BACK : 0);
  let changed = 0;
  let outlets: (readonly [number, number, number])[] = def.exhaust.slice();
  if (ride) {
    changed += stampSpoiler(g, ride);
    const ex = stampExhaust(g, spec, def, ride);
    changed += ex.changed;
    outlets = ex.outlets;
  }
  if (look.driver) changed += paintDriverWindow(g, spec, spec.id);
  return { grid: g, materials: lookMaterials(def, look), outlets, wheelStyle: wheelStyleFor(def, ride), changed };
}
