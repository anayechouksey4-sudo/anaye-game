/**
 * The voxel hypercar body: an original, track-focused design drawn from analytic shape functions
 * sampled on a 0.08 m grid, then a few surface-paint passes (lights, stripes, louvres, intakes).
 *
 * Shape vocabulary (chassis frame, +Z = nose, +X = driver's left; heights `h` are measured from
 * the ground at rest, y = h − RIDE_HEIGHT):
 *   nose      very low pointed beak between two front-fender pods, with aero tunnels between
 *   front     carbon splitter + endplates (the animated flaps live in frontWing.ts)
 *   cabin     cab-forward canopy with tumblehome, tinted glass (with a reflection streak) under a
 *             carbon roof and A-pillars, painted flying buttresses
 *   sides     carbon scallop sweeping up the flank into a deep intake ahead of the rear wheel,
 *             neon edge lines, carbon sills
 *   rear      muscular haunches, louvred engine cover, shark fin, open rear-wheel area,
 *             diffuser with fins + rain light, twin centre exhausts, full-width tail-light bar
 *   wing      high rear wing hung from swan-neck pylons, endplates with neon trailing edges
 * The wheel wells are carved from the wheel spec (steering + bump clearance), so the body always
 * matches the physics footprint in vehicleSpec.ts.
 */
import { RIDE_HEIGHT, WHEELS, wheelRestCenterY } from '../vehicleSpec';
import { M } from './carMaterial';
import { VoxelGrid, clamp01, knots, smoothstep } from './voxelGrid';

export const BODY_VOXEL = 0.08;
const NX = 27; // x centres −1.04 … +1.04 (odd → a centre column at x = 0)
const NY = 18; // h centres 0.14 … 1.50
const NZ = 59; // z centres −2.32 … +2.32
/** Ground-relative height of the grid's bottom face. */
const H0 = 0.1;

/** Rear exhaust outlets (chassis frame) — the CarModel puts the flame sprites here. */
export const EXHAUST_OUTLETS: readonly (readonly [number, number, number])[] = [
  [0.12, 0.5 - RIDE_HEIGHT, -2.36],
  [-0.12, 0.5 - RIDE_HEIGHT, -2.36],
];

// ── Wheel wells (from the physics wheel spec) ───────────────────────────────────────────────────

/** Radial clearance around the tyre, and extra room above it for suspension compression. */
const WELL_MARGIN = 0.05;
const WELL_BUMP = 0.04;
/** Inboard clearance: front wheels sweep inward when steered (±0.58 rad at standstill). */
const FRONT_STEER_CLEARANCE = 0.16;
const REAR_INBOARD_CLEARANCE = 0.05;

interface Well {
  z: number;
  h: number;
  r: number;
  innerX: number;
}

const WELLS: Well[] = (() => {
  const byAxle = new Map<string, Well>();
  for (const w of WHEELS) {
    if (byAxle.has(w.axle)) continue;
    const inboard = w.axle === 'front' ? FRONT_STEER_CLEARANCE : REAR_INBOARD_CLEARANCE;
    byAxle.set(w.axle, {
      z: w.connection[2],
      h: wheelRestCenterY(w) + RIDE_HEIGHT,
      r: w.radius + WELL_MARGIN,
      innerX: Math.abs(w.connection[0]) - w.width / 2 - inboard,
    });
  }
  return [...byAxle.values()];
})();

function wellDistance(well: Well, h: number, z: number): number {
  const dz = z - well.z;
  let dh = h - well.h;
  if (dh > 0) dh = Math.max(0, dh - WELL_BUMP);
  return Math.sqrt(dz * dz + dh * dh);
}

function inWheelWell(ax: number, h: number, z: number): boolean {
  for (const well of WELLS) if (ax >= well.innerX && wellDistance(well, h, z) < well.r) return true;
  return false;
}

// ── Carved regions ─────────────────────────────────────────────────────────────────────────────

/**
 * Side scallop: a one-voxel-deep carbon recess sweeping up the flank from behind the front wheel,
 * ending in a deep, dark intake just ahead of the rear wheel. Carved as a post-pass (it follows
 * whatever the outer skin is at that height).
 */
const SCALLOP_FRONT_Z = 0.88;
const SCALLOP_REAR_Z = -0.9;
const SCALLOP_LOW_H = 0.26;
function scallopTop(z: number): number {
  return knots(z, [[0.88, 0.34], [0.3, 0.38], [-0.3, 0.5], [-0.9, 0.66]]);
}
const INTAKE_FRONT_Z = -0.42;
const INTAKE_DEPTH_VOXELS = 4;

