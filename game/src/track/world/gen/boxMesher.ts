/**
 * Three-free twin of VoxelBuilder.build() (track/chaos/voxel.ts): merged boxes with the same
 * attribute layout (position, normal, color, glow; 4 vertices per face, CCW from outside, colours
 * in linear space). Ground-standing boxes can drop their bottom face. Also emits trimesh collider
 * arrays (8 shared corners per box). Pure.
 */
import type { ColliderArrays, MeshArrays } from './types';

/** A box: centre, full size, yaw about +Y (rad), sRGB colour 0xRRGGBB, emissive glow. */
export interface Box {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  color: number;
  glow: number;
  /** Drop the bottom face (sits on the ground). */
  ground: boolean;
  /** Optional pitch about the box's local +X, applied before the yaw (three.js sign: negative climbs toward +Z). */
  pitch?: number;
}

// Unit cube faces (±0.5), CCW from outside — identical corner order to VoxelBuilder's FACES.
const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];
const BOTTOM = 3;

/** sRGB 0..1 → linear (the same transfer three.js' Color.set applies to CSS colours). */
function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) LIN[i] = srgbToLinear(i / 255);

/** Positions quantised to 1/256 m so different JS engines agree on the bytes. */
const q = (v: number) => Math.round(v * 256) / 256;

export function meshBoxes(boxes: readonly Box[]): MeshArrays | null {
  if (boxes.length === 0) return null;
  let verts = 0;
  for (const b of boxes) verts += b.ground ? 20 : 24;
  const position = new Float32Array(verts * 3);
  const normal = new Int8Array(verts * 3);
  const color = new Uint8Array(verts * 3);
  const glow = new Float32Array(verts);
  const index = verts > 65535 ? new Uint32Array((verts / 4) * 6) : new Uint16Array((verts / 4) * 6);
  let v = 0;
  let ii = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const b of boxes) {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    const pc = Math.cos(b.pitch ?? 0);
    const ps = Math.sin(b.pitch ?? 0);
    const r = Math.round(LIN[(b.color >> 16) & 255]! * 255);
    const g = Math.round(LIN[(b.color >> 8) & 255]! * 255);
    const bl = Math.round(LIN[b.color & 255]! * 255);
    for (let f = 0; f < 6; f++) {
      if (b.ground && f === BOTTOM) continue;
      const face = FACES[f]!;
      // pitch about X (y' = y cos - z sin, z' = y sin + z cos), then yaw about +Y
      // (x' = x c + z s, z' = -x s + z c; three.js rotation.y = yaw)
      const n1y = face.n[1] * pc - face.n[2] * ps;
      const n1z = face.n[1] * ps + face.n[2] * pc;
      const nx = face.n[0] * c + n1z * s;
      const ny = n1y;
      const nz = -face.n[0] * s + n1z * c;
      const base = v;
      for (const corner of face.c) {
        const lx = corner[0] * b.sx;
        const ly0 = corner[1] * b.sy;
        const lz0 = corner[2] * b.sz;
        const ly = ly0 * pc - lz0 * ps;
        const lz = ly0 * ps + lz0 * pc;
        const px = q(b.x + lx * c + lz * s);
        const py = q(b.y + ly);
        const pz = q(b.z - lx * s + lz * c);
        const o = v * 3;
        position[o] = px;
        position[o + 1] = py;
        position[o + 2] = pz;
        normal[o] = Math.round(nx * 127);
        normal[o + 1] = Math.round(ny * 127);
        normal[o + 2] = Math.round(nz * 127);
        color[o] = r;
        color[o + 1] = g;
        color[o + 2] = bl;
        glow[v] = b.glow;
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (pz < minZ) minZ = pz;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
        if (pz > maxZ) maxZ = pz;
        v++;
      }
      index[ii++] = base;
      index[ii++] = base + 1;
      index[ii++] = base + 2;
      index[ii++] = base;
      index[ii++] = base + 2;
      index[ii++] = base + 3;
    }
  }
  return { position, normal, color, glow, index, boxes: boxes.length, bounds: [minX, minY, minZ, maxX, maxY, maxZ] };
}

/** Trimesh collider: 8 corners per box, 12 triangles (10 when the bottom face is dropped). */
export function colliderBoxes(boxes: readonly Box[]): ColliderArrays | null {
  if (boxes.length === 0) return null;
  let tris = 0;
  for (const b of boxes) tris += b.ground ? 10 : 12;
  const vertices = new Float32Array(boxes.length * 8 * 3);
  const indices = new Uint32Array(tris * 3);
  // corner k: bit0 = +x, bit1 = +y, bit2 = +z
  const quads: [number, number, number, number][] = [
    [1, 3, 7, 5], // +x
    [0, 4, 6, 2], // -x
    [2, 6, 7, 3], // +y
    [0, 1, 5, 4], // -y (bottom)
    [4, 5, 7, 6], // +z
    [0, 2, 3, 1], // -z
  ];
  let vi = 0;
  let ti = 0;
  boxes.forEach((b, k) => {
    const c = Math.cos(b.yaw);
    const s = Math.sin(b.yaw);
    for (let i = 0; i < 8; i++) {
      const lx = (i & 1 ? 0.5 : -0.5) * b.sx;
      const ly = (i & 2 ? 0.5 : -0.5) * b.sy;
      const lz = (i & 4 ? 0.5 : -0.5) * b.sz;
      vertices[vi++] = q(b.x + lx * c + lz * s);
      vertices[vi++] = q(b.y + ly);
      vertices[vi++] = q(b.z - lx * s + lz * c);
    }
    const o = k * 8;
    quads.forEach((qd, f) => {
      if (b.ground && f === 3) return;
      // outward CCW: (a, b, c), (a, c, d)
      indices[ti++] = o + qd[0];
      indices[ti++] = o + qd[1];
      indices[ti++] = o + qd[2];
      indices[ti++] = o + qd[0];
      indices[ti++] = o + qd[2];
      indices[ti++] = o + qd[3];
    });
  });
  return { vertices, indices, triangles: tris };
}
