/**
 * Dune Goblin — an original long-travel desert buggy: orange tub, dark tube cage, huge knobbly wheels.
 *
 *   front   chrome skid plate sweeping up into a tube bull bar, round lamps, the animated nose
 *           flap (BUGGY_MODEL.wing)
 *   cabin   open tub with two seats under a roll cage (main hoop, raked A-pillars, roof rails,
 *           rear braces) carrying a six-lamp light bar
 *   sides   narrow tub with a white number board, high flat mudguards over the wheels
 *   rear    exposed engine with an air filter, upswept exhaust stack, spare wheel on the cage
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { exposure, fillBody, inWells, makeBodyGrid, paintPass, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { knots, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 1.96;
const REAR_Z = -1.8;
const CAGE_TOP = 1.72;
const TUBE = 0.045;

function tubHalfWidth(z: number): number {
  return knots(z, [[1.7, 0.42], [1.2, 0.56], [0.6, 0.66], [-0.8, 0.66], [-1.4, 0.58], [-1.7, 0.5]]);
}

function tubTop(z: number): number {
  return knots(z, [[1.7, 0.88], [1.0, 0.96], [0.5, 0.98], [-0.6, 0.98], [-1.2, 1.02], [-1.7, 1.0]]);
}

function tub(ax: number, h: number, z: number): number {
  if (z > 1.7 || z < -1.7 || h < 0.54) return 0;
  const w = tubHalfWidth(z);
  if (ax > w) return 0;
  const top = tubTop(z);
  if (h > top) return 0;
  // Open cockpit: carved down to the floor.
  if (z < 0.56 && z > -0.62 && ax < w - 0.1 && h > 0.8) return 0;
  return h < 0.62 ? M.carbon : M.paint;
}

function seats(ax: number, h: number, z: number): number {
  if (ax < 0.12 || ax > 0.44 || h < 0.78) return 0;
  if (z > -0.6 && z < -0.4 && h < 1.24) return M.paint2; // seat backs
  if (z >= -0.4 && z < 0.0 && h < 0.86) return M.paint2; // cushions
  return 0;
}

function skidPlate(ax: number, h: number, z: number): number {
  if (z < 1.6 || z > FRONT_Z || ax > 0.5) return 0;
  // A one-voxel plate rising from the tub floor to the bull bar.
  const plateH = 0.56 + (z - 1.6) * 1.0;
  return Math.abs(h - plateH) < 0.06 ? M.chrome : 0;
}

function bullBar(ax: number, h: number, z: number): number {
  if (z < 1.86 || z > FRONT_Z) return 0;
  if (Math.abs(ax - 0.44) < TUBE && h > 0.64 && h < 1.1) return M.cage;
  if (ax < 0.48 && h > 1.02 && h < 1.1) return M.cage;
  if (ax < 0.48 && h > 0.78 && h < 0.86 && ax > 0.36) return M.cage;
  return 0;
}

/** Distance from (a, b) to the segment (a0, b0)–(a1, b1) in a 2-D plane. */
function segDist(a: number, b: number, a0: number, b0: number, a1: number, b1: number): number {
  const da = a1 - a0;
  const db = b1 - b0;
  const t = Math.max(0, Math.min(1, ((a - a0) * da + (b - b0) * db) / (da * da + db * db)));
  return Math.hypot(a - (a0 + t * da), b - (b0 + t * db));
}

function cage(ax: number, h: number, z: number): number {
  // Main hoop behind the seats.
  if (Math.abs(z + 0.62) < TUBE + 0.005) {
    if (Math.abs(ax - 0.62) < TUBE && h > 0.96 && h < CAGE_TOP) return M.cage;
    if (ax < 0.66 && Math.abs(h - (CAGE_TOP - 0.04)) < TUBE) return M.cage;
  }
  // Raked A-pillars: from the tub's front corners up and back to the roof.
  if (Math.abs(ax - 0.6) < TUBE + 0.01 && segDist(z, h, 0.62, 0.96, 0.14, CAGE_TOP - 0.04) < TUBE + 0.01) return M.cage;
  // Front roof cross bar and roof rails.
  if (Math.abs(h - (CAGE_TOP - 0.04)) < TUBE) {
    if (Math.abs(z - 0.14) < TUBE && ax < 0.64) return M.cage;
    if (Math.abs(ax - 0.6) < TUBE + 0.01 && z < 0.16 && z > -0.64) return M.cage;
  }
  // Rear braces down to the tail.
  if (Math.abs(ax - 0.5) < TUBE + 0.01 && segDist(z, h, -0.62, CAGE_TOP - 0.04, -1.62, 1.04) < TUBE + 0.01) return M.cage;
  return 0;
}

function lightBar(ax: number, h: number, z: number): number {
  if (z < 0.08 || z > 0.24 || ax > 0.52 || h < CAGE_TOP || h > CAGE_TOP + 0.1) return 0;
  return M.carbon;
}

