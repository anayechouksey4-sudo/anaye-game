/**
 * The shadow ghost's tape: the player's pose at 10 Hz from GO (position, quaternion), quantized and
 * delta-coded (14 bytes per sample, ≤ 64 KB per run), saved per (track, car) under a versioned
 * localStorage key on a new best time, with LRU eviction at ~1.5 MB total. Pure (node-testable);
 * the recorder / player live in GhostCar.tsx.
 */
export const GHOST_HZ = 10;
export const GHOST_MAX_SAMPLES = 4600; // 14 B each + 20 B header → 64,420 B (7.6 min)
export const GHOST_KEY_PREFIX = 'gamerfleet.ghost.v1.';
export const GHOST_INDEX_KEY = 'gamerfleet.ghost.v1.index';
export const GHOST_BUDGET_BYTES = 1.5 * 1024 * 1024;
const POS_UNIT = 0.01; // m
const Q_SCALE = 32767;

export interface GhostTape {
  /** Samples at GHOST_HZ from GO. */
  n: number;
  /** x, y, z per sample (metres). */
  pos: Float32Array;
  /** x, y, z, w per sample. */
  quat: Float32Array;
  /** The run's finish time, ms. */
  finishMs: number;
  carId: string;
  trackId: string;
}

export class GhostRecorder {
  n = 0;
  readonly pos = new Float32Array(GHOST_MAX_SAMPLES * 3);
  readonly quat = new Float32Array(GHOST_MAX_SAMPLES * 4);
  reset(): void {
    this.n = 0;
  }
  push(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void {
    if (this.n >= GHOST_MAX_SAMPLES) return;
    const p = this.n * 3;
    const q = this.n * 4;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    this.quat[q] = qx;
    this.quat[q + 1] = qy;
    this.quat[q + 2] = qz;
    this.quat[q + 3] = qw;
    this.n++;
  }
  tape(trackId: string, carId: string, finishMs: number): GhostTape {
    return { n: this.n, pos: this.pos.slice(0, this.n * 3), quat: this.quat.slice(0, this.n * 4), finishMs, carId, trackId };
  }
}

export function ghostKey(trackId: string, carId: string): string {
  return `${GHOST_KEY_PREFIX}${trackId}.${carId}`;
}

/** Tape → bytes: a 20-byte header (n, finishMs, origin x/y/z in cm) then per sample Int16 Δpos (cm) and Int16 quaternion. */
export function encodeTape(t: GhostTape): Uint8Array {
  const buf = new ArrayBuffer(20 + t.n * 14);
  const dv = new DataView(buf);
  const q = (v: number) => Math.round(v / POS_UNIT);
  dv.setUint32(0, t.n, true);
  dv.setUint32(4, Math.max(0, Math.round(t.finishMs)), true);
  let cx = t.n > 0 ? q(t.pos[0]!) : 0;
  let cy = t.n > 0 ? q(t.pos[1]!) : 0;
  let cz = t.n > 0 ? q(t.pos[2]!) : 0;
  dv.setInt32(8, cx, true);
  dv.setInt32(12, cy, true);
  dv.setInt32(16, cz, true);
  let off = 20;
  for (let i = 0; i < t.n; i++) {
    // Deltas of the quantized positions: the decoder reconstructs the quantized track exactly (no drift).
    const dx = clamp16(q(t.pos[i * 3]!) - cx);
    const dy = clamp16(q(t.pos[i * 3 + 1]!) - cy);
    const dz = clamp16(q(t.pos[i * 3 + 2]!) - cz);
    dv.setInt16(off, dx, true);
    dv.setInt16(off + 2, dy, true);
    dv.setInt16(off + 4, dz, true);
    cx += dx;
    cy += dy;
    cz += dz;
    for (let k = 0; k < 4; k++) dv.setInt16(off + 6 + k * 2, Math.round(Math.max(-1, Math.min(1, t.quat[i * 4 + k]!)) * Q_SCALE), true);
    off += 14;
  }
  return new Uint8Array(buf);
}

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v;
}

/** Bytes → tape (null when malformed). */
export function decodeTape(bytes: Uint8Array, trackId: string, carId: string): GhostTape | null {
  if (bytes.byteLength < 20) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(0, true);
  if (n > GHOST_MAX_SAMPLES || bytes.byteLength < 20 + n * 14) return null;
  const finishMs = dv.getUint32(4, true);
  const pos = new Float32Array(n * 3);
  const quat = new Float32Array(n * 4);
  let cx = dv.getInt32(8, true);
  let cy = dv.getInt32(12, true);
  let cz = dv.getInt32(16, true);
  let off = 20;
  for (let i = 0; i < n; i++) {
    cx += dv.getInt16(off, true);
    cy += dv.getInt16(off + 2, true);
    cz += dv.getInt16(off + 4, true);
    pos[i * 3] = cx * POS_UNIT;
    pos[i * 3 + 1] = cy * POS_UNIT;
    pos[i * 3 + 2] = cz * POS_UNIT;
    for (let k = 0; k < 4; k++) quat[i * 4 + k] = dv.getInt16(off + 6 + k * 2, true) / Q_SCALE;
    off += 14;
  }
  return { n, pos, quat, finishMs, carId, trackId };
}

