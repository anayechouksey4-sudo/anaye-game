/**
 * Seeded noise for the island generator (pure, deterministic for a seed).
 *   - periodicNoise1D: smooth value noise on a circle (coastline wobble), no seam at 2π.
 *   - GradientNoise2D: Perlin-style gradient noise with a seeded permutation, quintic fade.
 */
import { mulberry32, type Rng } from '../../chaos/rng';

const TAU = Math.PI * 2;

/** Smooth periodic value noise in [-1, 1]: `cells` lattice values around the circle, cubic-Hermite interpolated. */
export function periodicNoise1D(rng: Rng, cells: number): (theta: number) => number {
  const v = new Float64Array(cells);
  for (let i = 0; i < cells; i++) v[i] = rng() * 2 - 1;
  return (theta: number) => {
    let t = (theta / TAU) * cells;
    t -= Math.floor(t / cells) * cells;
    const i0 = Math.floor(t);
    const f = t - i0;
    // Catmull-Rom through 4 neighbours: C1 and periodic.
    const a = v[(i0 - 1 + cells) % cells]!;
    const b = v[i0 % cells]!;
    const c = v[(i0 + 1) % cells]!;
    const d = v[(i0 + 2) % cells]!;
    const f2 = f * f;
    const f3 = f2 * f;
    const out = 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
    return Math.max(-1, Math.min(1, out));
  };
}

/** 2-D gradient noise, roughly in [-1, 1]. */
export class GradientNoise2D {
  private readonly perm = new Uint8Array(512);
  private readonly gx = new Float64Array(256);
  private readonly gz = new Float64Array(256);

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i++) {
      const a = rng() * TAU;
      this.gx[i] = Math.cos(a);
      this.gz[i] = Math.sin(a);
    }
  }

  noise(x: number, z: number): number {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    const xf = x - xi;
    const zf = z - zi;
    const X = xi & 255;
    const Z = zi & 255;
    const perm = this.perm;
    const h00 = perm[X + perm[Z]!]!;
    const h10 = perm[X + 1 + perm[Z]!]!;
    const h01 = perm[X + perm[Z + 1]!]!;
    const h11 = perm[X + 1 + perm[Z + 1]!]!;
    const d00 = this.gx[h00]! * xf + this.gz[h00]! * zf;
    const d10 = this.gx[h10]! * (xf - 1) + this.gz[h10]! * zf;
    const d01 = this.gx[h01]! * xf + this.gz[h01]! * (zf - 1);
    const d11 = this.gx[h11]! * (xf - 1) + this.gz[h11]! * (zf - 1);
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const w = zf * zf * zf * (zf * (zf * 6 - 15) + 10);
    const a = d00 + (d10 - d00) * u;
    const b = d01 + (d11 - d01) * u;
    return (a + (b - a) * w) * 1.41;
  }

  /** Fractal sum: `octaves` octaves starting at `scale` m wavelength, gain 0.5. */
  fbm(x: number, z: number, scale: number, octaves: number): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = 1 / scale;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise(x * f + o * 31.7, z * f - o * 17.3) * amp;
      norm += amp;
      amp *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function smootherstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Polynomial smooth max (k = blend width, m). */
export function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
}

/** Polynomial smooth min (k = blend width, m). */
export function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}
