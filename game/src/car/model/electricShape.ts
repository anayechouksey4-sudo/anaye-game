/**
 * Ion Dragonfly — an original heavy, low, dual-motor electric saloon in metallic blue.
 *
 *   front    grille-less flat nose with one full-width light bar and a small dark cooling slot,
 *            a flat front lip (the animated element, ELECTRIC_MODEL.wing)
 *   cabin    one long glass canopy from the screen to the rear window under a thin carbon spine,
 *            A- and C-pillars only (no B-pillar), tiny camera mirrors
 *   sides    tall flush flanks over a dark battery-floor cladding, a glowing sill line (the
 *            aero-status channel: cyan / magenta with the live front-axle load), smooth disc wheels
 *   rear     a continuous tail-light strip with the TIER strip under it (the exhaust channel: cyan →
 *            magenta with the engine tier, so the tier colour still shows on a car with no pipes),
 *            a small lip, the plate recess, no exhaust and no flame
 * No real car's face or proportions: it is a one-box wedge drawn from its battery floor up.
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { chamfer, exposure, fillBody, inWells, makeBodyGrid, paintPass, wellDistance, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { clamp01, knots, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 2.45;
const REAR_Z = -2.4;
const ROOF_H = 1.34;
export const ELECTRIC_PLATE_H = 0.6;

function sideHalfWidth(z: number): number {
  return knots(z, [[2.45, 0.8], [2.25, 0.9], [1.6, 0.96], [-1.4, 0.96], [-2.2, 0.93], [-2.4, 0.86]]);
}

/** A tall flank: the battery floor keeps the belt line high all the way along. */
function beltTop(z: number): number {
  return knots(z, [[2.45, 0.7], [2.3, 0.78], [1.4, 0.86], [0.2, 0.9], [-1.4, 0.94], [-2.2, 0.96], [-2.4, 0.94]]);
}

function lowerBody(ax: number, h: number, z: number): number {
  if (z > FRONT_Z || z < REAR_Z || h < 0.18) return 0;
  const w = sideHalfWidth(z);
  if (ax > w) return 0;
  const top = beltTop(z) - chamfer(ax, 0, w);
  if (h > top) return 0;
  return h < 0.3 ? M.paint2 : M.paint;
}

function canopyTop(z: number): number {
  return knots(z, [[1.4, 0.88], [0.9, 1.14], [0.3, ROOF_H], [-0.7, ROOF_H], [-1.4, 1.2], [-1.95, 1.0]]);
}

function canopy(ax: number, h: number, z: number): number {
  if (z > 1.4 || z < -1.95 || h < 0.84) return 0;
  const top = canopyTop(z);
  if (h > top) return 0;
  const t = clamp01((h - 0.9) / (ROOF_H - 0.9));
  const w = 0.88 - 0.18 * t;
  if (ax > w) return 0;
  if (h < 0.94) return M.paint;
  // Roof: a carbon spine down the middle, glass either side of it.
  if (h > top - 0.07) return ax < 0.1 ? M.carbon : M.glass;
  if (ax > w - 0.08 && (z > 1.0 || z < -1.6)) return M.paint; // A- and C-pillars
  return M.glass;
}

/** Small rear lip above the tail. */
function rearLip(ax: number, h: number, z: number): number {
  return z < -2.3 && z >= REAR_Z && h > 0.94 && h < 1.0 && ax < 0.8 ? M.paint : 0;
}

function mirrors(ax: number, h: number, z: number): number {
  return z > 0.9 && z < 1.0 && h > 0.92 && h < 0.98 && ax > 0.86 && ax < 0.98 ? M.paint : 0;
}

function sample(wells: readonly Well[], ax: number, h: number, z: number): number {
  if (inWells(wells, ax, h, z)) return 0;
  return lowerBody(ax, h, z) || canopy(ax, h, z) || rearLip(ax, h, z) || mirrors(ax, h, z);
}

function paint(g: VoxelGrid, spec: VehicleSpec, wells: readonly Well[]): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k, x) => {
    if (m !== M.paint) return;
    const e = exposure(g, i, j, k);
    if (z > FRONT_Z - 0.1 && e.front) {
      if (h > 0.6 && h < 0.68 && ax < 0.8) return M.headlight; // full-width light bar
      if (h > 0.3 && h < 0.4 && ax < 0.56) return M.grille; // cooling slot
    }
    if (z < REAR_Z + 0.1 && e.rear) {
      if (h > 0.8 && h < 0.88 && ax < 0.9) return M.tail; // continuous tail strip
      if (h > 0.72 && h < 0.78 && ax < 0.7) return M.exhaust; // TIER strip (tier colour channel)
      if (h > ELECTRIC_PLATE_H - 0.1 && h < ELECTRIC_PLATE_H + 0.1 && ax < 0.4) return M.paint2; // plate recess
      if (h < 0.46) return M.paint2;
    }
    if (e.side) {
      // Glowing sill line (aero-status channel).
      if (h > 0.44 && h < 0.5 && Math.abs(z) < 2.0) return M.aeroLed;
      // Charge port on the left rear quarter.
      if (x > 0 && z > -1.9 && z < -1.78 && h > 0.76 && h < 0.84) return M.decal;
      for (const well of wells) {
        const d = wellDistance(well, h, z);
        if (d >= well.r && d < well.r + 0.08) return M.paint2;
      }
    }
  });
}

function buildElectricGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.04, 1.44, -2.56, 2.6);
  const wells = wheelWells(spec, { frontSteer: 0.15, bump: 0.05 });
  fillBody(g, spec, (ax, h, z) => sample(wells, ax, h, z));
  paint(g, spec, wells);
  return g;
}

export const ELECTRIC_MODEL: CarModelDef = {
  buildBody: buildElectricGrid,
  livery: {
    [M.paint]: { color: '#2742B8', roughness: 0.3, metalness: 0.45, glow: 0.06, jitter: 0.03 },
    [M.paint2]: { color: '#0E1326', roughness: 0.55, metalness: 0.2 },
    [M.rim]: { color: '#9FD0FF', roughness: 0.3, metalness: 0.5, glow: 0.3 },
    [M.hub]: { color: '#39E6FF', roughness: 0.3, metalness: 0.2, glow: 0.8 },
    [M.decal]: { color: '#39E6FF', roughness: 0.4, metalness: 0, glow: 0.6 }, // charge port
    [M.sidewallBand]: { color: '#9FD0FF', roughness: 0.6, metalness: 0, glow: 0.2 },
  },
  wing: {
    pivot: [0, 0.2, FRONT_Z + 0.12],
    spanInnerX: 0,
    spanOuterX: 0.8,
    main: { chord: 0.14, thickness: 0.04, material: M.paint2 },
    mainDeg: [-2, 16],
  },
  exhaust: [],
  wheel: { spokes: 5, bandSegments: 0, rimRatio: 0.72, disc: true },
  plates: { rear: { position: [0, ELECTRIC_PLATE_H, REAR_Z] } },
};