const DIFFUSER_START_Z = -1.86;
const DIFFUSER_FINS = [0, 0.24, 0.48];
function diffuserRoof(z: number): number {
  return 0.12 + 0.3 * smoothstep(DIFFUSER_START_Z, -2.36, z);
}
function isDiffuserFin(ax: number): boolean {
  return DIFFUSER_FINS.some((f) => Math.abs(ax - f) < 0.04);
}
function inDiffuserChannel(ax: number, h: number, z: number): boolean {
  return z < DIFFUSER_START_Z && ax < 0.62 && h < diffuserRoof(z) && !isDiffuserFin(ax);
}

/** Behind the rear wheels the bodywork stops above the tyre, leaving them exposed (track-car style). */
function inExposedRearWheelArea(ax: number, h: number, z: number): boolean {
  return z < -1.62 && ax > 0.62 && h < 0.6;
}

// ── Solid parts ────────────────────────────────────────────────────────────────────────────────
// Tops are flat across the car with a one-voxel chamfer at the edges: clean planes read as
// deliberate voxel design, where smooth curves would just turn into noisy terraces.

/** One voxel lower within a voxel of either edge of [inner, outer]. */
function chamfer(ax: number, inner: number, outer: number): number {
  return (ax > outer - BODY_VOXEL * 1.05 ? BODY_VOXEL : 0) + (inner > 0 && ax < inner + BODY_VOXEL * 1.05 ? BODY_VOXEL : 0);
}

function noseHalfWidth(z: number): number {
  return knots(z, [[2.36, 0.2], [2.1, 0.3], [1.7, 0.4], [1.0, 0.44]]);
}

function noseCone(ax: number, h: number, z: number): number {
  if (z < 0.95 || z > 2.36) return 0;
  const w = noseHalfWidth(z);
  if (ax > w) return 0;
  const top = knots(z, [[2.36, 0.26], [2.1, 0.3], [1.6, 0.42], [1.05, 0.56], [0.95, 0.57]]) - chamfer(ax, 0, w);
  return h <= top ? M.paint : 0;
}

const POD_INNER_X = 0.58;
function podOuterX(z: number): number {
  return knots(z, [[1.96, 0.9], [1.8, 0.98], [1.55, 1.02], [1.0, 1.0], [0.7, 0.97]]);
}
function frontPods(ax: number, h: number, z: number): number {
  if (z < 0.7 || z > 1.96 || ax < POD_INNER_X) return 0;
  const outer = podOuterX(z);
  if (ax > outer) return 0;
  const crest = knots(z, [[1.96, 0.34], [1.8, 0.52], [1.55, 0.8], [1.35, 0.88], [1.1, 0.84], [0.85, 0.7], [0.7, 0.6]]);
  const top = crest - chamfer(ax, POD_INNER_X, outer);
  return h <= top ? M.paint : 0;
}

/** Aero tunnel floor between the nose and the pods: ramps from the splitter up to the hood. */
function hoodTunnel(ax: number, h: number, z: number): number {
  if (z < 0.95 || z > 1.96 || ax < noseHalfWidth(z) || ax >= POD_INNER_X) return 0;
  const floor = knots(z, [[1.96, 0.18], [1.3, 0.44], [1.0, 0.55]]);
  return h <= floor ? M.paint : 0;
}

function splitter(ax: number, h: number, z: number): number {
  if (h > 0.18 || z < 1.8 || ax > 1.0) return 0;
  return z <= 2.36 - 0.22 * ax * ax ? M.carbon : 0;
}

const ENDPLATE_X = 0.96;
function frontEndplate(ax: number, h: number, z: number): number {
  if (Math.abs(ax - ENDPLATE_X) >= 0.04 || z < 1.84 || z > 2.28) return 0;
  const top = 0.3 + 0.16 * smoothstep(2.28, 1.84, z);
  if (h > top) return 0;
  return h > top - 0.08 ? M.aeroLed : M.carbon;
}

function cockpitTub(ax: number, h: number, z: number): number {
  if (z < -0.8 || z > 1.05) return 0;
  const w = knots(z, [[1.05, 0.98], [0.4, 0.98], [-0.2, 0.98], [-0.8, 1.0]]);
  if (ax > w) return 0;
  const top = knots(z, [[1.05, 0.56], [0.4, 0.56], [-0.3, 0.58], [-0.8, 0.62]]) - 0.06 * (ax / w) ** 6;
  return h <= top ? M.paint : 0;
}

