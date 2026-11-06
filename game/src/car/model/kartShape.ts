/**
 * Pixel Gnat — an original tiny single-speed racing kart: white pods, an open seat, open wheels.
 *
 *   front    a short nose cone with a white number board, a tube bumper, the animated nose flap
 *            (KART_MODEL.wing)
 *   middle   a flat carbon floor pan, white side pods with a magenta band, a bucket seat (the active
 *            driver's bust sits in it: drivers/DriverBust.tsx at the ride/anchors.ts kart seat), voxel
 *            legs and arms to a small steering wheel
 *   right    the engine block beside the seat with its chrome exhaust running back to the tail
 *   rear     a tube bumper bar carrying the (small) number plate and a tail LED
 * Nothing borrowed: a kart is a floor, four wheels and a driver; the colours are the game's own.
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { exposure, fillBody, makeBodyGrid, paintPass, type CarModelDef } from './shapeKit';
import { knots, type VoxelGrid } from './voxelGrid';

const NOSE_Z = 1.0;
const TAIL_Z = -1.0;
/** Rear bumper bar: the plate hangs on its back face. */
const BUMPER_H = 0.26;

function floorPan(ax: number, h: number, z: number): number {
  if (h < 0.08 || h > 0.14 || z < -0.92 || z > 0.86) return 0;
  const w = z > -0.55 && z < 0.45 ? 0.56 : 0.44;
  return ax < w ? M.carbon : 0;
}

function sidePods(ax: number, h: number, z: number): number {
  if (z < -0.5 || z > 0.5 || ax < 0.34 || ax > 0.56 || h < 0.1 || h > 0.3) return 0;
  if (Math.abs(z) > 0.4 && ax > 0.5) return 0; // rounded ends
  return M.paint;
}

function noseCone(ax: number, h: number, z: number): number {
  if (z < 0.6 || z > NOSE_Z) return 0;
  const w = knots(z, [[0.6, 0.32], [0.85, 0.3], [1.0, 0.22]]);
  const top = knots(z, [[0.6, 0.4], [0.85, 0.36], [1.0, 0.26]]);
  return ax <= w && h >= 0.1 && h <= top ? M.paint : 0;
}

function bumpers(ax: number, h: number, z: number): number {
  if (h < 0.18 || h > 0.26) {
    // Rear bar sits a little higher.
    if (h > BUMPER_H - 0.04 && h < BUMPER_H + 0.04 && z > -1.06 && z < -0.98 && ax < 0.5) return M.cage;
    return 0;
  }
  if (z > NOSE_Z && z < NOSE_Z + 0.08 && ax < 0.5) return M.cage; // front bar
  if (Math.abs(ax - 0.48) < 0.05 && z > 0.6 && z < NOSE_Z + 0.08) return M.cage; // its side legs
  return 0;
}

function seat(ax: number, h: number, z: number): number {
  if (z > -0.36 && z < -0.04 && ax < 0.22 && h > 0.14 && h < 0.3) return M.rimBarrel; // cushion
  if (z > -0.44 && z < -0.34 && ax < 0.24 && h > 0.14 && h < 0.62 && (h < 0.44 || ax < 0.16)) return M.rimBarrel; // backrest
  return 0;
}

function driver(ax: number, h: number, z: number): number {
  // The torso and helmet are no longer painted here: the active driver's bust (drivers/DriverBust.tsx)
  // sits at the open seat anchor (ride/anchors.ts kart, h 0.48, z -0.22, where the voxel helmet used to
  // be); only the legs under the wheel and the arms reaching it stay voxels.
  if (z > -0.04 && z < 0.5 && ax < 0.12 && h > 0.14 && h < 0.26) return M.carbon; // legs
  if (z > -0.12 && z < 0.14 && ax > 0.08 && ax < 0.16 && h > 0.4 && h < 0.5) return M.carbon; // arms to the wheel
  return 0;
}

