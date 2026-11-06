/**
 * Razorwing — an original open-wheel formula car, cyan with white and magenta accents.
 *
 *   nose     long raised needle nose on two pylons over a full-width two-element front wing
 *            (the animated part, FORMULA_MODEL.wing) between carbon endplates
 *   centre   narrow monocoque, open cockpit (the active driver's bust sits in it), a glowing halo, sidepods with
 *            dark intakes, carbon floor and wishbones out to the exposed wheels
 *   rear     airbox over the driver's head, tapering engine cover, tall rear wing on a centre
 *            pylon with magenta-edged endplates, rain light and a single central exhaust
 */
import type { VehicleSpec } from '../vehicleSpec';
import { M } from './carMaterial';
import { exposure, fillBody, makeBodyGrid, paintPass, type CarModelDef } from './shapeKit';
import { knots, type VoxelGrid } from './voxelGrid';

const NOSE_Z = 2.44;
const TAIL_Z = -2.22;

function nose(ax: number, h: number, z: number): number {
  if (z < 1.15 || z > NOSE_Z) return 0;
  const w = knots(z, [[2.44, 0.08], [2.0, 0.14], [1.5, 0.22], [1.15, 0.27]]);
  if (ax > w) return 0;
  const top = knots(z, [[2.44, 0.26], [2.0, 0.34], [1.5, 0.48], [1.15, 0.58]]);
  const bottom = knots(z, [[2.44, 0.16], [1.8, 0.22], [1.15, 0.16]]);
  return h <= top && h >= bottom ? M.paint : 0;
}

function nosePylons(ax: number, h: number, z: number): number {
  if (z < 2.1 || z > 2.3 || ax < 0.04 || ax > 0.12 || h < 0.1 || h > 0.24) return 0;
  return M.carbon;
}

function frontEndplates(ax: number, h: number, z: number): number {
  if (ax < 0.9 || ax > 0.98 || z < 2.1 || z > 2.56 || h < 0.06 || h > 0.32) return 0;
  return h > 0.26 ? M.aeroLed : M.carbon;
}

function monocoque(ax: number, h: number, z: number): number {
  if (z < -0.62 || z > 1.2) return 0;
  const w = knots(z, [[1.2, 0.27], [0.7, 0.34], [0.2, 0.38], [-0.62, 0.36]]);
  if (ax > w) return 0;
  const top = knots(z, [[1.2, 0.58], [0.75, 0.66], [0.2, 0.66], [-0.62, 0.72]]);
  if (h > top || h < 0.14) return 0;
  // Open cockpit: carved down to the seat.
  if (z > 0.06 && z < 0.74 && ax < 0.24 && h > 0.46) return 0;
  return M.paint;
}

function driver(ax: number, h: number, z: number): number {
  // The driver is no longer painted here: the active driver's bust (drivers/DriverBust.tsx) sits at
  // the seat anchor (ride/anchors.ts, h 0.6, z 0.32); only the seat / cockpit floor stays voxels.
  if (z > 0.06 && z < 0.5 && ax < 0.22 && h > 0.4 && h <= 0.48) return M.intake; // seat / cockpit floor
  return 0;
}

function halo(ax: number, h: number, z: number): number {
  // A thin wishbone loop over the cockpit rim (sides + rounded front) and its centre pillar.
  if (h > 0.9 && h < 0.98) {
    const front = 0.64 - 0.16 * (ax / 0.26) ** 2; // rounded front edge of the loop
    if (Math.abs(ax - 0.25) < 0.045 && z > 0.06 && z < front + 0.04) return M.carbon;
    if (ax < 0.27 && Math.abs(z - front) < 0.045) return M.carbon;
  }
  if (ax < 0.04 && z > 0.64 && z < 0.76 && h > 0.6 && h < 0.98) return M.carbon;
  return 0;
}

function airbox(ax: number, h: number, z: number): number {
  if (z > 0 || z < -0.62 || ax > 0.15) return 0;
  const top = knots(z, [[0, 0.98], [-0.2, 1.02], [-0.62, 0.84]]);
  if (h > top || h < 0.7) return 0;
  if (z > -0.08 && h > 0.84 && h < 0.98 && ax < 0.1) return M.intake;
  return M.paint;
}

function engineCover(ax: number, h: number, z: number): number {
  if (z > -0.6 || z < -2.04) return 0;
  const w = knots(z, [[-0.6, 0.36], [-1.3, 0.26], [-2.04, 0.12]]);
  if (ax > w) return 0;
  const top = knots(z, [[-0.6, 0.84], [-1.0, 0.76], [-1.5, 0.62], [-2.04, 0.46]]);
  return h <= top && h >= 0.16 ? M.paint : 0;
}

function sidepods(ax: number, h: number, z: number): number {
  if (z < -1.06 || z > 0.86 || ax < 0.28) return 0;
  const w = knots(z, [[0.86, 0.6], [0.3, 0.62], [-0.5, 0.56], [-1.06, 0.34]]);
  if (ax > w) return 0;
  const top = knots(z, [[0.86, 0.52], [0.3, 0.56], [-0.5, 0.5], [-1.06, 0.34]]);
  if (h > top || h < 0.16) return 0;
  // Intake mouth: two voxels deep.
  if (z > 0.7 && h > 0.26 && h < top - 0.06 && ax > 0.34 && ax < w - 0.06) return 0;
  return M.paint;
}