function engine(ax: number, h: number, z: number): number {
  if (z > -0.95 || z < -1.72) return 0;
  if (ax < 0.36 && h > 0.98 && h < 1.2 && z < -1.0) return M.rimBarrel; // engine block
  // Air filter drum on top.
  if (Math.hypot(ax, h - 1.28) < 0.12 && z < -1.1 && z > -1.42) return M.paint2;
  return 0;
}

function exhaustStack(x: number, h: number, z: number): number {
  const dx = x - 0.3;
  if (Math.abs(dx) > 0.05) return 0;
  if (Math.abs(z + 1.72) < 0.05 && h > 1.0 && h < 1.34) return M.chrome;
  if (h > 1.26 && h < 1.34 && z < -1.7 && z > REAR_Z - 0.04) return z < REAR_Z ? M.exhaust : M.chrome;
  return 0;
}

function spareWheel(ax: number, h: number, z: number, spec: VehicleSpec): number {
  if (z > -1.5 || z < -1.66) return 0;
  const r = Math.hypot(ax, h - 1.34);
  const tyre = spec.wheels[2]?.radius ?? 0.48;
  if (r > tyre * 0.72) return 0;
  if (r > tyre * 0.46) return M.tyre;
  return r < 0.08 ? M.hub : M.rim;
}

function mudguards(wells: readonly Well[], ax: number, h: number, z: number): number {
  for (const well of wells) {
    if (ax < 0.6 || ax > 1.14) continue;
    const top = well.h + well.r + 0.28;
    const dz = Math.abs(z - well.z);
    if (dz > 0.58) continue;
    // Flat guard with ends that drop toward the axle line.
    const drop = dz > 0.4 ? (dz - 0.4) * 1.1 : 0;
    if (h > top - 0.08 - drop && h <= top - drop) return M.paint;
  }
  return 0;
}

function sample(spec: VehicleSpec, wells: readonly Well[], ax: number, h: number, z: number, x: number): number {
  const stack = exhaustStack(x, h, z);
  if (stack) return stack;
  const guard = mudguards(wells, ax, h, z);
  if (guard) return guard;
  const tube = cage(ax, h, z) || bullBar(ax, h, z) || lightBar(ax, h, z);
  if (tube) return tube;
  if (inWells(wells, ax, h, z)) return 0;
  return (
    skidPlate(ax, h, z) ||
    tub(ax, h, z) ||
    seats(ax, h, z) ||
    engine(ax, h, z) ||
    spareWheel(ax, h, z, spec)
  );
}

function paint(g: VoxelGrid, spec: VehicleSpec): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    const e = exposure(g, i, j, k);
    // Light bar lamps on the front face.
    if (m === M.carbon && h > 1.7 && e.front && Math.floor(ax / 0.08) % 2 === 0) return M.headlight;
    if (m !== M.paint) return;
    // Round lamps in the tub's nose.
    if (z > 1.5 && e.front && Math.abs(ax - 0.28) < 0.09 && Math.abs(h - 0.8) < 0.07) return M.headlight;
    // Tail lamps at the rear corners.
    if (z < -1.6 && e.rear && ax > 0.32 && h > 0.84 && h < 1.0) return M.tail;
    // White number board on the flank.
    if (e.side && z > -0.38 && z < 0.3 && h > 0.64 && h < 0.94) return Math.abs(z + 0.04) < 0.06 && h > 0.68 && h < 0.9 ? M.paint2 : M.decal;
    // Magenta edge on the mudguards.
    if (e.side && ax > 1.0 && h > 1.1) return M.magentaStripe;
    // Dark lower tub stripe.
    if (e.side && h < 0.7) return M.paint2;
  });
}

function buildBuggyGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.14, CAGE_TOP + 0.14, -1.92, 2.04, 0.5);
  const wells = wheelWells(spec, { frontSteer: 0.12, bump: 0.3, margin: 0.08 });
  fillBody(g, spec, (ax, h, z, x) => sample(spec, wells, ax, h, z, x));
  paint(g, spec);
  return g;
}

export const BUGGY_MODEL: CarModelDef = {
  buildBody: buildBuggyGrid,
  livery: {
    [M.paint]: { color: '#FF8A1E', roughness: 0.4, metalness: 0.1, glow: 0.08, jitter: 0.04 },
    [M.paint2]: { color: '#15171D', roughness: 0.55, metalness: 0.15 },
    [M.rim]: { color: '#F5E663', roughness: 0.3, metalness: 0.3, glow: 0.35 },
    [M.hub]: { color: '#FF2A6D', roughness: 0.3, metalness: 0.2, glow: 0.8 },
    [M.tread]: { color: '#2A2C35', roughness: 0.95, metalness: 0, jitter: 0.08 },
  },
  wing: {
    pivot: [0, 1.0, 1.78],
    spanInnerX: 0,
    spanOuterX: 0.46,
    main: { chord: 0.2, thickness: 0.04, material: M.paint2 },
    mainDeg: [0, 24],
  },
  exhaust: [[0.3, 1.3, REAR_Z - 0.06]],
  wheel: { spokes: 5, treadBlocks: 14, bandSegments: 0, rimRatio: 0.62, knobby: true },
};
