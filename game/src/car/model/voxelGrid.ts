/**
 * A dense voxel grid that meshes itself into ONE BufferGeometry with hidden-face culling: only
 * faces between a filled cell and an empty one (or the grid boundary) are emitted, so a solid
 * body costs its surface, not its volume.
 *
 * Every cell stores a material index (0 = empty) into a `VoxelMaterial` table. Per-vertex
 * attributes carry everything the car material needs, so one draw call serves the whole body:
 *   color   linear albedo (with a small deterministic per-voxel jitter for the voxel-art look)
 *   glow    static emissive multiplier (emissive = albedo × glow)
 *   channel live emissive channel id (head/tail lights, exhaust, aero LED — see carMaterial.ts)
 *   surf    (roughness, metalness)
 */
import { BufferAttribute, BufferGeometry, Color } from 'three';

export interface VoxelMaterial {
  /** sRGB CSS colour; converted to linear for the vertex attribute. */
  color: string;
  roughness: number;
  metalness: number;
  /** Static emissive strength (× albedo). */
  glow?: number;
  /** Live emissive channel id (0 = none). */
  channel?: number;
  /** ± relative brightness jitter per voxel (0…1). */
  jitter?: number;
}

export interface VoxelMeshStats {
  voxels: number;
  faces: number;
  triangles: number;
  vertices: number;
}

type Axis3 = readonly [number, number, number];