function floor(ax: number, h: number, z: number): number {
  if (h < 0.08 || h > 0.16) return 0;
  if (z > -1.2 && z < 1.1 && ax < 0.62) return M.carbon;
  // Diffuser fins at the back.
  if (z <= -1.2 && z > -2.1 && ax < 0.5 && Math.abs(ax - Math.round(ax / 0.16) * 0.16) < 0.04) return M.carbon;
  return 0;
}

function rearWing(ax: number, h: number, z: number): number {
  if (z > -1.86 || z < -2.32) return 0;
  if (ax < 0.8 && h > 0.86 && h < 0.94 && z > -2.22) return M.paint;
  if (ax < 0.8 && h > 0.98 && h < 1.06 && z < -2.08) return z < -2.24 ? M.magentaStripe : M.decal;
  if (ax >= 0.8 && ax < 0.88 && h > 0.5 && h < 1.1) return z < -2.24 ? M.magentaStripe : M.carbon;
  if (ax < 0.04 && h > 0.46 && h <= 0.86 && z > -2.12) return M.carbon; // centre pylon
  return 0;
}

function crashStructure(ax: number, h: number, z: number): number {
  if (z > -2.0 || z < TAIL_Z || ax > 0.1 || h < 0.28 || h > 0.56) return 0;
  if (ax < 0.06 && h < 0.4) return M.tail; // rain light
  if (ax < 0.05 && h > 0.46 && z < -2.14) return M.exhaust;
  return M.carbon;
}

/** Static wishbones from the tub to each wheel's upright (rest position). */
function wishbones(spec: VehicleSpec, ax: number, h: number, z: number): number {
  for (const w of spec.wheels) {
    if (w.side !== 'left') continue;
    const hubH = w.radius;
    const inner = w.axle === 'front' ? 0.24 : 0.3;
    const outer = Math.abs(w.connection[0]) - w.width / 2;
    if (ax < inner || ax > outer) continue;
    if (Math.abs(z - w.connection[2]) > 0.05) continue;
    if (Math.abs(h - (hubH + 0.08)) < 0.03 || Math.abs(h - (hubH - 0.1)) < 0.03) return M.carbon;
  }
  return 0;
}

function mirrors(ax: number, h: number, z: number): number {
  if (z > 0.62 && z < 0.74 && h > 0.6 && h < 0.7 && ax > 0.4 && ax < 0.56) return M.paint;
  return 0;
}

function sample(spec: VehicleSpec, ax: number, h: number, z: number): number {
  return (
    rearWing(ax, h, z) ||
    crashStructure(ax, h, z) ||
    frontEndplates(ax, h, z) ||
    nosePylons(ax, h, z) ||
    driver(ax, h, z) ||
    halo(ax, h, z) ||
    nose(ax, h, z) ||
    monocoque(ax, h, z) ||
    airbox(ax, h, z) ||
    engineCover(ax, h, z) ||
    sidepods(ax, h, z) ||
    floor(ax, h, z) ||
    wishbones(spec, ax, h, z) ||
    mirrors(ax, h, z)
  );
}

function paint(g: VoxelGrid, spec: VehicleSpec): void {
  paintPass(g, spec, (m, ax, h, z, i, j, k) => {
    const e = exposure(g, i, j, k);
    // Neon line along the top of the halo.
    if (m === M.carbon && h > 0.9 && h < 0.98 && e.top && z > 0.05 && z < 0.8) return M.cyanStripe;
    if (m !== M.paint) return;
    // White nose tip and a white spine stripe down the engine cover.
    if (z > 2.0) return M.decal;
    if (e.top && ax < 0.06 && z < -0.62) return M.decal;
    // Magenta edge along the sidepod tops, cyan glow on the airbox lip.
    if (e.top && ax > 0.5 && z > -0.9 && z < 0.86) return M.magentaStripe;
    // Small LED at the nose tip (headlight channel) so the car still "lights up".
    if (z > 2.34 && e.front) return M.headlight;
    // Rear of the sidepods and engine cover: dark cooling exits.
    if (e.rear && z < -0.95 && z > -1.1 && ax > 0.28) return M.intake;
  });
}

function buildFormulaGrid(spec: VehicleSpec): VoxelGrid {
  const g = makeBodyGrid(spec, 1.0, 1.14, -2.34, 2.6, 0.06);
  fillBody(g, spec, (ax, h, z) => sample(spec, ax, h, z));
  paint(g, spec);
  return g;
}

export const FORMULA_MODEL: CarModelDef = {
  buildBody: buildFormulaGrid,
  livery: {
    [M.paint]: { color: '#12D3EE', roughness: 0.32, metalness: 0.15, glow: 0.1, jitter: 0.03 },
    [M.paint2]: { color: '#F5E663', roughness: 0.3, metalness: 0.1, glow: 0.35 }, // helmet
    [M.rim]: { color: '#FF2A6D', roughness: 0.3, metalness: 0.3, glow: 0.7 },
    [M.hub]: { color: '#F4F7FB', roughness: 0.3, metalness: 0.2, glow: 0.5 },
    [M.sidewallBand]: { color: '#F5E663', roughness: 0.6, metalness: 0, glow: 0.3 },
  },
  wing: {
    pivot: [0, 0.13, NOSE_Z + 0.1],
    spanInnerX: 0,
    spanOuterX: 0.9,
    main: { chord: 0.3, thickness: 0.05, material: M.paint },
    upper: { chord: 0.2, thickness: 0.04, material: M.decal, hingeY: 0.05, hingeOverlap: 0.04 },
    mainDeg: [1, 16],
    upperDeg: [6, 46],
  },
  exhaust: [[0, 0.51, TAIL_Z + 0.02]],
  wheel: { spokes: 5, bandSegments: 2, rimRatio: 0.62, disc: false },
};
