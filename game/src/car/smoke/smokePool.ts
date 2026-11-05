/**
 * Fixed-capacity pool of voxel smoke puffs, stored in flat typed arrays and written straight into
 * an InstancedMesh. Zero allocations after construction: spawning reuses the oldest slot (ring
 * buffer), dead slots collapse to a zero-scale matrix.
 *
 * Puff life: fade in fast, grow with an ease-out, rise (buoyancy), drift with the velocity it
 * was emitted with while air drag bleeds that off, and fade out.
 */
import { Color, DynamicDrawUsage, Euler, InstancedBufferAttribute, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';

export const SMOKE_TUNING = {
  /** Air drag on a puff's velocity, 1/s. */
  drag: 2.1,
  /** Upward acceleration, m/s². */
  buoyancy: 0.45,
  fadeIn: 0.07,
  fadeOutPower: 1.6,
  growPower: 2.2,
} as const;

export interface PuffSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  alpha: number;
  /** Linear RGB tint. */
  r: number;
  g: number;
  b: number;
}

const _m = new Matrix4();
const _p = new Vector3();
const _s = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _c = new Color();
const ZERO = new Matrix4().makeScale(0, 0, 0);

export class SmokePool {
  readonly capacity: number;
  private readonly mesh: InstancedMesh;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array; // size0, size1
  private readonly spin: Float32Array; // tilt, yaw0, yaw rate
  private readonly peak: Float32Array;
  private readonly alpha: InstancedBufferAttribute;
  private next = 0;
  private colorsDirty = false;
  alive = 0;
  emitted = 0;

  constructor(mesh: InstancedMesh) {
    this.mesh = mesh;
    const n = mesh.count;
    this.capacity = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n); // 0 = dead
    this.size = new Float32Array(n * 2);
    this.spin = new Float32Array(n * 3);
    this.peak = new Float32Array(n);
    this.alpha = new InstancedBufferAttribute(new Float32Array(n), 1);
    this.alpha.setUsage(DynamicDrawUsage);
    mesh.geometry.setAttribute('aAlpha', this.alpha);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < n; i++) {
      mesh.setMatrixAt(i, ZERO);
      mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  spawn(p: PuffSpawn): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    if (this.life[i] === 0) this.alive++;
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx;
    this.vel[i3 + 1] = p.vy;
    this.vel[i3 + 2] = p.vz;
    this.age[i] = 0;
    this.life[i] = Math.max(p.life, 0.05);
    this.size[i * 2] = p.size0;
    this.size[i * 2 + 1] = p.size1;
    this.spin[i3] = (Math.random() - 0.5) * 0.9;
    this.spin[i3 + 1] = Math.random() * Math.PI * 2;
    this.spin[i3 + 2] = (Math.random() - 0.5) * 2.4;
    this.peak[i] = p.alpha;
    this.mesh.setColorAt(i, _c.setRGB(p.r, p.g, p.b));
    this.colorsDirty = true;
    this.emitted++;
  }

  /** Advance every live puff by dt and upload matrices/alphas. Returns the live count. */
  update(dt: number): number {
    const { drag, buoyancy, fadeIn, fadeOutPower, growPower } = SMOKE_TUNING;
    const damp = Math.exp(-drag * dt);
    const alphas = this.alpha.array as Float32Array;
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      const life = this.life[i] ?? 0;
      if (life === 0) continue;
      const age = (this.age[i] ?? 0) + dt;
      if (age >= life) {
        this.life[i] = 0;
        alphas[i] = 0;
        this.mesh.setMatrixAt(i, ZERO);
        continue;
      }
      alive++;
      this.age[i] = age;
      const i3 = i * 3;
      const vx = (this.vel[i3] ?? 0) * damp;
      const vy = ((this.vel[i3 + 1] ?? 0) + buoyancy * dt) * damp;
      const vz = (this.vel[i3 + 2] ?? 0) * damp;
      this.vel[i3] = vx;
      this.vel[i3 + 1] = vy;
      this.vel[i3 + 2] = vz;
      const x = (this.pos[i3] ?? 0) + vx * dt;
      const y = (this.pos[i3 + 1] ?? 0) + vy * dt;
      const z = (this.pos[i3 + 2] ?? 0) + vz * dt;
      this.pos[i3] = x;
      this.pos[i3 + 1] = y;
      this.pos[i3 + 2] = z;

      const t = age / life;
      const s0 = this.size[i * 2] ?? 0;
      const s1 = this.size[i * 2 + 1] ?? 0;
      const size = s0 + (s1 - s0) * (1 - (1 - t) ** growPower);
      alphas[i] = (this.peak[i] ?? 0) * Math.min(1, t / fadeIn) * (1 - t) ** fadeOutPower;

      _e.set(this.spin[i3] ?? 0, (this.spin[i3 + 1] ?? 0) + (this.spin[i3 + 2] ?? 0) * age, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s.set(size, size, size));
      this.mesh.setMatrixAt(i, _m);
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
    if (this.colorsDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorsDirty = false;
    }
    return alive;
  }

  clear(): void {
    const alphas = this.alpha.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) {
      this.life[i] = 0;
      alphas[i] = 0;
      this.mesh.setMatrixAt(i, ZERO);
    }
    this.alive = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}
