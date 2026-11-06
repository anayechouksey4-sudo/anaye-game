/**
 * One 1024² canvas atlas for everything the glow program draws: a row of sprites (beacon beam,
 * straight and turn arrows, chevron, ring) and one cell per place / ramp sign (createSignCanvas
 * panels at 40 px/m). Drawn in small steps during the island build (ShaderWarmup tasks), so no
 * single frame pays for all of it. A sign row is redrawn in place when its text changes (a new
 * best air or speed-trap record, or a car swap), followed by one texture upload.
 */
import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter } from 'three';
import { createSignCanvas, type SignCanvas } from '../../chaos/signTexture';
import type { UvRect } from './glowMaterial';

export const ATLAS_SIZE = 1024;
const SPRITE = 128;
const SIGN_PX_PER_M = 40;
const SIGN_COLS = 3;
const SIGN_CELL_W = 336;
const SIGN_CELL_H = 128;
const SIGN_TOP = 136;
export const MAX_SIGNS = SIGN_COLS * Math.floor((ATLAS_SIZE - SIGN_TOP + (SIGN_CELL_H - 120)) / SIGN_CELL_H);

export type SpriteName = 'beam' | 'arrow' | 'turn' | 'chevron' | 'ring' | 'white';
const SPRITES: readonly SpriteName[] = ['beam', 'arrow', 'turn', 'chevron', 'ring', 'white'];

export interface SignSpec {
  /** Width / height in metres (the canvas cell is width·40 × height·40 px). */
  width: number;
  height: number;
  accent: string;
  lines: string[];
}

export interface EventAtlas {
  texture: CanvasTexture;
  /** The car whose records the sign texts show (kept current by EventLayer). */
  meta: { carId: string };
  sprite: Readonly<Record<SpriteName, UvRect>>;
  signUv: readonly UvRect[];
  /** Build-time draw steps (sprites, then one per sign); run them before the texture upload. */
  steps: (() => void)[];
  /** Redraw one sign now and mark the texture for upload. */
  redraw(i: number, lines: string[]): void;
  dispose(): void;
}

const uvOf = (x: number, y: number, w: number, h: number): UvRect => [x / ATLAS_SIZE, 1 - (y + h) / ATLAS_SIZE, (x + w) / ATLAS_SIZE, 1 - y / ATLAS_SIZE];

export function createEventAtlas(signs: readonly SignSpec[], carId: string): EventAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.name = 'tessera-event-atlas';

  const sprite = {} as Record<SpriteName, UvRect>;
  SPRITES.forEach((name, i) => {
    // 4 px inset so mip levels do not bleed between neighbours
    sprite[name] = uvOf(i * SPRITE + 4, 4, SPRITE - 8, SPRITE - 8);
  });
  const cells = signs.slice(0, MAX_SIGNS).map((s, i) => {
    const col = i % SIGN_COLS;
    const row = Math.floor(i / SIGN_COLS);
    const w = Math.min(SIGN_CELL_W - 16, Math.round(s.width * SIGN_PX_PER_M));
    const h = Math.min(SIGN_CELL_H - 8, Math.round(s.height * SIGN_PX_PER_M));
    return { x: col * SIGN_CELL_W, y: SIGN_TOP + row * SIGN_CELL_H, w, h };
  });
  const signUv = cells.map((c) => uvOf(c.x + 1, c.y + 1, c.w - 2, c.h - 2));

  // one panel canvas per sign size (createSignCanvas's own texture is never uploaded)
  const panels = new Map<string, SignCanvas>();
  const panelFor = (s: SignSpec): SignCanvas => {
    const key = `${s.width}x${s.height}:${s.accent}`;
    let p = panels.get(key);
    if (!p) {
      p = createSignCanvas(s.width, s.height, { accent: s.accent, pxPerM: SIGN_PX_PER_M });
      panels.set(key, p);
    }
    return p;
  };
  const drawSign = (i: number, lines: string[]) => {
    const c = cells[i];
    const s = signs[i];
    if (!ctx || !c || !s) return;
    const panel = panelFor(s);
    panel.draw(lines);
    ctx.clearRect(c.x, c.y, c.w, c.h);
    ctx.drawImage(panel.texture.image as HTMLCanvasElement, c.x, c.y, c.w, c.h);
  };

  const steps: (() => void)[] = [() => ctx && drawSprites(ctx)];
  signs.slice(0, MAX_SIGNS).forEach((s, i) => steps.push(() => drawSign(i, s.lines)));
  steps.push(() => {
    texture.needsUpdate = true;
  });

  return {
    texture,
    meta: { carId },
    sprite,
    signUv,
    steps,
    redraw: (i, lines) => {
      drawSign(i, lines);
      texture.needsUpdate = true;
    },
    dispose: () => {
      panels.forEach((p) => p.dispose());
      panels.clear();
      texture.dispose();
    },
  };
}

function drawSprites(ctx: CanvasRenderingContext2D): void {
  const S = SPRITE;
  // beam: bright at the bottom, fading up, soft sides (pixel loop)
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S;
      const v = 1 - (y + 0.5) / S; // 0 at the bottom
      const across = 1 - Math.pow(Math.abs(2 * u - 1), 1.6);
      const core = Math.exp(-Math.pow((2 * u - 1) * 3.2, 2));
      const a = Math.max(0, Math.min(1, (0.35 * across + 0.85 * core) * Math.pow(1 - v, 1.35) * (v < 0.03 ? v / 0.03 : 1)));
      const o = (y * S + x) * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(a * 255);
    }
  ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  // arrow (points up = forward)
  ctx.translate(S, 0);
  ctx.beginPath();
  ctx.moveTo(64, 14);
  ctx.lineTo(108, 62);
  ctx.lineTo(80, 62);
  ctx.lineTo(80, 114);
  ctx.lineTo(48, 114);
  ctx.lineTo(48, 62);
  ctx.lineTo(20, 62);
  ctx.closePath();
  ctx.fill();
  // turn: up, then bending right
  ctx.translate(S, 0);
  ctx.beginPath();
  ctx.moveTo(30, 116);
  ctx.lineTo(30, 66);
  ctx.quadraticCurveTo(30, 40, 58, 40);
  ctx.lineTo(78, 40);
  ctx.lineTo(78, 16);
  ctx.lineTo(116, 52);
  ctx.lineTo(78, 88);
  ctx.lineTo(78, 64);
  ctx.lineTo(62, 64);
  ctx.quadraticCurveTo(56, 64, 56, 72);
  ctx.lineTo(56, 116);
  ctx.closePath();
  ctx.fill();
  // chevron: two '>' pointing right
  ctx.translate(S, 0);
  for (const x0 of [22, 62]) {
    ctx.beginPath();
    ctx.moveTo(x0, 20);
    ctx.lineTo(x0 + 22, 20);
    ctx.lineTo(x0 + 50, 64);
    ctx.lineTo(x0 + 22, 108);
    ctx.lineTo(x0, 108);
    ctx.lineTo(x0 + 28, 64);
    ctx.closePath();
    ctx.fill();
  }
  // ring
  ctx.translate(S, 0);
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(64, 64, 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(64, 64, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // white
  ctx.translate(S, 0);
  ctx.shadowBlur = 0;
  ctx.fillRect(2, 2, S - 4, S - 4);
  ctx.restore();
}
