/**
 * 24×24 procedural pixel portrait of an AvatarConfig: the same parameters the in-car bust uses,
 * drawn in the same layer order (background glow, suit, head, features, hair, helmet). The pure
 * part writes RGBA bytes (node-testable); `portraitDataUrl` paints them on a canvas and caches the
 * data URL per avatar, so a menu row costs one <img> and no per-render work.
 */
import { EYE_COLORS, HAIR_COLORS, SKIN_TONES, avatarKey, type AvatarConfig } from './avatar';

export const PORTRAIT = 24;

type RGBA = [number, number, number, number];
const hex = (h: string, a = 255): RGBA => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a];
const shade = (c: RGBA, f: number): RGBA => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f)), c[3]];
const BG = '#0A0C14';

export function renderPortrait(a: AvatarConfig): Uint8ClampedArray<ArrayBuffer> {
  const px = new Uint8ClampedArray(new ArrayBuffer(PORTRAIT * PORTRAIT * 4));
  const put = (x: number, y: number, c: RGBA) => {
    if (x < 0 || y < 0 || x >= PORTRAIT || y >= PORTRAIT) return;
    px.set(c, (y * PORTRAIT + x) * 4);
  };
  const rect = (x0: number, y0: number, w: number, h: number, c: RGBA) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
  };
  const sig = hex(a.color);
  const skin = hex(SKIN_TONES[a.skin] ?? SKIN_TONES[3]);
  const hair = hex(HAIR_COLORS[a.hairColor] ?? HAIR_COLORS[0]);
  const eye = hex(EYE_COLORS[a.eyeColor] ?? EYE_COLORS[0]);
  const dark = hex('#0B0C12');
  const visor: Record<AvatarConfig['visor'], RGBA> = { none: hex('#1B3A5A'), clear: hex('#2A557D'), cyan: hex('#00F0FF'), magenta: hex('#FF2A6D'), gold: hex('#F5E663') };
  // Background: dark with the signature colour as a soft corner glow (two diagonal steps).
  rect(0, 0, PORTRAIT, PORTRAIT, hex(BG));
  for (let y = 0; y < PORTRAIT; y++) for (let x = 0; x < PORTRAIT; x++) if (x + y > 36) put(x, y, shade(sig, 0.22)); else if (x + y > 32) put(x, y, shade(sig, 0.12));
  // Suit shoulders, neck, accent stripe.
  rect(3, 19, 18, 5, hex('#1A1C26'));
  rect(4, 18, 16, 1, hex('#1A1C26'));
  rect(3, 21, 18, 1, sig);
  rect(10, 16, 4, 3, shade(skin, 0.85));
  // Head 10×12 at (7,5) with cut corners.
  rect(7, 5, 10, 12, skin);
  for (const [x, y] of [[7, 5], [16, 5], [7, 16], [16, 16]] as const) put(x, y, hex(BG));
  // Ears.
  put(6, 10, shade(skin, 0.9));
  put(17, 10, shade(skin, 0.9));
  // Beard.
  if (a.beard === 'goatee') rect(10, 14, 4, 3, hair);
  else if (a.beard !== 'none') rect(8, 13, 8, 4, a.beard === 'stubble' ? shade(skin, 0.75) : hair);
  // Mouth (rows 12–15).
  const mouth = hex('#7A2C3A');
  const drawMouth = () => {
    if (a.mouth === 'grin') {
      rect(9, 13, 6, 1, mouth);
      put(9, 12, mouth);
      put(14, 12, mouth);
      rect(10, 14, 4, 1, hex('#F4F7FB'));
    }
    if (a.mouth === 'smirk') {
      rect(11, 13, 4, 1, mouth);
      put(14, 12, mouth);
    }
    if (a.mouth === 'flat') rect(10, 13, 4, 1, mouth);
    if (a.mouth === 'open') {
      rect(10, 13, 4, 2, mouth);
      rect(11, 13, 2, 1, hex('#F4F7FB'));
    }
    if (a.mouth === 'tongue') {
      rect(9, 13, 6, 1, mouth);
      rect(12, 14, 2, 2, hex('#E8557A'));
    }
  };
  drawMouth();
  // Eyes (rows 9–10): whites + pupil, variants.
  const eyes = (x: number, closed: boolean) => {
    if (closed) {
      rect(x, 10, 3, 1, dark);
      return;
    }
    rect(x, 9, 3, 2, hex('#F4F7FB'));
    if (a.eyes === 'star') {
      put(x + 1, 9, sig);
      put(x + 1, 10, sig);
      put(x, 10, sig);
      put(x + 2, 10, sig);
    } else if (a.eyes === 'dot') {
      rect(x, 9, 3, 1, skin);
      put(x + 1, 10, eye);
    } else {
      put(x + 1, 10, eye);
      if (a.eyes === 'wide') put(x + 1, 9, eye);
    }
  };
  const drawEyes = () => {
    eyes(8, a.eyes === 'sleepy');
    eyes(13, a.eyes === 'sleepy' || a.eyes === 'wink');
    rect(8, 8, 3, 1, shade(hair, 0.9));
    rect(13, 8, 3, 1, shade(hair, 0.9));
  };
  drawEyes();
  // Marks.
  const mark = hex('#B86A4E');
  if (a.mark === 'freckles') {
    put(8, 11, mark);
    put(10, 12, mark);
    put(14, 12, mark);
    put(16, 11, mark);
  }
  if (a.mark === 'stripe') rect(15, 7, 1, 6, sig);
  if (a.mark === 'scar') {
    put(9, 7, mark);
    put(9, 8, mark);
    put(8, 11, mark);
  }
  if (a.mark === 'dots') {
    put(8, 11, sig);
    put(15, 11, sig);
  }
  // Glasses.
  if (a.glasses !== 'none') {
    const lens = a.glasses === 'shades' ? dark : hex('#3C6E9A');
    rect(7, 9, 4, 2, lens);
    rect(13, 9, 4, 2, lens);
    put(11, 9, dark);
    put(12, 9, dark);
    if (a.glasses !== 'round') {
      rect(7, 8, 4, 1, dark);
      rect(13, 8, 4, 1, dark);
    }
  }
  // Hair (hidden under a full-face helmet or a beanie).
  if (a.helmet !== 'full' && a.helmet !== 'beanie') {
    switch (a.hair) {
      case 'buzz':
        rect(7, 4, 10, 2, hair);
        break;
      case 'crop':
        rect(7, 3, 10, 3, hair);
        rect(7, 6, 1, 3, hair);
        rect(16, 6, 1, 3, hair);
        break;
      case 'quiff':
        rect(7, 3, 10, 3, hair);
        rect(9, 1, 6, 2, hair);
        rect(13, 2, 5, 2, hair);
        rect(16, 6, 1, 3, hair);
        break;
      case 'curls':
        rect(6, 3, 12, 3, hair);
        for (let x = 5; x <= 18; x += 2) put(x, 2 + (x % 4 === 1 ? 0 : 1), hair);
        rect(6, 6, 1, 5, hair);
        rect(17, 6, 1, 5, hair);
        break;
      case 'bun':
        rect(7, 3, 10, 3, hair);
        rect(10, 0, 4, 3, hair);
        rect(7, 6, 1, 2, hair);
        rect(16, 6, 1, 2, hair);
        break;
      case 'long':
        rect(7, 3, 10, 3, hair);
        rect(5, 5, 2, 14, hair);
        rect(17, 5, 2, 14, hair);
        rect(7, 6, 1, 4, hair);
        rect(16, 6, 1, 4, hair);
        break;
      case 'mohawk':
        rect(10, 0, 4, 6, hair);
        rect(11, 0, 2, 1, shade(hair, 1.2));
        break;
      case 'braid':
        rect(7, 3, 10, 3, hair);
        rect(7, 6, 1, 3, hair);
        rect(16, 6, 1, 3, hair);
        rect(18, 6, 2, 12, hair);
        put(19, 18, sig);
        break;
      case 'none':
        break;
    }
  }
  // Helmets and hats.
  if (a.helmet === 'cap') {
    rect(6, 3, 12, 3, sig);
    rect(6, 6, 14, 1, dark);
    rect(10, 2, 4, 1, sig);
  }
  if (a.helmet === 'band') rect(6, 6, 12, 2, sig);
  if (a.helmet === 'beanie') {
    rect(6, 1, 12, 7, sig);
    rect(6, 7, 12, 1, shade(sig, 0.6));
    rect(10, 0, 4, 1, sig);
  }
  if (a.helmet === 'open' || a.helmet === 'full') {
    rect(5, 3, 14, 15, sig);
    put(5, 3, hex(BG));
    put(18, 3, hex(BG));
    rect(11, 3, 2, 15, shade(sig, 0.7)); // centre stripe
    if (a.helmet === 'open') {
      rect(7, 7, 10, 10, skin);
      rect(7, 16, 10, 1, shade(skin, 0.9));
      if (a.beard === 'goatee') rect(10, 14, 4, 3, hair);
      else if (a.beard !== 'none') rect(8, 13, 8, 4, a.beard === 'stubble' ? shade(skin, 0.75) : hair);
      drawMouth();
      drawEyes();
    } else {
      rect(7, 7, 10, 6, visor[a.visor]);
      rect(8, 8, 3, 1, hex('#DDE8F5'));
      rect(7, 13, 10, 5, shade(sig, 0.75));
      rect(10, 15, 4, 1, dark);
    }
  }
  return px;
}

const urlCache = new Map<string, string>();

/**
 * The portrait as a PNG data URL (cached per avatar). Browser only; '' where there is no canvas
 * (tests, SSR), so callers render nothing instead of throwing.
 */
export function portraitDataUrl(a: AvatarConfig): string {
  const key = avatarKey(a);
  const hit = urlCache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return '';
  let url = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PORTRAIT;
    canvas.height = PORTRAIT;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(new ImageData(renderPortrait(a), PORTRAIT, PORTRAIT), 0, 0);
      url = canvas.toDataURL('image/png');
    }
  } catch {
    url = '';
  }
  if (urlCache.size > 64) urlCache.delete(urlCache.keys().next().value as string);
  urlCache.set(key, url);
  return url;
}