export function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

interface SavedGhost {
  v: 1;
  n: number;
  ms: number;
  data: string;
}

interface IndexRow {
  k: string;
  bytes: number;
  used: number;
}

function readIndex(): IndexRow[] {
  try {
    const raw = window.localStorage.getItem(GHOST_INDEX_KEY);
    const p: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(p) ? p.filter((r): r is IndexRow => !!r && typeof r.k === 'string' && typeof r.bytes === 'number' && typeof r.used === 'number') : [];
  } catch {
    return [];
  }
}

function writeIndex(rows: IndexRow[]): void {
  try {
    window.localStorage.setItem(GHOST_INDEX_KEY, JSON.stringify(rows));
  } catch {
    // ignore
  }
}

/** Save a tape for (track, car); evicts the least recently used tapes beyond the budget. */
export function saveGhost(tape: GhostTape): boolean {
  if (tape.n < 2) return false;
  const key = ghostKey(tape.trackId, tape.carId);
  const rec: SavedGhost = { v: 1, n: tape.n, ms: Math.round(tape.finishMs), data: bytesToBase64(encodeTape(tape)) };
  const text = JSON.stringify(rec);
  try {
    let rows = readIndex().filter((r) => r.k !== key);
    rows.push({ k: key, bytes: text.length, used: Date.now() });
    let total = rows.reduce((a, r) => a + r.bytes, 0);
    rows.sort((a, b) => a.used - b.used);
    while (total > GHOST_BUDGET_BYTES && rows.length > 1) {
      const gone = rows.shift()!;
      if (gone.k === key) {
        rows.unshift(gone);
        break;
      }
      window.localStorage.removeItem(gone.k);
      total -= gone.bytes;
    }
    window.localStorage.setItem(key, text);
    writeIndex(rows);
    return true;
  } catch {
    return false;
  }
}

export function loadGhost(trackId: string, carId: string): GhostTape | null {
  const key = ghostKey(trackId, carId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const rec = JSON.parse(raw) as Partial<SavedGhost>;
    if (rec.v !== 1 || typeof rec.data !== 'string') return null;
    const bytes = base64ToBytes(rec.data);
    const tape = bytes ? decodeTape(bytes, trackId, carId) : null;
    if (tape) {
      const rows = readIndex();
      const row = rows.find((r) => r.k === key);
      if (row) {
        row.used = Date.now();
        writeIndex(rows);
      }
    }
    return tape;
  } catch {
    return null;
  }
}

export function ghostStorageStats(): { tapes: number; bytes: number } {
  const rows = readIndex();
  return { tapes: rows.length, bytes: rows.reduce((a, r) => a + r.bytes, 0) };
}

/** Pose at `tSec` since GO (linear position, normalised lerp of the quaternion); clamps to the ends. Returns false before the first sample exists. */
export function sampleTape(t: GhostTape, tSec: number, out: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number }): boolean {
  if (t.n === 0) return false;
  const f = Math.max(0, Math.min(t.n - 1, tSec * GHOST_HZ));
  const i = Math.min(t.n - 1, Math.floor(f));
  const j = Math.min(t.n - 1, i + 1);
  const u = f - i;
  const p = t.pos;
  const q = t.quat;
  out.x = p[i * 3]! + (p[j * 3]! - p[i * 3]!) * u;
  out.y = p[i * 3 + 1]! + (p[j * 3 + 1]! - p[i * 3 + 1]!) * u;
  out.z = p[i * 3 + 2]! + (p[j * 3 + 2]! - p[i * 3 + 2]!) * u;
  let ax = q[i * 4]!;
  let ay = q[i * 4 + 1]!;
  let az = q[i * 4 + 2]!;
  let aw = q[i * 4 + 3]!;
  let bx = q[j * 4]!;
  let by = q[j * 4 + 1]!;
  let bz = q[j * 4 + 2]!;
  let bw = q[j * 4 + 3]!;
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let x = ax + (bx - ax) * u;
  let y = ay + (by - ay) * u;
  let z = az + (bz - az) * u;
  let w = aw + (bw - aw) * u;
  const len = Math.hypot(x, y, z, w) || 1;
  out.qx = x / len;
  out.qy = y / len;
  out.qz = z / len;
  out.qw = w / len;
  return true;
}
