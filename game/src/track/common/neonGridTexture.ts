import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

export interface NeonGridOptions {
  /** Grid cells per texture tile (lines are drawn on every cell edge). */
  cells?: number;
  background?: string;
  line?: string;
  /** Every n-th line is drawn brighter/thicker (0 = never). */
  majorEvery?: number;
  size?: number;
}

const cache = new Map<string, CanvasTexture>();

/**
 * Procedural neon grid for track surfaces: one tile = `cells` × `cells` squares, meant to be
 * repeated (`texture.repeat.set(widthM / tileM, lengthM / tileM)` — clone it first if two
 * surfaces need different repeats). Gives speed/motion cues on otherwise flat floors.
 */
export function neonGridTexture(options: NeonGridOptions = {}): CanvasTexture {
  const { cells = 4, background = '#0d1222', line = '#00F0FF', majorEvery = 4, size = 256 } = options;
  const key = JSON.stringify([cells, background, line, majorEvery, size]);
  const cached = cache.get(key);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    const step = size / cells;
    for (let i = 0; i < cells; i++) {
      const major = majorEvery > 0 && i % majorEvery === 0;
      ctx.strokeStyle = line;
      ctx.globalAlpha = major ? 0.85 : 0.35;
      ctx.lineWidth = major ? 4 : 2;
      const p = i * step + ctx.lineWidth / 2;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = SRGBColorSpace;
  cache.set(key, texture);
  return texture;
}
