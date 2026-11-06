/**
 * Draws a number plate into any 2-D canvas context (the three.js texture, the lab page's preview,
 * a garage thumbnail). Pure canvas 2-D: no fonts, no images, no three.js.
 *
 * Look: a game plate, not any real-world registration design — deep navy face, a neon frame in the
 * car's accent colour with two accent rivets, white 5×7 pixel glyphs (plateFont.ts) sized to fit.
 */
import { GLYPH_ROWS, layoutGlyphs, textCells } from './plateFont';

export const PLATE_TEXTURE_WIDTH = 512;
export const PLATE_TEXTURE_HEIGHT = 128;
export const PLATE_FACE = '#0b1020';
export const PLATE_INK = '#f4f7fb';
const FRAME_PX = 10;
const PAD_X = 22;
const PAD_Y = 18;

export function drawPlate(ctx: CanvasRenderingContext2D, text: string, accent: string, width = PLATE_TEXTURE_WIDTH, height = PLATE_TEXTURE_HEIGHT): void {
  ctx.fillStyle = PLATE_FACE;
  ctx.fillRect(0, 0, width, height);
  const frame = Math.max(2, Math.round((FRAME_PX * height) / PLATE_TEXTURE_HEIGHT));
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, width, frame);
  ctx.fillRect(0, height - frame, width, frame);
  ctx.fillRect(0, 0, frame, height);
  ctx.fillRect(width - frame, 0, frame, height);
  const rivet = Math.max(2, Math.round(frame * 0.6));
  ctx.fillRect(frame * 2, Math.round(height / 2 - rivet / 2), rivet, rivet);
  ctx.fillRect(width - frame * 2 - rivet, Math.round(height / 2 - rivet / 2), rivet, rivet);
  const chars = text.length ? text : ' ';
  const cols = textCells(chars);
  const padX = Math.round((PAD_X * width) / PLATE_TEXTURE_WIDTH);
  const padY = Math.round((PAD_Y * height) / PLATE_TEXTURE_HEIGHT);
  const cell = Math.max(1, Math.floor(Math.min((width - 2 * padX) / cols, (height - 2 * padY) / GLYPH_ROWS)));
  const x0 = Math.floor((width - cols * cell) / 2);
  const y0 = Math.floor((height - GLYPH_ROWS * cell) / 2);
  ctx.fillStyle = PLATE_INK;
  layoutGlyphs(chars, x0, y0, cell, (x, y, size) => ctx.fillRect(x, y, size, size));
}
