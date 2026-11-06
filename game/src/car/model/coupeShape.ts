/**
 * Ember Swallowtail — an original red rear-engined sports coupe with a gold pinstripe.
 *
 *   front    low, flat wedge nose with one slim full-width light bar (no round lamps) over a dark
 *            lower slot; a shallow front boot (the engine is in the back) with a central crease
 *   cabin    double-bubble roof (two ridges over the seats, a carbon spine between them), raked
 *            screen, slim glass, carbon A-pillars, a bulkhead behind the seats
 *   sides    knotted plan: narrow nose, wide hips over the rear tyres, carbon sill; a deep NOSTRIL
 *            intake low on each rear quarter feeding the rear engine; gold belt-line pinstripe
 *   rear     short deck with a louvred engine cover and a ducktail lip, a vertical KAMM tail (flat
 *            rear face) with a slim tail-light bar, a dark lower panel, twin centre exhausts low
 *            down and the number-plate recess between the lights (the plate itself is the textured
 *            quad from car/plates, mounted 1 cm proud of the recess: COUPE_MODEL.plates)
 * Deliberately NOT a fastback flyline, no round headlamps, no whale tail: the rear-engine spirit is
 * in the quarter nostrils, the louvred rear deck, the Kamm face and the rear weight, not in a
 * borrowed silhouette. The animated element is a chin splitter (COUPE_MODEL.wing).
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { chamfer, exposure, fillBody, inWells, makeBodyGrid, paintPass, wellDistance, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { clamp01, knots, smoothstep, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 2.05;
const REAR_Z = -2.2;
const ROOF_H = 1.28;
/** Rear plate: centre of the recess on the Kamm face (ground-relative h). */
export const COUPE_PLATE_H = 0.62;

/** Plan-view half width: narrow nose, wide hips over the rear tyres, cut flat at the Kamm tail. */
function sideHalfWidth(z: number, rearWell: Well | undefined): number {
  let w = knots(z, [[2.05, 0.74], [1.8, 0.86], [1.2, 0.9], [0.2, 0.9], [-0.8, 0.93], [-1.9, 0.95], [-2.2, 0.9]]);
  if (rearWell) w += 0.07 * (1 - smoothstep(0.25, 1.1, Math.abs(z - rearWell.z)));
  return w;
}

/** Belt line / top of the lower body: low wedge nose rising to the hips, short rear deck. */
function beltTop(z: number): number {
  return knots(z, [[2.05, 0.6], [1.9, 0.66], [1.3, 0.76], [0.4, 0.84], [-0.9, 0.9], [-1.6, 0.96], [-2.2, 0.94]]);
}

function lowerBody(ax: number, h: number, z: number, rearWell: Well | undefined): number {
  if (z > FRONT_Z || z < REAR_Z || h < 0.2) return 0;
  const w = sideHalfWidth(z, rearWell);
  if (ax > w) return 0;
  let top = beltTop(z) - chamfer(ax, 0, w);
  // Central crease on the front boot.
  if (ax < 0.1 && z > 0.9 && z < 1.9) top += 0.04;
  if (h > top) return 0;
  return h < 0.28 ? M.carbon : M.paint;
}

function cabinTop(z: number): number {
  return knots(z, [[0.95, 0.82], [0.55, 1.1], [0.1, ROOF_H], [-0.65, ROOF_H], [-1.0, 1.14], [-1.2, 0.98]]);
}

function cabin(ax: number, h: number, z: number): number {
  if (z > 0.95 || z < -1.2 || h < 0.8) return 0;
  let top = cabinTop(z);
  // Double bubble: two ridges over the seats, a shallow valley on the centreline.
  if (h > 1.1 && z < 0.3 && z > -0.9) top += ax > 0.18 && ax < 0.5 ? 0.06 : 0;
  if (h > top) return 0;
  const t = clamp01((h - 0.86) / (ROOF_H - 0.86));
  const w = 0.8 - 0.2 * t;
  if (ax > w) return 0;
  if (h < 0.92) return M.paint;
  // Roof skin, pillars and the rear bulkhead are carbon; the rest is glass.
  if (h > top - 0.07) return M.carbon;
  if (ax > w - 0.08 && z > 0.4) return M.carbon; // A-pillar
  if (z < -0.95) return M.carbon; // bulkhead under the back light
  return M.glass;
}

/** Rear deck between the cabin and the tail: louvred engine cover with a ducktail lip. */
function rearDeck(ax: number, h: number, z: number): number {
  if (z > -1.0 || z < REAR_Z || h < 0.86) return 0;
  const top = knots(z, [[-1.0, 1.0], [-1.5, 0.96], [-1.95, 0.98], [-2.2, 1.06]]);
  if (h > top || ax > 0.84) return 0;
  // Ducktail: the last 0.2 m rises as a carbon lip.
  if (z < -2.0) return M.carbon;
  // Louvres: alternating dark slots across the cover.
  const slot = Math.floor((z + 1.0) / 0.16) % 2 === 1;
  return slot && ax < 0.6 && h > top - 0.05 ? M.intake : M.paint;
}

