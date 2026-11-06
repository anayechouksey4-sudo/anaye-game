/**
 * Glitch Rally — an original short-wheelbase rally hatch, lime with a black roof.
 *
 *   front   blunt bumper with a carbon skid plate, corner headlights and a four-lamp rally light pod
 *           on the bonnet's leading edge; raised bonnet scoop
 *   cabin   upright greenhouse with tumblehome, dark glass, black roof with a roof scoop
 *   sides   boxy black arch flares, a "glitch" skyline of cyan/magenta pixel bars along the sills,
 *           white door number board, magenta mud flaps behind every wheel
 *   rear    near-vertical hatch, big roof spoiler with endplates, vertical tail lights, side exhaust
 * The animated front-wing element is a splitter flap under the bumper (see RALLY_MODEL.wing).
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { VOXEL, chamfer, exposure, fillBody, inWells, makeBodyGrid, paintPass, wellDistance, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { clamp01, knots, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 1.94;
const REAR_Z = -1.94;
const BELT_H = 0.92;
const ROOF_H = 1.4;

function bodyHalfWidth(z: number): number {
  return knots(z, [[1.94, 0.76], [1.7, 0.84], [-1.7, 0.85], [-1.94, 0.8]]);
}

function lowerTop(z: number): number {
  // Bumper → bonnet → belt line → tail.
  return knots(z, [[1.94, 0.6], [1.84, 0.7], [1.5, 0.76], [0.85, 0.86], [0.6, BELT_H], [-1.5, BELT_H], [-1.82, 0.9], [-1.94, 0.66]]);
}

function lowerBody(ax: number, h: number, z: number): number {
  if (z > FRONT_Z || z < REAR_Z || h < 0.2) return 0;
  const w = bodyHalfWidth(z);
  if (ax > w) return 0;
  const top = lowerTop(z) - chamfer(ax, 0, w);
  if (h > top) return 0;
  // Bumpers: dark lower lip; everything else body colour.
  if ((z > 1.76 || z < -1.76) && h < 0.32) return M.carbon;
  return M.paint;
}

function cabinTop(z: number): number {
  return knots(z, [[0.86, 0.88], [0.3, 1.36], [0.15, ROOF_H], [-1.2, ROOF_H], [-1.38, 1.36], [-1.56, 1.02], [-1.7, BELT_H]]);
}

function cabin(ax: number, h: number, z: number): number {
  if (z > 0.86 || z < -1.7 || h < BELT_H - 0.04 || h > cabinTop(z)) return 0;
  const t = clamp01((h - BELT_H) / (ROOF_H - BELT_H));
  const w = (0.8 - 0.14 * t) * knots(z, [[0.86, 0.92], [0.4, 1], [-1.7, 1]]);
  if (ax > w) return 0;
  if (h > ROOF_H - 0.1) return M.paint2; // black roof
  if (h < BELT_H + 0.06) return M.paint;
  // Pillars (A along the windscreen's side edge, B behind the door, thick C) are body colour; the rest is glass.
  const aPillar = z > 0.2 && ax > w - 0.085 && h > cabinTop(z) - 0.12;
  const bPillar = z < -0.3 && z > -0.46;
  const cPillar = z < -1.05 && ax > 0.3;
  return aPillar || bPillar || cPillar ? M.paint : M.glass;
}

function roofScoop(ax: number, h: number, z: number): number {
  if (ax > 0.18 || z < -0.15 || z > 0.22 || h < ROOF_H - 0.04 || h > ROOF_H + 0.1) return 0;
  return z > 0.14 ? M.intake : M.paint2;
}

function roofSpoiler(ax: number, h: number, z: number): number {
  if (z > -1.26 || z < -1.82) return 0;
  if (ax < 0.74 && h > ROOF_H - 0.08 && h < ROOF_H + 0.08) return z < -1.74 ? M.magentaStripe : M.paint2;
  if (ax >= 0.72 && ax < 0.82 && h > ROOF_H - 0.2 && h < ROOF_H + 0.12 && z < -1.34) return M.paint2;
  return 0;
}

function bonnetScoop(ax: number, h: number, z: number): number {
  if (ax > 0.24 || z < 1.0 || z > 1.42) return 0;
  const top = lowerTop(z) + 0.08;
  if (h > top || h < lowerTop(z) - 0.04) return 0;
  return z > 1.34 ? M.intake : M.paint;
}

function lightPod(ax: number, h: number, z: number): number {
  if (z < 1.84 || z > 1.98 || ax > 0.6 || h < 0.66 || h > 0.84) return 0;
  return M.carbon;
}

function archFlares(wells: readonly Well[], ax: number, h: number, z: number): number {
  for (const well of wells) {
    if (ax < 0.7 || ax > 0.94) continue;
    if (Math.abs(z - well.z) > well.r + 0.12 || h > well.h + well.r + 0.1 || h < 0.2) continue;
    if (wellDistance(well, h, z) < well.r + 0.12) return M.carbon;
  }
  return 0;
}

function mudFlaps(wells: readonly Well[], ax: number, h: number, z: number): number {
  for (const well of wells) {
    const back = well.z - well.r - 0.06;
    if (z < back - 0.08 || z > back || ax < 0.64 || ax > 0.92 || h < 0.14 || h > 0.44) continue;
    return M.magentaStripe;
  }
  return 0;
}

function mirrors(ax: number, h: number, z: number): number {
  if (z > 0.62 && z < 0.8 && h > 0.96 && h < 1.08 && ax > 0.78 && ax < 0.96) return z < 0.66 ? M.paint2 : M.paint;
  return 0;
}

function exhaust(x: number, h: number, z: number): number {
  if (z > REAR_Z + 0.08 || z < REAR_Z - 0.1) return 0;
  if (Math.abs(x + 0.46) < 0.08 && h > 0.2 && h < 0.34) return Math.abs(x + 0.46) < 0.04 ? M.exhaust : M.chrome;
  return 0;
}

/** 3 × 5 pixel glyph for the door number. */
const DIGIT_SEVEN = ['###', '..#', '.#.', '.#.', '.#.'];

