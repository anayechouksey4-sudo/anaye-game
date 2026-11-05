/**
 * Voxel rendering helpers. Static scenery is merged into a handful of BufferGeometries (one draw
 * call each) instead of hundreds of meshes, and hazards use instancing. Colour and glow live in
 * vertex/instance attributes so one material serves every box:
 *
 *   albedo   = vertex `color` (or `instanceColor`)
 *   emissive = albedo × `glow` (vertex) / `instanceGlow` (instance)
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  InstancedBufferAttribute,
  Matrix3,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type ColorRepresentation,
  type InstancedMesh,
} from 'three';

type V3 = readonly [number, number, number];

// Unit cube (±0.5): 6 faces × 4 corners, CCW from outside.
const FACES: { n: V3; c: [V3, V3, V3, V3] }[] = [
  { n: [1, 0, 0], c: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
  { n: [-1, 0, 0], c: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, 1, 0], c: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  { n: [0, -1, 0], c: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  { n: [0, 0, 1], c: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
  { n: [0, 0, -1], c: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
];

interface QueuedBox {
  matrix: Matrix4;
  r: number;
  g: number;
  b: number;
  glow: number;
}

const _color = new Color();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _v = new Vector3();
const _n = new Vector3();
const _nm = new Matrix3();

/** Collects boxes, then emits one merged, vertex-coloured geometry. */
export class VoxelBuilder {
  private readonly boxes: QueuedBox[] = [];

  get count(): number {
    return this.boxes.length;
  }

  /** Box at `center` with full extents `size`, optional Euler XYZ rotation, linear-space colour from a CSS colour. */
  box(center: V3, size: V3, color: ColorRepresentation, glow = 0, rotation?: V3): this {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return this;
    _color.set(color);
    _q.setFromEuler(rotation ? _e.set(rotation[0], rotation[1], rotation[2]) : _e.set(0, 0, 0));
    const matrix = new Matrix4().compose(_p.set(center[0], center[1], center[2]), _q, _s.set(size[0], size[1], size[2]));
    this.boxes.push({ matrix, r: _color.r, g: _color.g, b: _color.b, glow });
    return this;
  }

  /** Box given as a local offset inside a parent transform (e.g. tiles on a pitched ramp plate). */
  boxIn(parent: Matrix4, localCenter: V3, size: V3, color: ColorRepresentation, glow = 0): this {
    if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return this;
    _color.set(color);
    const local = new Matrix4().compose(_p.set(localCenter[0], localCenter[1], localCenter[2]), _q.identity(), _s.set(size[0], size[1], size[2]));
    this.boxes.push({ matrix: new Matrix4().multiplyMatrices(parent, local), r: _color.r, g: _color.g, b: _color.b, glow });
    return this;
  }

  build(): BufferGeometry {
    const n = this.boxes.length;
    const position = new Float32Array(n * 24 * 3);
    const normal = new Float32Array(n * 24 * 3);
    const color = new Float32Array(n * 24 * 3);
    const glow = new Float32Array(n * 24);
    const index = n * 24 > 65535 ? new Uint32Array(n * 36) : new Uint16Array(n * 36);
    let v = 0;
    let i = 0;
    for (const box of this.boxes) {
      _nm.getNormalMatrix(box.matrix);
      for (const face of FACES) {
        _n.set(face.n[0], face.n[1], face.n[2]).applyMatrix3(_nm).normalize();
        const base = v;
        for (const c of face.c) {
          _v.set(c[0], c[1], c[2]).applyMatrix4(box.matrix);
          const o = v * 3;
          position[o] = _v.x;
          position[o + 1] = _v.y;
          position[o + 2] = _v.z;
          normal[o] = _n.x;
          normal[o + 1] = _n.y;
          normal[o + 2] = _n.z;
          color[o] = box.r;
          color[o + 1] = box.g;
          color[o + 2] = box.b;
          glow[v] = box.glow;
          v++;
        }
        index[i++] = base;
        index[i++] = base + 1;
        index[i++] = base + 2;
        index[i++] = base;
        index[i++] = base + 2;
        index[i++] = base + 3;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(position, 3));
    geometry.setAttribute('normal', new BufferAttribute(normal, 3));
    geometry.setAttribute('color', new BufferAttribute(color, 3));
    geometry.setAttribute('glow', new BufferAttribute(glow, 1));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();
    return geometry;
  }
}

/**
 * MeshStandardMaterial whose emissive term is `colour × glow` from a vertex attribute
 * (`glow`, merged geometry) or an instance attribute (`instanceGlow`, instanced meshes).
 */
export function createVoxelMaterial(options: { instanced?: boolean; roughness?: number; metalness?: number } = {}): MeshStandardMaterial {
  const instanced = options.instanced ?? false;
  const material = new MeshStandardMaterial({
    vertexColors: !instanced,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.18,
  });
  const attr = instanced ? 'instanceGlow' : 'glow';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${attr};\nvarying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvGlow = ${attr};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow;');
  };
  material.customProgramCacheKey = () => `voxel-glow-${attr}`;
  return material;
}

/** Ensure an InstancedMesh has per-instance colour + glow attributes (call once after creation). */
export function ensureInstanceAttributes(mesh: InstancedMesh): InstancedBufferAttribute {
  const count = mesh.count;
  if (!mesh.instanceColor) {
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
  }
  let glow = mesh.geometry.getAttribute('instanceGlow') as InstancedBufferAttribute | undefined;
  if (!glow || glow.count !== count) {
    glow = new InstancedBufferAttribute(new Float32Array(count), 1);
    mesh.geometry.setAttribute('instanceGlow', glow);
  }
  return glow;
}