/** Nostril intake low on each rear quarter (feeds the rear engine). */
function nostril(ax: number, h: number, z: number, rearWell: Well | undefined): boolean {
  if (!rearWell) return false;
  const z0 = rearWell.z + rearWell.r + 0.08;
  return ax > 0.7 && z > z0 && z < z0 + 0.42 && h > 0.5 && h < 0.72;
}

const TIPS = [0.16];
function exhaustTips(ax: number, h: number, z: number): number {
  if (z > REAR_Z - 0.02 || z < REAR_Z - 0.14 || h < 0.3 || h > 0.4) return 0;
  for (const tip of TIPS) if (Math.abs(ax - tip) < 0.07) return Math.abs(ax - tip) < 0.035 ? M.exhaust : M.chrome;
  return 0;
}

function mirrors(ax: number, h: number, z: number): number {
  return z > 0.7 && z < 0.84 && h > 0.9 && h < 1.0 && ax > 0.8 && ax < 0.98 ? M.paint : 0;
}

function sample(wells: readonly Well[], rearWell: Well | undefined, ax: number, h: number, z: number): number {
  const tip = exhaustTips(ax, h, z);
  if (tip) return tip;
  if (inWells(wells, ax, h, z)) return 0;
  if (nostril(ax, h, z, rearWell)) return 0;
  return lowerBody(ax, h, z, rearWell) || cabin(ax, h, z) || rearDeck(ax, h, z) || mirrors(ax, h, z);
}

function paint(g: VoxelGrid, spec: VehicleSpec, wells: readonly Well[]): void {
  const rear = wells.find((w) => w.axle === 'rear');
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    if (m !== M.paint) return;
    const e = exposure(g, i, j, k);
    // Slim full-width light bar across the nose (no round lamps).
    if (z > FRONT_Z - 0.1 && e.front && h > 0.5 && h < 0.58 && ax < 0.66) return M.headlight;
    // Dark lower slot under the light bar.
    if (z > FRONT_Z - 0.1 && e.front && h > 0.3 && h < 0.44 && ax < 0.5) return M.grille;
    // Kamm tail: slim tail-light bar, plate recess between the lights, dark lower panel.
    if (z < REAR_Z + 0.1 && e.rear) {
      if (h > 0.78 && h < 0.86 && ax < 0.9) return M.tail;
      if (h > COUPE_PLATE_H - 0.12 && h < COUPE_PLATE_H + 0.12 && ax < 0.4) return M.paint2; // plate recess
      if (h < 0.5) return M.paint2;
    }
    // Nostril lips read dark.
    if (rear && e.side) {
      const z0 = rear.z + rear.r + 0.08;
      if (z > z0 - 0.08 && z < z0 + 0.5 && h > 0.44 && h < 0.78) return M.intake;
    }
    // Gold pinstripe along the belt line, dark arch trims.
    if (e.side && Math.abs(h - beltTop(z) + 0.1) < 0.04 && z > -1.9 && z < 1.9) return M.cyanStripe;
    for (const well of wells) {
      const d = wellDistance(well, h, z);
      if (e.side && d >= well.r && d < well.r + 0.08) return M.paint2;
    }
  });
}

function buildCoupeGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.04, 1.4, -2.36, 2.12);
  const wells = wheelWells(spec, { frontSteer: 0.15, bump: 0.05 });
  const rearWell = wells.find((w) => w.axle === 'rear');
  fillBody(g, spec, (ax, h, z) => sample(wells, rearWell, ax, h, z));
  paint(g, spec, wells);
  return g;
}

export const COUPE_MODEL: CarModelDef = {
  buildBody: buildCoupeGrid,
  livery: {
    [M.paint]: { color: '#D8201F', roughness: 0.28, metalness: 0.25, glow: 0.08, jitter: 0.03 },
    [M.paint2]: { color: '#141216', roughness: 0.5, metalness: 0.2 },
    [M.cyanStripe]: { color: '#F5C542', roughness: 0.4, metalness: 0.2, glow: 0.4 }, // gold pinstripe
    [M.rim]: { color: '#F5C542', roughness: 0.25, metalness: 0.5, glow: 0.35 },
    [M.hub]: { color: '#D8201F', roughness: 0.3, metalness: 0.2, glow: 0.6 },
    [M.sidewallBand]: { color: '#F5C542', roughness: 0.6, metalness: 0, glow: 0.2 },
  },
  wing: {
    pivot: [0, 0.22, FRONT_Z + 0.14],
    spanInnerX: 0,
    spanOuterX: 0.74,
    main: { chord: 0.16, thickness: 0.04, material: M.carbon },
    mainDeg: [-3, 18],
  },
  exhaust: [
    [TIPS[0]!, 0.35, REAR_Z - 0.14],
    [-TIPS[0]!, 0.35, REAR_Z - 0.14],
  ],
  wheel: { spokes: 5, bandSegments: 4, rimRatio: 0.68 },
  plates: { rear: { position: [0, COUPE_PLATE_H, REAR_Z] } },
};