// Face table: neighbour offset, outward normal, 4 corners (unit cell 0…1), CCW seen from outside.
const FACES: { d: Axis3; c: [Axis3, Axis3, Axis3, Axis3] }[] = [
  { d: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { d: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { d: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

const _color = new Color();

/** Cheap integer hash → [0, 1). Deterministic, so the body looks identical on every load. */
function hash01(i: number, j: number, k: number, seed: number): number {
  let h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class VoxelGrid {
  readonly cells: Uint8Array;
  readonly n: Axis3;
  readonly size: Axis3;
  readonly origin: Axis3;

  /**
   * @param n      cell counts along x, y, z
   * @param size   cell size along x, y, z (metres; may be anisotropic)
   * @param origin minimum corner of cell (0, 0, 0)
   */
  constructor(n: Axis3, size: Axis3, origin: Axis3) {
    this.n = n;
    this.size = size;
    this.origin = origin;
    this.cells = new Uint8Array(n[0] * n[1] * n[2]);
  }

  inBounds(i: number, j: number, k: number): boolean {
    return i >= 0 && j >= 0 && k >= 0 && i < this.n[0] && j < this.n[1] && k < this.n[2];
  }

  get(i: number, j: number, k: number): number {
    return this.inBounds(i, j, k) ? (this.cells[(k * this.n[1] + j) * this.n[0] + i] ?? 0) : 0;
  }

  set(i: number, j: number, k: number, material: number): void {
    if (this.inBounds(i, j, k)) this.cells[(k * this.n[1] + j) * this.n[0] + i] = material;
  }

  filled(i: number, j: number, k: number): boolean {
    return this.get(i, j, k) !== 0;
  }

  cx(i: number): number {
    return this.origin[0] + (i + 0.5) * this.size[0];
  }

  cy(j: number): number {
    return this.origin[1] + (j + 0.5) * this.size[1];
  }

  cz(k: number): number {
    return this.origin[2] + (k + 0.5) * this.size[2];
  }

  /** Evaluate `fn` at every cell centre; it returns the material index (0 leaves the cell empty). */
  fill(fn: (x: number, y: number, z: number) => number): void {
    const [nx, ny, nz] = this.n;
    for (let k = 0; k < nz; k++) {
      const z = this.cz(k);
      for (let j = 0; j < ny; j++) {
        const y = this.cy(j);
        for (let i = 0; i < nx; i++) this.set(i, j, k, fn(this.cx(i), y, z));
      }
    }
  }

  /** Visit every filled cell (used by surface-paint passes). */
  forEachFilled(fn: (i: number, j: number, k: number, material: number) => void): void {
    const [nx, ny, nz] = this.n;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const m = this.get(i, j, k);
          if (m !== 0) fn(i, j, k, m);
        }
  }

  countFilled(): number {
    let n = 0;
    for (const c of this.cells) if (c !== 0) n++;
    return n;
  }

  /** Mesh the grid. `seed` decorrelates the colour jitter between parts. */
  build(materials: readonly VoxelMaterial[], seed = 0): { geometry: BufferGeometry; stats: VoxelMeshStats } {
    const [nx, ny, nz] = this.n;
    const [sx, sy, sz] = this.size;

    let faceCount = 0;
    let voxels = 0;
    this.forEachFilled((i, j, k) => {
      voxels++;
      for (const f of FACES) if (!this.filled(i + f.d[0], j + f.d[1], k + f.d[2])) faceCount++;
    });

    const vertexCount = faceCount * 4;
    const position = new Float32Array(vertexCount * 3);
    const normal = new Float32Array(vertexCount * 3);
    const color = new Float32Array(vertexCount * 3);
    const glow = new Float32Array(vertexCount);
    const channel = new Float32Array(vertexCount);
    const surf = new Float32Array(vertexCount * 2);
    const index = vertexCount > 65535 ? new Uint32Array(faceCount * 6) : new Uint16Array(faceCount * 6);

    // Pre-convert the palette once.
    const linear = materials.map((m) => {
      _color.set(m.color);
      return [_color.r, _color.g, _color.b] as const;
    });

    let v = 0;
    let t = 0;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const m = this.get(i, j, k);
          if (m === 0) continue;
          const mat = materials[m];
          const lin = linear[m];
          if (!mat || !lin) throw new Error(`VoxelGrid: no material ${m}`);
          const jitter = mat.jitter ?? 0;
          const shade = 1 + (hash01(i, j, k, seed) * 2 - 1) * jitter;
          const x0 = this.origin[0] + i * sx;
          const y0 = this.origin[1] + j * sy;
          const z0 = this.origin[2] + k * sz;
          for (const f of FACES) {
            if (this.filled(i + f.d[0], j + f.d[1], k + f.d[2])) continue;
            const base = v;
            for (const c of f.c) {
              const o3 = v * 3;
              position[o3] = x0 + c[0] * sx;
              position[o3 + 1] = y0 + c[1] * sy;
              position[o3 + 2] = z0 + c[2] * sz;
              normal[o3] = f.d[0];
              normal[o3 + 1] = f.d[1];
              normal[o3 + 2] = f.d[2];
              color[o3] = lin[0] * shade;
              color[o3 + 1] = lin[1] * shade;
              color[o3 + 2] = lin[2] * shade;
              glow[v] = mat.glow ?? 0;
              channel[v] = mat.channel ?? 0;
              surf[v * 2] = mat.roughness;
              surf[v * 2 + 1] = mat.metalness;
              v++;
            }
            index[t++] = base;
            index[t++] = base + 1;
            index[t++] = base + 2;
            index[t++] = base;
            index[t++] = base + 2;
            index[t++] = base + 3;
          }
        }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    geometry.setAttribute('glow', new BufferAttribute(glow, 1));
    geometry.setAttribute('channel', new BufferAttribute(channel, 1));
    geometry.setAttribute('surf', new BufferAttribute(surf, 2));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, stats: { voxels, faces: faceCount, triangles: faceCount * 2, vertices: vertexCount } };
  }
}

// ── Small shape helpers shared by the part builders ───────────────────────────────────────────

/** Piecewise-linear lookup through [x, y] knots sorted by x DESCENDING or ascending; clamps at the ends. */
export function knots(x: number, pts: readonly (readonly [number, number])[]): number {
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return 0;
  const asc = last[0] >= first[0];
  for (let p = 0; p < pts.length - 1; p++) {
    const a = pts[p];
    const b = pts[p + 1];
    if (!a || !b) continue;
    const inside = asc ? x >= a[0] && x <= b[0] : x <= a[0] && x >= b[0];
    if (inside) {
      const span = b[0] - a[0];
      const t = span === 0 ? 0 : (x - a[0]) / span;
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  const beforeFirst = asc ? x < first[0] : x > first[0];
  return beforeFirst ? first[1] : last[1];
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
