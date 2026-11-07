/**
 * Fixed-capacity ring buffer of skid-mark quads in ONE interleaved vertex buffer (x y z · r g b ·
 * alpha · born), drawn as one indexed mesh. Zero allocations after construction: a new quad
 * overwrites the oldest slot; quads older than MARK_FADE_S are retired by advancing the tail, and
 * the draw range follows the live [tail, head) window (the whole buffer while that window wraps).
 * Fading itself happens in the shader from `born` and a time uniform (skidMaterial.ts), so a frame
 * uploads only the vertices it wrote.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { MARK_FADE_S } from './skidRules';

/** Quads in the ring: 2,048 quads = 8,192 vertices = 4,096 triangles at most per frame. */
export const SKID_CAPACITY = 2048;
export const VERTS_PER_QUAD = 4;
export const FLOATS_PER_VERTEX = 8;
const OFFSET_COLOR = 3;
const OFFSET_ALPHA = 6;
const OFFSET_BORN = 7;
const QUAD_FLOATS = VERTS_PER_QUAD * FLOATS_PER_VERTEX;

export class SkidBuffer {
  readonly capacity: number;
  readonly geometry: BufferGeometry;
  readonly data: Float32Array;
  private readonly buffer: InterleavedBuffer;
  /** One reusable update range (pushed onto the buffer's list instead of allocating a new one). */
  private readonly range = { start: 0, count: 0 };
  /** Next slot to write. */
  head = 0;
  /** Oldest slot that may still be visible. */
  tail = 0;
  /** Quads in [tail, head) (modular), ≤ capacity. */
  live = 0;
  /** Quads written since the last clear. */
  written = 0;
  /** `born` of the newest quad (−Infinity when empty). */
  newestBorn = -Infinity;
  /** Map the marks belong to (SkidMarks clears the buffer when a different map mounts). */
  trackId: string | null = null;
  private dirtyMin = Infinity;
  private dirtyMax = -Infinity;

  constructor(capacity = SKID_CAPACITY) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * QUAD_FLOATS);
    this.buffer = new InterleavedBuffer(this.data, FLOATS_PER_VERTEX);
    this.buffer.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new InterleavedBufferAttribute(this.buffer, 3, 0));
    geometry.setAttribute('color', new InterleavedBufferAttribute(this.buffer, 3, OFFSET_COLOR));
    geometry.setAttribute('aAlpha', new InterleavedBufferAttribute(this.buffer, 1, OFFSET_ALPHA));
    geometry.setAttribute('aBorn', new InterleavedBufferAttribute(this.buffer, 1, OFFSET_BORN));
    // Static index: two triangles per quad, built once (8,192 vertices fit 16-bit indices).
    const index = new Uint16Array(capacity * 6);
    for (let q = 0; q < capacity; q++) {
      const v = q * VERTS_PER_QUAD;
      const i = q * 6;
      index[i] = v;
      index[i + 1] = v + 1;
      index[i + 2] = v + 2;
      index[i + 3] = v;
      index[i + 4] = v + 2;
      index[i + 5] = v + 3;
    }
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.setDrawRange(0, 0);
    this.geometry = geometry;
  }

  /** Forget every mark (the buffer memory stays). */
  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.live = 0;
    this.written = 0;
    this.newestBorn = -Infinity;
    this.dirtyMin = Infinity;
    this.dirtyMax = -Infinity;
    this.geometry.setDrawRange(0, 0);
  }

  /**
   * Append one quad: the previous strip edge (a = left, b = right) to the current one (c = right,
   * d = left), with its colour, the alpha at each edge and its birth time. Overwrites the oldest
   * slot once the ring is full.
   */
  writeQuad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    r: number, g: number, b: number,
    alphaPrev: number, alphaCur: number,
    born: number,
  ): void {
    const slot = this.head;
    const base = slot * QUAD_FLOATS;
    this.vertex(base, ax, ay, az, r, g, b, alphaPrev, born);
    this.vertex(base + FLOATS_PER_VERTEX, bx, by, bz, r, g, b, alphaPrev, born);
    this.vertex(base + 2 * FLOATS_PER_VERTEX, cx, cy, cz, r, g, b, alphaCur, born);
    this.vertex(base + 3 * FLOATS_PER_VERTEX, dx, dy, dz, r, g, b, alphaCur, born);
    if (base < this.dirtyMin) this.dirtyMin = base;
    if (base + QUAD_FLOATS > this.dirtyMax) this.dirtyMax = base + QUAD_FLOATS;
    this.head = (slot + 1) % this.capacity;
    this.written++;
    this.newestBorn = born;
    if (this.live < this.capacity) this.live++;
    else this.tail = this.head; // overwrote the oldest live quad
  }

  private vertex(at: number, x: number, y: number, z: number, r: number, g: number, b: number, alpha: number, born: number): void {
    const d = this.data;
    d[at] = x;
    d[at + 1] = y;
    d[at + 2] = z;
    d[at + 3] = r;
    d[at + 4] = g;
    d[at + 5] = b;
    d[at + 6] = alpha;
    d[at + 7] = born;
  }

  /** Birth time of the quad in `slot`. */
  bornOf(slot: number): number {
    return this.data[slot * QUAD_FLOATS + OFFSET_BORN] ?? -Infinity;
  }

  /** Retire quads older than MARK_FADE_S (they are already invisible; this only shrinks the draw range). */
  expire(now: number): void {
    while (this.live > 0 && now - this.bornOf(this.tail) >= MARK_FADE_S) {
      this.tail = (this.tail + 1) % this.capacity;
      this.live--;
    }
    if (this.live === 0) this.newestBorn = -Infinity;
  }

  /**
   * Push this frame's writes to the GPU (one update range) and set the draw range to the live
   * window. Returns the number of triangles the next draw submits (0 = nothing to draw).
   */
  flush(): number {
    if (this.dirtyMax > this.dirtyMin) {
      const pending = this.buffer.updateRanges;
      if (pending.length > 0 && pending[pending.length - 1] === this.range) {
        // The renderer has not consumed the last range yet (a frame without a draw): widen it.
        const end = Math.max(this.range.start + this.range.count, this.dirtyMax);
        this.range.start = Math.min(this.range.start, this.dirtyMin);
        this.range.count = end - this.range.start;
      } else {
        this.range.start = this.dirtyMin;
        this.range.count = this.dirtyMax - this.dirtyMin;
        pending.push(this.range);
      }
      this.buffer.needsUpdate = true;
      this.dirtyMin = Infinity;
      this.dirtyMax = -Infinity;
    }
    if (this.live === 0) {
      this.geometry.setDrawRange(0, 0);
      return 0;
    }
    if (this.tail < this.head) {
      this.geometry.setDrawRange(this.tail * 6, this.live * 6);
      return this.live * 2;
    }
    // The live window wraps around the end of the ring: one draw of the whole buffer (retired
    // quads in the gap are alpha 0 and discarded by the fragment shader).
    this.geometry.setDrawRange(0, this.capacity * 6);
    return this.capacity * 2;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
