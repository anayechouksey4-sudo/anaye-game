/**
 * The in-car driver: a bust (shoulders, neck, head, face, hair, helmet) of at most BUST_BOX_LIMIT
 * axis-aligned boxes, from the same AvatarConfig as the portrait. This module is pure data (no
 * three.js): DriverBust.tsx turns the boxes into one BufferGeometry that shares the car material.
 *
 * Bust frame: origin at the base of the neck between the shoulders, +Z the driver's facing
 * direction (= the car's nose), +Y up, +X the driver's left. Height ≈ 0.6 m from the shoulder
 * bottom to the top of the hair; seat anchors per class are in ride/anchors.ts.
 */
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES, type AvatarConfig } from './avatar';

/** Hard cap on boxes per bust (every hair × helmet × beard × glasses combination stays under it; tested). */
export const BUST_BOX_LIMIT = 40;

export interface BoxMaterial {
  /** sRGB CSS hex. */
  color: string;
  roughness: number;
  metalness: number;
  /** Static emissive strength (× albedo), like VoxelMaterial.glow. */
  glow?: number;
}

export interface Box {
  /** Centre [x, y, z] in the bust frame, m. */
  c: readonly [number, number, number];
  /** Full size [w, h, d], m. */
  s: readonly [number, number, number];
  m: BoxMaterial;
}

const SUIT: BoxMaterial = { color: '#3A3F52', roughness: 0.7, metalness: 0.1 };
const DARK: BoxMaterial = { color: '#15171E', roughness: 0.45, metalness: 0.3 };
const WHITE: BoxMaterial = { color: '#F4F7FB', roughness: 0.4, metalness: 0 };
const MOUTH: BoxMaterial = { color: '#7A2C3A', roughness: 0.6, metalness: 0 };
const TONGUE: BoxMaterial = { color: '#E8557A', roughness: 0.6, metalness: 0 };
const MARK: BoxMaterial = { color: '#B86A4E', roughness: 0.8, metalness: 0 };
const GLASS_DARK: BoxMaterial = { color: '#0B0C10', roughness: 0.3, metalness: 0.5 };
const LENS: BoxMaterial = { color: '#2A557D', roughness: 0.1, metalness: 0.4, glow: 0.15 };
const VISOR_COLOR: Record<AvatarConfig['visor'], string> = { none: '#1B3A5A', clear: '#2A557D', cyan: '#00F0FF', magenta: '#FF2A6D', gold: '#F5E663' };

// Head geometry (m): the face plane is at z = HEAD_D / 2.
const HEAD_W = 0.24;
const HEAD_H = 0.26;
const HEAD_D = 0.24;
const HEAD_Y = 0.07; // bottom of the head
const HEAD_C = HEAD_Y + HEAD_H / 2;
const FACE = HEAD_D / 2;
const TOP = HEAD_Y + HEAD_H;

