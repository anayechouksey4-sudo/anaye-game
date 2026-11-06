/**
 * Smoke Lantern — an original front-engined drift coupe in teal with gold lantern roundels.
 *
 *   front    long, flat bonnet with two dark vents, a wide dark mouth under slim rectangular lamps,
 *            a red tow hook on the bumper, the animated deep splitter (DRIFT_MODEL.wing)
 *   cabin    set far back, raked screen, body-colour roof, small side glass, thick C-pillars
 *   sides    bolted-on box over-fenders with chrome rivets around every wheel, a gold lantern
 *            roundel on each door, a side-exit exhaust ahead of the right rear wheel
 *   rear     short boot with a tall black rear wing on two uprights (static voxels; the gold edge
 *            is its trailing edge), split tail-lamp strips, a dark lower panel and the plate
 *            recess between the lamps (the textured plate hangs there: DRIFT_MODEL.plates)
 * No real car's lamps, grille or flyline: the drift look is the over-fenders, the big wing, the
 * side pipe and the lanterns, and the physics do the rest (low grip, 45° of steering lock).
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { chamfer, exposure, fillBody, inWells, makeBodyGrid, paintPass, wellDistance, wheelWells, type CarModelDef, type Well } from './shapeKit';
import { clamp01, knots, type VoxelGrid } from './voxelGrid';

const FRONT_Z = 2.3;
const REAR_Z = -2.25;
const ROOF_H = 1.26;
const WING_H = 1.3;
export const DRIFT_PLATE_H = 0.6;

function sideHalfWidth(z: number): number {
  return knots(z, [[2.3, 0.78], [2.1, 0.88], [1.6, 0.92], [0.2, 0.92], [-1.6, 0.93], [-2.25, 0.86]]);
}

/** Low, long and flat: the bonnet barely rises from the lamps to the screen. */
function beltTop(z: number): number {
  return knots(z, [[2.3, 0.6], [2.16, 0.68], [1.0, 0.78], [0.3, 0.82], [-0.8, 0.86], [-1.6, 0.9], [-2.25, 0.88]]);
}

function lowerBody(ax: number, h: number, z: number): number {
  if (z > FRONT_Z || z < REAR_Z || h < 0.2) return 0;
  const w = sideHalfWidth(z);
  if (ax > w) return 0;
  const top = beltTop(z) - chamfer(ax, 0, w);
  if (h > top) return 0;
  return h < 0.3 ? M.carbon : M.paint;
}

/** Bolted-on box over-fenders: a flat-topped flare one voxel proud of the flank around each wheel. */
function overFender(wells: readonly Well[], ax: number, h: number, z: number): number {
  for (const well of wells) {
    const dz = Math.abs(z - well.z);
    if (dz > well.r + 0.1) continue;
    const w = sideHalfWidth(z);
    if (ax < w - 0.02 || ax > w + 0.1) continue;
    const top = well.h + well.r + 0.1;
    if (h < well.h - 0.02 || h > top) continue;
    // Open lower corners ahead of and behind the tyre, so the box reads as an arch.
    if (dz > well.r && h < well.h + 0.2) continue;
    return M.paint2;
  }
  return 0;
}

function cabinTop(z: number): number {
  return knots(z, [[0.5, 0.84], [0.05, 1.12], [-0.4, ROOF_H], [-1.05, ROOF_H], [-1.45, 1.1], [-1.7, 0.92]]);
}

function cabin(ax: number, h: number, z: number): number {
  if (z > 0.5 || z < -1.7 || h < 0.8) return 0;
  const top = cabinTop(z);
  if (h > top) return 0;
  const t = clamp01((h - 0.86) / (ROOF_H - 0.86));
  const w = 0.82 - 0.2 * t;
  if (ax > w) return 0;
  if (h < 0.92) return M.paint;
  if (h > top - 0.07) return M.paint; // roof skin
  if (ax > w - 0.08 && z > 0.05) return M.paint; // A-pillar
  if (z < -1.3) return M.paint; // thick C-pillar / sail panel
  return M.glass;
}

/** Tall rear wing on two uprights, gold trailing edge, carbon endplates. */
function rearWing(ax: number, h: number, z: number): number {
  if (z > -1.75 || z < -2.42) return 0;
  if (Math.abs(ax - 0.52) < 0.05 && z > -2.1 && z < -1.95 && h > 0.86 && h < WING_H + 0.02) return M.carbon;
  if (ax <= 0.9 && h > WING_H && h < WING_H + 0.08 && z > -2.3 && z < -1.98) return z < -2.24 ? M.cyanStripe : M.carbon;
  if (ax > 0.9 && ax < 0.98 && z > -2.34 && z < -1.94 && h > WING_H - 0.1 && h < WING_H + 0.22) return M.carbon;
  return 0;
}

/** Side-exit exhaust on the driver's right (−X), ahead of the rear wheel: the flame trails back along the sill. */
function sidePipe(x: number, h: number, z: number): number {
  if (x > -0.86 || x < -1.02 || h < 0.3 || h > 0.4 || z > -0.4 || z < -0.62) return 0;
  return z < -0.56 ? M.exhaust : M.chrome;
}