function steeringWheel(ax: number, h: number, z: number): number {
  if (z < 0.12 || z > 0.18) return 0;
  const r = Math.hypot(ax, h - 0.5);
  return r > 0.06 && r < 0.13 ? M.carbon : 0;
}

/** Engine on the driver's right (−X) with its exhaust running back along the side. */
function engine(x: number, h: number, z: number): number {
  if (x < -0.3 && x > -0.5 && z > -0.55 && z < -0.25 && h > 0.14 && h < 0.42) return M.rimBarrel; // block
  if (x < -0.34 && x > -0.46 && z > -0.5 && z < -0.3 && h > 0.42 && h < 0.5) return M.carbon; // head
  if (Math.hypot(x + 0.4, h - 0.36) < 0.08 && z > -0.24 && z < -0.14) return M.chrome; // air filter
  if (Math.abs(x + 0.5) < 0.04 && h > 0.28 && h < 0.36 && z > -0.96 && z < -0.55) return z < -0.9 ? M.exhaust : M.chrome; // pipe
  return 0;
}

function sample(ax: number, h: number, z: number, x: number): number {
  return (
    bumpers(ax, h, z) ||
    engine(x, h, z) ||
    driver(ax, h, z) ||
    seat(ax, h, z) ||
    steeringWheel(ax, h, z) ||
    noseCone(ax, h, z) ||
    sidePods(ax, h, z) ||
    floorPan(ax, h, z)
  );
}

function paint(g: VoxelGrid, spec: VehicleSpec): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    const e = exposure(g, i, j, k);
    // Tail LED in the middle of the rear bar.
    if (m === M.cage && e.rear && z < -1.0 && ax < 0.06) return M.tail;
    if (m !== M.paint) return;
    // Number board on the nose: white with a dark "1".
    if (e.front && z > 0.94 && ax < 0.16 && h > 0.12 && h < 0.26) return ax < 0.03 && h < 0.24 ? M.paint2 : M.decal;
    // Magenta band around each side pod.
    if (e.side && ax > 0.5 && Math.abs(z) < 0.1) return M.magentaStripe;
    // Pod tops carry a small number board too.
    if (e.top && ax > 0.38 && ax < 0.52 && z > -0.14 && z < 0.14) return M.decal;
  });
}

function buildKartGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 0.78, 0.9, -1.1, 1.12, 0.04);
  fillBody(g, spec, (ax, h, z, x) => sample(ax, h, z, x));
  paint(g, spec);
  return g;
}

export const KART_MODEL: CarModelDef = {
  buildBody: buildKartGrid,
  livery: {
    [M.paint]: { color: '#F2F2F2', roughness: 0.4, metalness: 0.05, glow: 0.05, jitter: 0.03 },
    [M.paint2]: { color: '#F5E663', roughness: 0.3, metalness: 0.1, glow: 0.35 }, // number, nose flap
    [M.magentaStripe]: { color: '#FF2A6D', roughness: 0.35, metalness: 0.1, glow: 0.55 },
    [M.rim]: { color: '#FF2A6D', roughness: 0.3, metalness: 0.3, glow: 0.6 },
    [M.hub]: { color: '#F4F7FB', roughness: 0.3, metalness: 0.2, glow: 0.4 },
    [M.sidewallBand]: { color: '#F5E663', roughness: 0.6, metalness: 0, glow: 0.3 },
  },
  wing: {
    pivot: [0, 0.1, NOSE_Z + 0.1],
    spanInnerX: 0,
    spanOuterX: 0.26,
    main: { chord: 0.1, thickness: 0.04, material: M.paint2 },
    mainDeg: [0, 20],
  },
  exhaust: [[-0.5, 0.32, -0.96]],
  wheel: { spokes: 4, treadBlocks: 10, bandSegments: 0, rimRatio: 0.6 },
  plates: { rear: { position: [0, BUMPER_H + 0.02, TAIL_Z - 0.06], scale: 0.85 } },
};
