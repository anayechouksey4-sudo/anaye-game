/**
 * Neon text panels drawn on a canvas (no font files, no extra deps). Used for gate labels,
 * hazard signs, the big-jump lip sign (with a live speed-trap line) and GAMERFLEET billboards.
 */
import { CanvasTexture, SRGBColorSpace } from 'three';

export interface SignStyle {
  accent: string;
  /** Pixels per metre of sign width (texture resolution). */
  pxPerM?: number;
  background?: string;
  border?: boolean;
}

export interface SignCanvas {
  texture: CanvasTexture;
  /** Redraw with new lines (e.g. the live speed trap). */
  draw(lines: string[], highlight?: { line: number; color: string }): void;
  dispose(): void;
}

const FONT = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

export function createSignCanvas(widthM: number, heightM: number, style: SignStyle): SignCanvas {
  const pxPerM = style.pxPerM ?? 64;
  const w = Math.min(2048, Math.round(widthM * pxPerM));
  const h = Math.min(1024, Math.round(heightM * pxPerM));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;

  const draw = (lines: string[], highlight?: { line: number; color: string }) => {
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = style.background ?? 'rgba(5, 6, 10, 0.92)';
    ctx.fillRect(0, 0, w, h);
    if (style.border !== false) {
      const b = Math.max(4, Math.round(h * 0.04));
      ctx.strokeStyle = style.accent;
      ctx.lineWidth = b;
      ctx.shadowColor = style.accent;
      ctx.shadowBlur = b * 2;
      ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    }
    const n = Math.max(1, lines.length);
    const rowH = (h * 0.84) / n;
    lines.forEach((text, i) => {
      const primary = i === 0;
      let size = rowH * (primary ? 0.78 : 0.56);
      ctx.font = `900 ${size}px ${FONT}`;
      const maxW = w * 0.9;
      const measured = ctx.measureText(text).width;
      if (measured > maxW) {
        size *= maxW / measured;
        ctx.font = `900 ${size}px ${FONT}`;
      }
      const color = highlight && highlight.line === i ? highlight.color : primary ? style.accent : '#E8F6FF';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = size * 0.35;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h * 0.08 + rowH * (i + 0.5));
    });
    ctx.shadowBlur = 0;
    texture.needsUpdate = true;
  };

  return {
    texture,
    draw,
    dispose: () => texture.dispose(),
  };
}