function sample(wells: readonly Well[], ax: number, h: number, z: number, x: number): number {
  const spoiler = roofSpoiler(ax, h, z);
  if (spoiler) return spoiler;
  const tip = exhaust(x, h, z);
  if (tip) return tip;
  const flap = mudFlaps(wells, ax, h, z);
  if (flap) return flap;
  if (inWells(wells, ax, h, z)) return 0;
  return (
    lightPod(ax, h, z) ||
    archFlares(wells, ax, h, z) ||
    bonnetScoop(ax, h, z) ||
    lowerBody(ax, h, z) ||
    cabin(ax, h, z) ||
    roofScoop(ax, h, z) ||
    mirrors(ax, h, z)
  );
}

function paint(g: VoxelGrid, spec: VehicleSpec): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k, x) => {
    const e = exposure(g, i, j, k);
    // Rally lamps: four square lamps on the pod's front face.
    if (m === M.carbon && z > 1.84 && h > 0.68 && h < 0.82 && e.front) {
      const lamp = (ax > 0.06 && ax < 0.24) || (ax > 0.34 && ax < 0.52);
      if (lamp) return M.headlight;
    }
    // Corner headlights in the bumper face.
    if (m === M.paint && z > 1.86 && e.front && ax > 0.5 && ax < 0.74 && h > 0.46 && h < 0.6) return M.headlight;
    // Grille between them.
    if (m === M.paint && z > 1.86 && e.front && ax < 0.42 && h > 0.36 && h < 0.56) return M.grille;
    // Vertical tail lights at the rear corners.
    if (m === M.paint && z < -1.84 && e.rear && ax > 0.56 && h > 0.6 && h < 0.88) return M.tail;
    // Rear window on the hatch face.
    if (m === M.paint && z < -1.5 && e.rear && ax < 0.5 && h > 1.0 && h < 1.32) return M.glass;
    // Glitch skyline along the sills: pixel bars of seeded heights, cyan and magenta.
    if (m === M.paint && e.side && z > -0.9 && z < 0.86 && h > 0.26) {
      const col = Math.floor((z + 2) / VOXEL);
      const bars = [1, 3, 1, 2, 4, 1, 2, 1, 3, 1, 4, 2, 1, 1, 3, 2, 1, 4, 1, 2, 3, 1, 2];
      const tall = bars[col % bars.length] ?? 2;
      if (h < 0.26 + tall * VOXEL * 0.75) return col % 3 === 0 ? M.magentaStripe : M.cyanStripe;
    }
    // White door number board with a dark "7".
    if (m === M.paint && e.side && z > -0.3 && z < 0.26 && h > 0.48 && h < 0.88) {
      const col = Math.floor((z + 0.3) / VOXEL) - 2;
      const row = 4 - Math.floor((h - 0.48) / VOXEL);
      const glyphRow = DIGIT_SEVEN[row];
      // Read from outside: on the left flank (+x) the nose is to the viewer's left.
      const on = glyphRow !== undefined && col >= 0 && col < 3 && glyphRow[x >= 0 ? 2 - col : col] === '#';
      return on ? M.paint2 : M.decal;
    }
    // Black bonnet stripe.
    if (m === M.paint && e.top && ax < 0.1 && z > 0.86) return M.paint2;
  });
}

function buildRallyGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 0.96, 1.56, -2.06, 2.0);
  const wells = wheelWells(spec, { frontSteer: 0.14, bump: 0.06 });
  fillBody(g, spec, (ax, h, z, x) => sample(wells, ax, h, z, x));
  paint(g, spec);
  return g;
}

export const RALLY_MODEL: CarModelDef = {
  buildBody: buildRallyGrid,
  livery: {
    [M.paint]: { color: '#86FF3A', roughness: 0.38, metalness: 0.08, glow: 0.06 },
    [M.paint2]: { color: '#121419', roughness: 0.45, metalness: 0.2 },
    [M.rim]: { color: '#F5E663', roughness: 0.3, metalness: 0.3, glow: 0.55 },
    [M.hub]: { color: '#00F0FF', roughness: 0.3, metalness: 0.2, glow: 0.8 },
  },
  wing: {
    pivot: [0, 0.2, FRONT_Z + 0.1],
    spanInnerX: 0,
    spanOuterX: 0.78,
    main: { chord: 0.16, thickness: 0.04, material: M.paint2 },
    mainDeg: [-2, 16],
  },
  exhaust: [[-0.46, 0.27, REAR_Z - 0.1]],
  wheel: { spokes: 6, bandSegments: 0, rimRatio: 0.68 },
};