const ROOF_H = 1.12;
const BELT_H = 0.56;
function canopyTop(z: number): number {
  return knots(z, [[1.1, 0.56], [0.8, 0.78], [0.45, 0.98], [0.15, 1.1], [-0.4, ROOF_H], [-0.85, 1.0], [-1.4, 0.74]]);
}
function canopyHalfWidth(h: number, z: number): number {
  const tumblehome = 0.72 - 0.26 * clamp01((h - BELT_H) / (ROOF_H - BELT_H));
  return tumblehome * knots(z, [[1.1, 0.8], [0.7, 1.0], [-0.7, 1.0], [-1.4, 0.75]]);
}
function canopy(ax: number, h: number, z: number): number {
  if (z < -1.4 || z > 1.1 || h < 0.5 || h > canopyTop(z)) return 0;
  const w = canopyHalfWidth(h, z);
  if (ax > w) return 0;
  if (h < BELT_H + 0.04) return M.paint;
  if (z >= -0.5) {
    // Carbon roof and A-pillars over dark glass: the "floating roof" two-tone.
    if (ax >= w - 0.085 && z > 0.12) return M.carbon;
    if (h >= 1.06 && z < 0.12) return M.carbon;
    if (z < -0.5 + (h - 0.6) * 0.9) return M.paint; // raked rear edge of the side window
    return M.glass;
  }
  // Behind the cabin: painted flying buttresses either side of a glass engine window.
  return ax < 0.3 ? M.glass : M.paint;
}

function haunchOuterX(z: number): number {
  return knots(z, [[-0.55, 0.99], [-0.95, 1.06], [-1.85, 1.07], [-2.1, 1.04], [-2.26, 0.98]]);
}
function haunchCrest(z: number): number {
  return knots(z, [[-0.55, 0.62], [-0.9, 0.84], [-1.35, 0.97], [-1.85, 0.93], [-2.26, 0.78]]);
}
function haunches(ax: number, h: number, z: number): number {
  if (z < -2.26 || z > -0.55 || ax < 0.54) return 0;
  const outer = haunchOuterX(z);
  if (ax > outer) return 0;
  const top = haunchCrest(z) - chamfer(ax, 0.54, outer);
  return h <= top ? M.paint : 0;
}

function engineCoverTop(z: number): number {
  return knots(z, [[-0.4, 0.98], [-1.0, 0.92], [-1.6, 0.86], [-2.28, 0.74]]);
}
function engineCover(ax: number, h: number, z: number): number {
  if (z < -2.28 || z > -0.4 || ax > 0.46) return 0;
  return h <= engineCoverTop(z) ? M.paint : 0;
}

/** Low channel between the engine cover and each haunch. */
function valley(ax: number, h: number, z: number): number {
  if (z < -2.28 || z > -0.55 || ax <= 0.46 || ax >= 0.54) return 0;
  return h <= Math.min(engineCoverTop(z), haunchCrest(z) - 0.15) - 0.1 ? M.paint : 0;
}

function tailFascia(ax: number, h: number, z: number): number {
  if (z > -2.18 || ax > 1.0) return 0;
  // Twin centre exhausts protrude one voxel past the fascia, in a carbon housing.
  if (z < -2.28) {
    if (ax <= 0.24 && h > 0.38 && h < 0.62) return ax > 0.04 && ax < 0.2 && h > 0.42 && h < 0.58 ? M.exhaust : M.carbon;
    return 0;
  }
  const top = 0.74 - 0.06 * ax ** 4;
  if (h > top) return 0;
  // Race-style rain light on the centre diffuser fin (brake channel).
  if (ax < 0.04 && h > 0.18 && h < 0.34) return M.tail;
  if (ax < 0.66 && h > 0.36 && h < 0.58) return M.grille;
  return h < 0.36 ? M.carbon : M.paint;
}

function sharkFin(ax: number, h: number, z: number): number {
  if (ax >= 0.04 || z < -2.05 || z > -0.4) return 0;
  return h <= knots(z, [[-0.4, 1.1], [-1.1, 1.08], [-1.7, 1.0], [-2.05, 0.86]]) ? M.paint : 0;
}

function mirrors(ax: number, h: number, z: number): number {
  if (z > 0.6 && z < 0.68 && h > 0.66 && h < 0.74 && ax >= 0.66 && ax < 0.9) return M.carbon;
  if (z > 0.56 && z < 0.76 && h > 0.66 && h < 0.82 && ax >= 0.88 && ax < 1.04) return z < 0.6 ? M.carbon : M.paint;
  return 0;
}

