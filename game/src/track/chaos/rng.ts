/**
 * Seeded randomness for the procedural track. Everything the generator decides goes through
 * one `Rng` stream, so the same seed always produces the identical layout.
 */

export type Rng = () => number;

/** mulberry32: tiny, fast, good enough statistical quality for level generation. Returns [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Integer in [min, max] (inclusive). */
export function int(rng: Rng, min: number, max: number): number {
  return Math.min(max, Math.floor(range(rng, min, max + 1)));
}

/** Uniform value snapped to a step grid inside [min, max]. */
export function stepped(rng: Rng, min: number, max: number, step: number): number {
  return min + step * int(rng, 0, Math.floor((max - min) / step + 1e-9));
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  if (item === undefined) throw new Error('pick() from an empty list');
  return item;
}

export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/**
 * `?seed=` value → 32-bit seed. Integers are used as-is so seeds are easy to share; any other
 * text is hashed (FNV-1a) so `?seed=banana` works too. Returns null for a missing value.
 */
export function parseSeed(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (text === '') return null;
  if (/^-?\d+$/.test(text)) return Number(BigInt.asUintN(32, BigInt(text)));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
