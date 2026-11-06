/**
 * Turns a track plan into ONE merged voxel geometry for everything that never moves:
 * deck slabs + voxel tiles + glowing grout, neon edge strips, hanging pylons, kerbs, ramp fills,
 * gantries and gate arches. ~2k boxes, one draw call (plus one in the shadow pass). Colours come
 * from the plan's palette (the chaos palette is the original look).
 */
import { Color, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import { COLORS, DECK } from './config';
import type { ChaosTrackPlan, DeckBox, DeckStyle, GlowColor } from './plan';
import { CHAOS_PALETTE, type TrackPalette } from './recipe';
import { mulberry32, type Rng } from './rng';
import { VoxelBuilder } from './voxel';

/** The chaos track's neon colours by name (other maps: `plan.palette.glow`). */
export const GLOW_HEX: Record<GlowColor, string> = CHAOS_PALETTE.glow;

const GROUT: Record<DeckStyle, GlowColor> = {
  start: 'cyan',
  deck: 'cyan',
  stripes: 'yellow',
  hazard: 'magenta',
  ramp: 'magenta',
  landing: 'green',
  finish: 'green',
};

const PYLON_SPACING = 32;
const PYLON_LENGTH = 80;
const _c = new Color();
const _q = new Quaternion();
const _x = new Vector3(1, 0, 0);
const _p = new Vector3();
const _one = new Vector3(1, 1, 1);

/** Subtle per-tile lightness variation (and the odd accent tile) so the floor reads as voxels. */
function tileColor(palette: TrackPalette, style: DeckStyle, ix: number, iz: number, rng: Rng): { color: string; glow: number } {
  if (style === 'stripes') {
    return (ix + iz) % 2 === 0 ? { color: COLORS.yellow, glow: 0.22 } : { color: COLORS.black, glow: 0 };
  }
  const roll = rng();
  if (roll < 0.04) return { color: style === 'ramp' ? palette.tileAccentRamp : palette.tileAccent, glow: 0.3 };
  _c.set(palette.tile[style]);
  const hsl = { h: 0, s: 0, l: 0 };
  _c.getHSL(hsl);
  _c.setHSL(hsl.h + (rng() - 0.5) * 0.03, hsl.s, Math.max(0, hsl.l * (0.78 + rng() * 0.44)));
  return { color: `#${_c.getHexString()}`, glow: 0 };
}

function addDeck(v: VoxelBuilder, palette: TrackPalette, d: DeckBox, rng: Rng): void {
  const [w, t, l] = d.size;
  _q.setFromAxisAngle(_x, d.pitch);
  const m = new Matrix4().compose(_p.set(d.center[0], d.center[1], d.center[2]), _q, _one);
  const top = t / 2;
  const edge = palette.glow[d.edge];
  const grout = palette.glow[GROUT[d.style]];

  v.boxIn(m, [0, -DECK.slabInset / 2, 0], [w, t - DECK.slabInset, l], palette.slab, 0);
  // Glowing grout plate just under the tile tops: it only shows through the gaps between tiles.
  _c.set(grout).multiplyScalar(0.35);
  v.boxIn(m, [0, top - DECK.slabInset + 0.012, 0], [w - 0.04, 0.02, l - 0.04], _c.clone(), 1.1);

  const nx = Math.max(1, Math.round(w / DECK.tile));
  const nz = Math.max(1, Math.round(l / DECK.tile));
  const tw = w / nx;
  const tl = l / nz;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const { color, glow } = tileColor(palette, d.style, ix, iz, rng);
      v.boxIn(
        m,
        [-w / 2 + (ix + 0.5) * tw, top - DECK.tileDepth / 2, -l / 2 + (iz + 0.5) * tl],
        [tw - DECK.grout, DECK.tileDepth, tl - DECK.grout],
        color,
        glow,
      );
    }
  }

  for (const side of [-1, 1]) {
    // Neon edge strip on the driving surface and an underglow line along the slab side.
    v.boxIn(m, [side * (w / 2 - 0.12), top + 0.05, 0], [0.24, 0.1, l], edge, 2.4);
    v.boxIn(m, [side * (w / 2 + 0.02), -t / 2 + 0.35, 0], [0.05, 0.1, l], edge, 1.4);
  }

  if (d.pylons && d.pitch === 0) {
    const count = Math.max(1, Math.floor(l / PYLON_SPACING));
    for (let i = 0; i < count; i++) {
      const z = -l / 2 + (l / count) * (i + 0.5);
      for (const side of [-1, 1]) {
        const x = side * (w / 2 - 1.6);
        v.boxIn(m, [x, -t / 2 - PYLON_LENGTH / 2, z], [1.0, PYLON_LENGTH, 1.0], palette.steel, 0);
        v.boxIn(m, [x, -t / 2 - 1.6, z], [1.14, 0.22, 1.14], edge, 2);
      }
    }
  }
}