const WING_SPAN_X = 0.98;
function rearWing(ax: number, h: number, z: number): number {
  if (z > -1.6) return 0;
  // Main plane + upper flap, stepped so the section reads as an angled two-element wing.
  if (ax <= WING_SPAN_X) {
    if (h > 1.3 && h < 1.38 && z > -2.2 && z < -1.88) return M.paint;
    if (h > 1.38 && h < 1.46 && z > -2.36 && z < -2.12) return z < -2.28 ? M.magentaStripe : M.paint;
  }
  // Endplates: angular trapezoids with a neon trailing edge.
  if (ax > 1.0 && ax < 1.08 && z > -2.36 && z < -1.84 && h > 1.18 && h < 1.54) {
    // Leading edge raked back: the plate is taller at the trailing edge.
    if (h < 1.18 + (z + 2.36) * 0.6) return 0;
    return z < -2.28 ? M.magentaStripe : M.paint;
  }
  // Swan-neck pylons: up from the engine cover, over the leading edge, down onto the wing's top.
  if (ax > 0.28 && ax < 0.36) {
    if (z > -1.72 && z < -1.64 && h > 0.7 && h < 1.54) return M.carbon;
    if (h > 1.46 && h < 1.54 && z > -2.04 && z < -1.64) return M.carbon;
    if (h > 1.38 && h < 1.46 && z > -2.08 && z < -1.96) return M.carbon;
  }
  return 0;
}

/** Material at a cell centre (chassis x, ground-relative h, chassis z); 0 = empty. */
function sampleBody(x: number, h: number, z: number): number {
  const ax = Math.abs(x);
  const wing = rearWing(ax, h, z);
  if (wing) return wing;
  if (inWheelWell(ax, h, z) || inDiffuserChannel(ax, h, z) || inExposedRearWheelArea(ax, h, z)) return 0;
  // Below the tail-light bar the rear fascia (grille, exhausts, rain light) overrides the deck shapes.
  if (z < -2.18 && h < 0.6) return tailFascia(ax, h, z);
  const m =
    splitter(ax, h, z) ||
    frontEndplate(ax, h, z) ||
    noseCone(ax, h, z) ||
    frontPods(ax, h, z) ||
    hoodTunnel(ax, h, z) ||
    cockpitTub(ax, h, z) ||
    canopy(ax, h, z) ||
    haunches(ax, h, z) ||
    engineCover(ax, h, z) ||
    valley(ax, h, z) ||
    tailFascia(ax, h, z) ||
    sharkFin(ax, h, z) ||
    mirrors(ax, h, z);
  // Everything in the bottom layer (floor, sills, splitter) is carbon.
  if (m === M.paint && h < 0.18) return M.carbon;
  return m;
}

// ── Surface paint passes ───────────────────────────────────────────────────────────────────────