function towHook(x: number, h: number, z: number): number {
  return x > 0.42 && x < 0.52 && z > FRONT_Z - 0.02 && z < FRONT_Z + 0.1 && h > 0.34 && h < 0.42 ? M.magentaStripe : 0;
}

function mirrors(ax: number, h: number, z: number): number {
  return z > 0.4 && z < 0.52 && h > 0.9 && h < 0.98 && ax > 0.82 && ax < 0.98 ? M.paint : 0;
}

function sample(wells: readonly Well[], ax: number, h: number, z: number, x: number): number {
  const wing = rearWing(ax, h, z);
  if (wing) return wing;
  const pipe = sidePipe(x, h, z);
  if (pipe) return pipe;
  const hook = towHook(x, h, z);
  if (hook) return hook;
  if (inWells(wells, ax, h, z)) return 0;
  return overFender(wells, ax, h, z) || lowerBody(ax, h, z) || cabin(ax, h, z) || mirrors(ax, h, z);
}

function paint(g: VoxelGrid, spec: VehicleSpec, wells: readonly Well[]): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    const e = exposure(g, i, j, k);
    // Chrome rivets along the top edge of each over-fender.
    if (m === M.paint2 && e.side) {
      for (const well of wells) {
        if (Math.abs(z - well.z) > well.r + 0.1) continue;
        if (h > well.h + well.r + 0.02 && Math.floor((z + 10) / 0.16) % 2 === 0) return M.chrome;
      }
      return;
    }
    if (m !== M.paint) return;
    if (z > FRONT_Z - 0.1 && e.front) {
      // Slim rectangular lamps over a wide dark mouth.
      if (h > 0.52 && h < 0.6 && ax > 0.34 && ax < 0.74) return M.headlight;
      if (h > 0.3 && h < 0.52 && ax < 0.62) return M.grille;
    }
    // Two dark bonnet vents.
    if (e.top && z > 1.25 && z < 1.55 && ax > 0.26 && ax < 0.5) return M.intake;
    // Rear: split tail-lamp strips, plate recess, dark lower panel.
    if (z < REAR_Z + 0.1 && e.rear) {
      if (h > 0.7 && h < 0.8 && ax > 0.3 && ax < 0.86) return M.tail;
      if (h > DRIFT_PLATE_H - 0.1 && h < DRIFT_PLATE_H + 0.1 && ax < 0.4) return M.paint2;
      if (h < 0.5) return M.paint2;
    }
    if (e.side) {
      // Gold lantern roundel on each door.
      const r = Math.hypot(z + 0.35, h - 0.6);
      if (r < 0.17) return r >= 0.1 ? M.decal : M.paint2;
      // Dark arch trims.
      for (const well of wells) {
        const d = wellDistance(well, h, z);
        if (d >= well.r && d < well.r + 0.08) return M.paint2;
      }
    }
  });
}

function buildDriftGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.06, 1.56, -2.46, 2.44);
  const wells = wheelWells(spec, { frontSteer: 0.15, bump: 0.05 });
  fillBody(g, spec, (ax, h, z, x) => sample(wells, ax, h, z, x));
  paint(g, spec, wells);
  return g;
}

export const DRIFT_MODEL: CarModelDef = {
  buildBody: buildDriftGrid,
  livery: {
    [M.paint]: { color: '#0F6B6B', roughness: 0.35, metalness: 0.2, glow: 0.06, jitter: 0.03 },
    [M.paint2]: { color: '#15161A', roughness: 0.5, metalness: 0.2 },
    [M.cyanStripe]: { color: '#F5C542', roughness: 0.4, metalness: 0.2, glow: 0.5 }, // wing trailing edge
    [M.decal]: { color: '#F0B429', roughness: 0.4, metalness: 0.1, glow: 0.35 }, // lantern roundels
    [M.magentaStripe]: { color: '#FF3B2F', roughness: 0.4, metalness: 0.1, glow: 0.4 }, // tow hook
    [M.rim]: { color: '#E8B83A', roughness: 0.25, metalness: 0.6, glow: 0.25 },
    [M.hub]: { color: '#15161A', roughness: 0.4, metalness: 0.3, glow: 0.1 },
    [M.sidewallBand]: { color: '#F5C542', roughness: 0.6, metalness: 0, glow: 0.2 },
  },
  wing: {
    pivot: [0, 0.2, FRONT_Z + 0.16],
    spanInnerX: 0,
    spanOuterX: 0.86,
    main: { chord: 0.18, thickness: 0.04, material: M.carbon },
    mainDeg: [-4, 20],
  },
  exhaust: [[-0.95, 0.35, -0.6]],
  wheel: { spokes: 6, bandSegments: 0, rimRatio: 0.7 },
  plates: { rear: { position: [0, DRIFT_PLATE_H, REAR_Z] } },
};
