/**
 * Bruiser V8 — an original long-bonnet fastback coupe in deep violet with twin magenta stripes.
 *
 *   front   upright recessed grille with quad round lamps, full-width chrome bumper, power bulge
 *           and a raised shaker-style scoop on the long flat bonnet
 *   cabin   set far back, raked screen, fastback roof falling to a short deck with a ducktail
 *   sides   flat flanks with a cyan pinstripe, hips that swell over the fat rear tyres, a dark
 *           scoop ahead of each rear wheel
 *   rear    segmented full-width tail-light bar, chrome bumper, quad exhaust tips
 * The animated front-wing element is a chin spoiler ahead of the bumper (see MUSCLE_MODEL.wing).
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { chamfer, exposure, fillBody, inWells, makeBodyGrid, paintPass, wellDistance, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { clamp01, knots, smoothstep, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 2.4;
const REAR_Z = -2.38;
const ROOF_H = 1.3;

function sideHalfWidth(z: number, rearWell: Well | undefined): number {
  let w = knots(z, [[2.4, 0.9], [2.2, 0.96], [1.9, 0.99], [-2.2, 0.98], [-2.38, 0.92]]);
  // Hips: swell over the rear tyres.
  if (rearWell) w += 0.08 * (1 - smoothstep(0.2, 1.0, Math.abs(z - rearWell.z)));
  return w;
}

function beltTop(z: number): number {
  return knots(z, [[2.4, 0.74], [2.28, 0.8], [1.5, 0.84], [0.6, 0.88], [-0.6, 0.9], [-1.25, 0.97], [-2.2, 0.96], [-2.38, 0.9]]);
}

function lowerBody(ax: number, h: number, z: number, rearWell: Well | undefined): number {
  if (z > FRONT_Z || z < REAR_Z || h < 0.2) return 0;
  const w = sideHalfWidth(z, rearWell);
  if (ax > w) return 0;
  let top = beltTop(z) - chamfer(ax, 0, w);
  // Power bulge down the bonnet's centre.
  if (ax < 0.38 && z > 0.62 && z < 2.15) top += 0.06;
  if (h > top) return 0;
  return h < 0.28 ? M.carbon : M.paint;
}

function shakerScoop(ax: number, h: number, z: number): number {
  if (ax > 0.24 || z < 0.95 || z > 1.4 || h < 0.86 || h > 1.04) return 0;
  if (z > 1.32 && h > 0.9) return M.intake;
  return h > 0.98 ? M.chrome : M.carbon;
}

function cabinTop(z: number): number {
  return knots(z, [[0.62, 0.88], [0.1, 1.2], [-0.1, ROOF_H], [-0.75, ROOF_H], [-1.2, 1.18], [-1.95, 0.98], [-2.2, 1.0], [-2.36, 1.06]]);
}

function cabin(ax: number, h: number, z: number): number {
  if (z > 0.62 || z < REAR_Z || h < 0.84 || h > cabinTop(z)) return 0;
  const t = clamp01((h - 0.9) / (ROOF_H - 0.9));
  // The greenhouse narrows toward the roof; behind it the fastback/deck spans the full body.
  const fastback = z < -1.3;
  const w = fastback ? 0.92 - 0.1 * t : 0.78 - 0.16 * t;
  if (ax > w) return 0;
  if (fastback || h < 0.96) return M.paint;
  // A-pillar, then pillarless side glass back to the sail panel.
  if (ax > w - 0.08 && z > -0.1) return M.paint;
  if (h > ROOF_H - 0.06 || z < -0.9 + (h - 0.96) * 0.4) return M.paint;
  return M.glass;
}

function bumpers(ax: number, h: number, z: number): number {
  if (h < 0.3 || h > 0.44 || ax > 0.98) return 0;
  if (z > FRONT_Z - 0.06 && z < FRONT_Z + 0.06) return M.chrome;
  if (z < REAR_Z + 0.06 && z > REAR_Z - 0.06) return M.chrome;
  return 0;
}

const TIPS = [0.46, 0.64];
function exhaustTips(ax: number, h: number, z: number): number {
  if (z > REAR_Z - 0.04 || z < REAR_Z - 0.16 || h < 0.2 || h > 0.32) return 0;
  for (const tip of TIPS) if (Math.abs(ax - tip) < 0.06) return Math.abs(ax - tip) < 0.03 ? M.exhaust : M.chrome;
  return 0;
}

function mirrors(ax: number, h: number, z: number): number {
  if (z > 0.36 && z < 0.5 && h > 0.92 && h < 1.04 && ax > 0.76 && ax < 0.96) return M.chrome;
  return 0;
}

function sample(wells: readonly Well[], rearWell: Well | undefined, ax: number, h: number, z: number): number {
  const tip = exhaustTips(ax, h, z);
  if (tip) return tip;
  const bumper = bumpers(ax, h, z);
  if (bumper) return bumper;
  if (inWells(wells, ax, h, z)) return 0;
  return lowerBody(ax, h, z, rearWell) || shakerScoop(ax, h, z) || cabin(ax, h, z) || mirrors(ax, h, z);
}

function paint(g: VoxelGrid, spec: VehicleSpec, wells: readonly Well[]): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    if (m !== M.paint) return;
    const e = exposure(g, i, j, k);
    // Front fascia: recessed grille with quad round lamps.
    if (z > FRONT_Z - 0.1 && e.front) {
      if (h > 0.46 && h < 0.72 && ax < 0.88) {
        const lamp = (Math.abs(ax - 0.7) < 0.09 || Math.abs(ax - 0.5) < 0.09) && Math.abs(h - 0.59) < 0.09;
        return lamp ? M.headlight : M.grille;
      }
    }
    // Segmented full-width tail-light bar.
    if (z < REAR_Z + 0.1 && e.rear && h > 0.66 && h < 0.82 && ax < 0.9) {
      return Math.floor(ax / 0.08) % 3 === 2 ? M.grille : M.tail;
    }
    // Rear panel below the lamps reads dark.
    if (z < REAR_Z + 0.1 && e.rear && h > 0.44 && h < 0.66 && ax < 0.7) return M.paint2;
    // Twin racing stripes over bonnet, roof and deck.
    if (e.top && ax > 0.1 && ax < 0.3) return M.magentaStripe;
    // Cyan pinstripe along the flank.
    if (e.side && Math.abs(h - 0.8) < 0.04 && z > -2.2 && z < 2.2) return M.cyanStripe;
    // Side scoop ahead of each rear wheel.
    const rear = wells.find((w) => w.axle === 'rear');
    if (rear && e.side && z > rear.z + rear.r + 0.04 && z < rear.z + rear.r + 0.36 && h > 0.46 && h < 0.66) return M.intake;
    // Carbon trim around the arches.
    for (const well of wells) {
      const d = wellDistance(well, h, z);
      if (e.side && d >= well.r && d < well.r + 0.08) return M.paint2;
    }
  });
}

function buildMuscleGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.08, 1.4, -2.56, 2.5);
  const wells = wheelWells(spec, { frontSteer: 0.15, bump: 0.05 });
  const rearWell = wells.find((w) => w.axle === 'rear');
  fillBody(g, spec, (ax, h, z) => sample(wells, rearWell, ax, h, z));
  paint(g, spec, wells);
  return g;
}

export const MUSCLE_MODEL: CarModelDef = {
  buildBody: buildMuscleGrid,
  livery: {
    [M.paint]: { color: '#6A34D6', roughness: 0.3, metalness: 0.3, glow: 0.1, jitter: 0.03 },
    [M.cyanStripe]: { color: '#00F0FF', roughness: 0.4, metalness: 0, glow: 0.55 },
    [M.paint2]: { color: '#121016', roughness: 0.5, metalness: 0.2 },
    [M.magentaStripe]: { color: '#FF2A6D', roughness: 0.35, metalness: 0.1, glow: 0.55 },
    [M.rim]: { color: '#C9D2E0', roughness: 0.18, metalness: 0.9, glow: 0.08 },
    [M.hub]: { color: '#FF2A6D', roughness: 0.3, metalness: 0.2, glow: 0.8 },
    [M.sidewallBand]: { color: '#F4F7FB', roughness: 0.6, metalness: 0, glow: 0.18 },
  },
  wing: {
    pivot: [0, 0.22, FRONT_Z + 0.18],
    spanInnerX: 0,
    spanOuterX: 0.86,
    main: { chord: 0.16, thickness: 0.04, material: M.paint2 },
    mainDeg: [-4, 18],
  },
  exhaust: [
    [TIPS[0]!, 0.26, REAR_Z - 0.16],
    [TIPS[1]!, 0.26, REAR_Z - 0.16],
    [-TIPS[0]!, 0.26, REAR_Z - 0.16],
    [-TIPS[1]!, 0.26, REAR_Z - 0.16],
  ],
  wheel: { spokes: 5, bandSegments: 6, rimRatio: 0.66 },
};