function paintPasses(g: VoxelGrid): void {
  const [nx, ny, nz] = g.n;
  const hOf = (j: number) => g.cy(j) + RIDE_HEIGHT;
  const recolor: [number, number, number, number][] = [];

  // Louvres: every other row of the engine cover top is cut one voxel deep.
  for (let k = 0; k < nz; k++) {
    const z = g.cz(k);
    if (z < -2.02 || z > -1.34 || k % 2 !== 0) continue;
    for (let i = 0; i < nx; i++) {
      const ax = Math.abs(g.cx(i));
      if (ax < 0.06 || ax > 0.26) continue;
      for (let j = ny - 1; j >= 0; j--) {
        if (!g.filled(i, j, k)) continue;
        if (g.get(i, j, k) === M.paint && hOf(j) > 0.6) {
          g.set(i, j, k, M.empty);
          if (g.filled(i, j - 1, k)) g.set(i, j - 1, k, M.intake);
        }
        break;
      }
    }
  }

  g.forEachFilled((i, j, k, m) => {
    const x = g.cx(i);
    const ax = Math.abs(x);
    const h = hOf(j);
    const z = g.cz(k);
    const outward = x >= 0 ? 1 : -1;
    const topExposed = !g.filled(i, j + 1, k);
    const sideExposed = !g.filled(i + outward, j, k);
    const rearExposed = !g.filled(i, j, k - 1);
    const frontExposed = !g.filled(i, j, k + 1);

    // Slashed headlights across the front of each fender pod.
    if (m === M.paint && z > 1.62 && ax > 0.6 && ax < 0.99 && (topExposed || frontExposed)) {
      const lineZ = 1.72 + 0.18 * ((ax - 0.6) / 0.38);
      if (Math.abs(z - lineZ) < 0.045) recolor.push([i, j, k, M.headlight]);
    }

    // Tail-light bar across the rear, wrapping down the haunch ends in a C.
    if ((m === M.paint || m === M.grille) && z < -2.08 && rearExposed) {
      const bar = h > 0.58 && h < 0.66;
      const corner = ax > 0.82 && h > 0.58 && h < 0.74;
      if (bar || corner) recolor.push([i, j, k, M.tail]);
    }

    // Neon line along the top of the carbon sill, between the wheels.
    if (sideExposed && h > 0.18 && h < 0.26 && z > -0.92 && z < 0.92 && ax > 0.8) recolor.push([i, j, k, M.cyanStripe]);

    // Carbon trim around the wheel-arch openings.
    if (sideExposed && ax > 0.88 && m === M.paint) {
      for (const well of WELLS) {
        const d = wellDistance(well, h, z);
        if (d >= well.r && d < well.r + 0.09) recolor.push([i, j, k, M.carbon]);
      }
    }

    // Diffuser fins and roof read as carbon.
    if (m !== M.tail && z < DIFFUSER_START_Z && ax < 0.62 && h < diffuserRoof(z) + 0.09) recolor.push([i, j, k, M.carbon]);

    // Neon spine along the top of the shark fin.
    if (ax < 0.04 && z < -0.4 && z > -2.06 && topExposed && h > 0.9) recolor.push([i, j, k, M.cyanStripe]);

    // Carbon centre stripe over the nose.
    if (m === M.paint && topExposed && ax < 0.1 && z > 0.9) recolor.push([i, j, k, M.carbon]);

    // A diagonal reflection streak across the windscreen sells the glass.
    if (m === M.glass && topExposed && z > 0.15 && Math.abs(z - (0.6 - 0.5 * x)) < 0.05) recolor.push([i, j, k, M.glassStreak]);
  });

  for (const [i, j, k, m] of recolor) g.set(i, j, k, m);
}

function carveSideScallops(g: VoxelGrid): void {
  const [nx, ny, nz] = g.n;
  const intakeCells: [number, number, number][] = [];
  for (let k = 0; k < nz; k++) {
    const z = g.cz(k);
    if (z > SCALLOP_FRONT_Z || z < SCALLOP_REAR_Z) continue;
    const top = scallopTop(z);
    for (let j = 0; j < ny; j++) {
      const h = g.cy(j) + RIDE_HEIGHT;
      if (h < SCALLOP_LOW_H || h > top) continue;
      const deep = z < INTAKE_FRONT_Z && h < top - 0.04;
      for (const side of [1, -1]) {
        // Outermost filled cell on this side of the row.
        let i0 = side > 0 ? nx - 1 : 0;
        while (g.inBounds(i0, j, k) && !g.filled(i0, j, k)) i0 -= side;
        if (!g.inBounds(i0, j, k) || g.get(i0, j, k) !== M.paint) continue;
        const depth = deep ? INTAKE_DEPTH_VOXELS : 1;
        for (let d = 0; d < depth; d++) {
          g.set(i0 - side * d, j, k, M.empty);
          if (deep) intakeCells.push([i0 - side * d, j, k]);
        }
        const back = i0 - side * depth;
        if (g.filled(back, j, k)) g.set(back, j, k, deep ? M.intake : M.carbon);
        // Neon edge along the scallop's upper boundary.
        if (h + BODY_VOXEL > top) {
          let e = side > 0 ? nx - 1 : 0;
          while (g.inBounds(e, j + 1, k) && !g.filled(e, j + 1, k)) e -= side;
          if (g.get(e, j + 1, k) === M.paint) g.set(e, j + 1, k, M.cyanStripe);
        }
      }
    }
  }
  // Every wall around the deep intake is dark.
  const n: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const [i, j, k] of intakeCells)
    for (const [di, dj, dk] of n) {
      const m = g.get(i + di, j + dj, k + dk);
      if (m === M.paint || m === M.carbon) g.set(i + di, j + dj, k + dk, M.intake);
    }
}

/** Fills and paints the body grid (chassis frame). */
export function buildHypercarGrid(): VoxelGrid {
  const grid = new VoxelGrid(
    [NX, NY, NZ],
    [BODY_VOXEL, BODY_VOXEL, BODY_VOXEL],
    [(-NX * BODY_VOXEL) / 2, H0 - RIDE_HEIGHT, (-NZ * BODY_VOXEL) / 2],
  );
  grid.fill((x, y, z) => sampleBody(x, y + RIDE_HEIGHT, z));
  carveSideScallops(grid);
  paintPasses(grid);
  return grid;
}