export function buildStaticScenery(plan: ChaosTrackPlan): BufferGeometry {
  const rng = mulberry32(plan.seed ^ 0x51ed270b);
  const palette = plan.palette;
  const glowHex = palette.glow;
  const v = new VoxelBuilder();
  for (const d of plan.decks) addDeck(v, palette, d, rng);
  for (const t of plan.trims) v.box(t.center, t.size, t.color, t.glow ?? 0, t.rotation);
  // Solid blocks (knoll face, end wall) drawn a hair larger than their colliders so decals in front never z-fight.
  for (const s of plan.solids) v.box(s.center, [s.size[0] + 0.08, s.size[1] + 0.08, s.size[2] + 0.08], palette.solid, 0);

  // Backing panels + hanging posts for every sign and billboard (the text quads are drawn in Decor).
  const panels = [
    ...plan.signs.map((s) => ({ position: s.position, yaw: s.yaw, width: s.width, height: s.height, glow: glowHex[s.color] })),
    ...plan.billboards.map((b) => ({ position: b.position, yaw: b.yaw, width: b.width, height: b.height, glow: glowHex[plan.decor.billboardGlow] })),
  ];
  for (const p of panels) {
    const nx = Math.sin(p.yaw);
    const nz = Math.cos(p.yaw);
    const [x, y, z] = p.position;
    v.box([x - nx * 0.25, y, z - nz * 0.25], [p.width + 0.6, p.height + 0.6, 0.4], palette.panel, 0, [0, p.yaw, 0]);
    v.box([x - nx * 0.25, y - p.height / 2 - 0.3, z - nz * 0.25], [p.width + 0.7, 0.12, 0.46], p.glow, 2.4, [0, p.yaw, 0]);
    for (const side of [-1, 1]) {
      const off = side * (p.width / 2 - 1.2);
      // Along the panel: local +X rotated by yaw = (cos, 0, −sin).
      const px = x - nx * 0.5 + off * nz;
      const pz = z - nz * 0.5 - off * nx;
      v.box([px, y - p.height / 2 - 20, pz], [0.7, 40, 0.7], palette.steel, 0, [0, p.yaw, 0]);
    }
  }

  for (const g of plan.gates) {
    const [x, y, z] = g.position;
    const glow = glowHex[g.color];
    const half = g.width / 2 + 0.45;
    for (const side of [-1, 1]) {
      v.box([x + side * half, y + (g.height - 6) / 2, z], [0.9, g.height + 6, 0.9], palette.post, 0);
      v.box([x + side * (half - 0.47), y + g.height / 2 - 0.5, z], [0.06, g.height - 1, 0.5], glow, 3);
    }
    v.box([x, y + g.height, z], [g.width + 1.8, 1.1, 0.9], palette.post, 0);
    v.box([x, y + g.height - 0.6, z], [g.width + 1.8, 0.14, 0.95], glow, 3.2);
    if (g.kind === 'finish' || g.kind === 'start') {
      const n = 18;
      const sq = g.width / n;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < n; i++) {
          const white = (i + row) % 2 === 0;
          v.box([x - g.width / 2 + (i + 0.5) * sq, y + 0.025, z - 0.45 + row * 0.9], [sq - 0.02, 0.05, 0.88], white ? '#e8e8f0' : COLORS.black, white ? 0.25 : 0);
        }
      }
    }
  }
  return v.build();
}