/** The boxes of a bust for `a` (≤ BUST_BOX_LIMIT). Deterministic; no allocation beyond the list. */
export function buildBustBoxes(a: AvatarConfig): Box[] {
  const skin: BoxMaterial = { color: SKIN_TONES[a.skin] ?? SKIN_TONES[3], roughness: 0.8, metalness: 0 };
  const hair: BoxMaterial = { color: HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0], roughness: 0.75, metalness: 0 };
  const pupil: BoxMaterial = { color: EYE_COLORS[a.eyeColor] ?? EYE_COLORS[0], roughness: 0.3, metalness: 0 };
  const sig: BoxMaterial = { color: a.color, roughness: 0.35, metalness: 0.2, glow: 0.6 };
  const shell: BoxMaterial = { color: a.color, roughness: 0.3, metalness: 0.25, glow: 0.25 };
  const visor: BoxMaterial = { color: VISOR_COLOR[a.visor], roughness: 0.08, metalness: 0.4, glow: a.visor === 'none' || a.visor === 'clear' ? 0.1 : 0.9 };
  const out: Box[] = [];
  const box = (c: readonly [number, number, number], s: readonly [number, number, number], m: BoxMaterial) => out.push({ c, s, m });

  // Torso and shoulders (the signature colour on both shoulders reads in a dark cockpit).
  box([0, -0.11, 0], [0.46, 0.22, 0.26], SUIT);
  box([0.195, -0.05, 0], [0.09, 0.07, 0.24], sig);
  box([-0.195, -0.05, 0], [0.09, 0.07, 0.24], sig);
  box([0, -0.1, 0.132], [0.3, 0.03, 0.01], sig);
  // Neck and head.
  box([0, 0.035, 0], [0.1, 0.07, 0.1], skin);
  box([0, HEAD_C, 0], [HEAD_W, HEAD_H, HEAD_D], skin);

  const fullFace = a.helmet === 'full';
  if (!fullFace) {
    // Eyes (row y ≈ 0.21) and brows.
    const eyeY = HEAD_Y + 0.14;
    const eye = (x: number, closed: boolean) => {
      if (closed) {
        box([x, eyeY - 0.005, FACE + 0.002], [0.05, 0.012, 0.004], DARK);
        return;
      }
      if (a.eyes !== 'dot') box([x, eyeY, FACE + 0.002], [0.055, a.eyes === 'wide' ? 0.045 : 0.03, 0.004], WHITE);
      box([x, eyeY, FACE + 0.005], [0.028, a.eyes === 'wide' ? 0.03 : 0.022, 0.004], a.eyes === 'star' ? sig : pupil);
    };
    eye(0.055, a.eyes === 'sleepy');
    eye(-0.055, a.eyes === 'sleepy' || a.eyes === 'wink');
    box([0.055, eyeY + 0.035, FACE + 0.002], [0.06, 0.012, 0.004], hair);
    box([-0.055, eyeY + 0.035, FACE + 0.002], [0.06, 0.012, 0.004], hair);
    // Mouth.
    const mouthY = HEAD_Y + 0.05;
    switch (a.mouth) {
      case 'grin':
        box([0, mouthY, FACE + 0.002], [0.1, 0.022, 0.004], MOUTH);
        box([0, mouthY - 0.004, FACE + 0.004], [0.06, 0.01, 0.004], WHITE);
        break;
      case 'smirk':
        box([-0.025, mouthY, FACE + 0.002], [0.06, 0.016, 0.004], MOUTH);
        break;
      case 'flat':
        box([0, mouthY, FACE + 0.002], [0.07, 0.012, 0.004], MOUTH);
        break;
      case 'open':
        box([0, mouthY - 0.005, FACE + 0.002], [0.05, 0.036, 0.004], MOUTH);
        break;
      case 'tongue':
        box([0, mouthY, FACE + 0.002], [0.1, 0.02, 0.004], MOUTH);
        box([0.01, mouthY - 0.02, FACE + 0.006], [0.03, 0.03, 0.012], TONGUE);
        break;
    }
    // Marks.
    switch (a.mark) {
      case 'freckles':
        box([0.06, HEAD_Y + 0.1, FACE + 0.002], [0.022, 0.012, 0.004], MARK);
        box([-0.06, HEAD_Y + 0.1, FACE + 0.002], [0.022, 0.012, 0.004], MARK);
        break;
      case 'stripe':
        box([-0.085, HEAD_Y + 0.13, FACE + 0.003], [0.02, 0.09, 0.004], sig);
        break;
      case 'scar':
        box([0.065, HEAD_Y + 0.19, FACE + 0.002], [0.012, 0.05, 0.004], MARK);
        box([0.075, HEAD_Y + 0.085, FACE + 0.002], [0.03, 0.01, 0.004], MARK);
        break;
      case 'dots':
        box([0.075, HEAD_Y + 0.11, FACE + 0.003], [0.016, 0.016, 0.004], sig);
        box([-0.075, HEAD_Y + 0.11, FACE + 0.003], [0.016, 0.016, 0.004], sig);
        break;
    }
    // Beard.
    if (a.beard === 'stubble') box([0, HEAD_Y + 0.03, FACE + 0.001], [0.2, 0.06, 0.004], { ...skin, color: shadeHex(skin.color, 0.72) });
    if (a.beard === 'goatee') box([0, HEAD_Y + 0.025, FACE + 0.004], [0.07, 0.05, 0.012], hair);
    if (a.beard === 'full') box([0, HEAD_Y + 0.04, 0.005], [HEAD_W + 0.02, 0.085, HEAD_D + 0.015], hair);
    // Glasses: lenses on the face plus a bridge; shades are one dark band.
    if (a.glasses === 'shades') box([0, eyeY, FACE + 0.012], [0.25, 0.045, 0.014], GLASS_DARK);
    else if (a.glasses !== 'none') {
      const lensH = a.glasses === 'round' ? 0.05 : 0.045;
      box([0.06, eyeY, FACE + 0.01], [0.075, lensH, 0.012], LENS);
      box([-0.06, eyeY, FACE + 0.01], [0.075, lensH, 0.012], LENS);
      box([0, eyeY + 0.01, FACE + 0.01], [0.05, 0.01, 0.01], GLASS_DARK);
    }
  }

  // Hair (hidden under a full-face helmet or a beanie).
  if (a.helmet !== 'full' && a.helmet !== 'beanie') {
    const cap = (h: number, pad = 0.01) => box([0, TOP + h / 2 - 0.005, -0.01], [HEAD_W + pad * 2, h, HEAD_D + pad * 2], hair);
    const sides = (drop: number) => {
      box([HEAD_W / 2 + 0.012, TOP - drop / 2, -0.02], [0.03, drop, HEAD_D - 0.02], hair);
      box([-HEAD_W / 2 - 0.012, TOP - drop / 2, -0.02], [0.03, drop, HEAD_D - 0.02], hair);
      box([0, TOP - drop / 2, -HEAD_D / 2 - 0.012], [HEAD_W + 0.06, drop, 0.03], hair);
    };
    switch (a.hair) {
      case 'buzz':
        cap(0.035, 0.004);
        break;
      case 'crop':
        cap(0.05);
        sides(0.08);
        break;
      case 'quiff':
        cap(0.05);
        sides(0.08);
        box([0.02, TOP + 0.075, 0.09], [0.14, 0.07, 0.1], hair);
        break;
      case 'curls':
        cap(0.09, 0.025);
        sides(0.16);
        break;
      case 'bun':
        cap(0.045);
        sides(0.07);
        box([0, TOP + 0.03, -HEAD_D / 2 - 0.04], [0.09, 0.09, 0.08], hair);
        break;
      case 'long':
        cap(0.05);
        sides(0.3);
        break;
      case 'mohawk':
        box([0, TOP + 0.05, -0.01], [0.055, 0.11, HEAD_D + 0.02], hair);
        break;
      case 'braid':
        cap(0.045);
        sides(0.08);
        box([0.03, TOP - 0.2, -HEAD_D / 2 - 0.035], [0.045, 0.36, 0.045], hair);
        box([0.03, TOP - 0.39, -HEAD_D / 2 - 0.035], [0.05, 0.03, 0.05], sig);
        break;
      case 'none':
        break;
    }
  }

  // Helmets and hats.
  switch (a.helmet) {
    case 'cap':
      box([0, TOP + 0.03, -0.01], [HEAD_W + 0.03, 0.06, HEAD_D + 0.03], shell);
      box([0, TOP + 0.005, FACE + 0.06], [HEAD_W + 0.03, 0.015, 0.12], DARK);
      break;
    case 'band':
      box([0, TOP - 0.04, 0], [HEAD_W + 0.02, 0.035, HEAD_D + 0.02], shell);
      break;
    case 'beanie':
      box([0, TOP - 0.02, 0], [HEAD_W + 0.03, 0.16, HEAD_D + 0.03], shell);
      box([0, TOP - 0.085, 0], [HEAD_W + 0.04, 0.03, HEAD_D + 0.04], sig);
      box([0, TOP + 0.08, 0], [0.07, 0.05, 0.07], shell);
      break;
    case 'open':
    case 'full': {
      const w = HEAD_W + 0.08;
      const d = HEAD_D + 0.08;
      const y0 = HEAD_Y - 0.01;
      const y1 = TOP + 0.045;
      const hh = y1 - y0;
      box([0, y1 - 0.02, 0], [w, 0.04, d], shell); // crown
      box([0, y0 + hh / 2, -d / 2 + 0.02], [w, hh, 0.04], shell); // back
      box([w / 2 - 0.02, y0 + hh / 2, 0], [0.04, hh, d - 0.04], shell); // sides
      box([-w / 2 + 0.02, y0 + hh / 2, 0], [0.04, hh, d - 0.04], shell);
      box([0, y1 - 0.01, 0], [0.05, 0.03, d + 0.01], sig); // centre stripe
      if (fullFace) {
        box([0, y0 + 0.05, d / 2 - 0.02], [w, 0.1, 0.04], shell); // chin bar
        box([0, HEAD_Y + 0.16, d / 2 - 0.02], [w - 0.02, 0.1, 0.03], visor);
        box([0, y1 - 0.065, d / 2 - 0.02], [w, 0.05, 0.04], shell); // brow
      } else {
        box([0, y1 - 0.05, d / 2 - 0.02], [w, 0.06, 0.04], shell); // brow bar
      }
      break;
    }
    case 'none':
      break;
  }
  return out;
}

function shadeHex(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return '#' + [r, g, b].map((x) => Math.min(255, x).toString(16).padStart(2, '0')).join('');
}

/** Axis-aligned bounds of a box list, m. */
export function boxBounds(boxes: readonly Box[]): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.c[i]! - b.s[i]! / 2);
      max[i] = Math.max(max[i]!, b.c[i]! + b.s[i]! / 2);
    }
  return { min, max };
}

/** Triangles a box list costs when drawn as plain boxes (12 each). */
export function boxTriangles(boxes: readonly Box[]): number {
  return boxes.length * 12;
}
