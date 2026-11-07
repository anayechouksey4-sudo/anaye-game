/**
 * Remote players' poses: a ring of timestamped samples per player (relay-clock time), read from
 * useFrame at `relayNow − INTERP_DELAY_MS` with linear / slerp interpolation between the two
 * bracketing samples, dead reckoning up to EXTRAPOLATE_MAX_MS past the newest one, frozen beyond
 * that, and a hard snap when the drawn car is more than SNAP_DISTANCE_M from where it should be.
 *
 * Pure data (no React, no store): `pushPose` from the socket, `sampleRemote` from the render loop,
 * `KinematicPose` objects mutated in place (rivals/KinematicCar reads them without re-rendering).
 */
import { Quaternion, Vector3 } from 'three';
import type { RoomPose } from '@shared/protocol';
import type { KinematicPose } from '../rivals/KinematicCar';

/** Render this far behind the newest pose so there is nearly always a sample pair to interpolate. */
export const INTERP_DELAY_MS = 100;
/** Dead-reckon at most this long past the newest sample (a dropped frame or two), then freeze. */
export const EXTRAPOLATE_MAX_MS = 250;
/** Drawn car further than this from its target jumps there instead of easing. */
export const SNAP_DISTANCE_M = 2;
/** Corrections smaller than this are applied exactly (the buffer is already smooth); larger ones ease over ~100 ms. */
export const EASE_THRESHOLD_M = 0.3;
/** Samples kept per player (≈ 2 s at 15 Hz). */
const BUFFER_MAX = 32;
/** Nothing heard for this long: the car is marked stale (drawn faded; the layer may hide it). */
export const STALE_MS = 3000;

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  s: number;
  st: number;
}

export interface RemotePlayer {
  id: string;
  pose: KinematicPose;
  samples: Sample[];
  /** Local performance.now() of the last pose. */
  lastReceivedAt: number;
  /** Relay time of the newest sample. */
  newestT: number;
  /** Relay time the drawn pose stands for (the renderT of the last sampleRemote). */
  renderT: number;
  lastGate: number;
  progressM: number;
  /** Poses received for this player. */
  count: number;
  /** Set once the first sample placed the car (before that the pose is not meaningful). */
  placed: boolean;
  stale: boolean;
  /** Live opacity for KinematicCar's `fade` prop (stale cars dim). */
  fade: { opacity: number };
}

export const remoteStats = { posesIn: 0, bytesIn: 0, snaps: 0, extrapolatedFrames: 0, frozenFrames: 0 };

const remotes = new Map<string, RemotePlayer>();
const _target = new Vector3();
const _q = new Quaternion();
const _qa = new Quaternion();
const _qb = new Quaternion();

export const remoteOf = (id: string): RemotePlayer | undefined => remotes.get(id);
export const remoteIds = (): string[] => [...remotes.keys()];
export const remoteCount = (): number => remotes.size;

export function ensureRemote(id: string): RemotePlayer {
  let r = remotes.get(id);
  if (!r) {
    r = {
      id,
      pose: { position: new Vector3(0, -1000, 0), quaternion: new Quaternion(), speedKmh: 0, steer: 0 },
      samples: [],
      lastReceivedAt: 0,
      newestT: -Infinity,
      renderT: 0,
      lastGate: 0,
      progressM: 0,
      count: 0,
      placed: false,
      stale: false,
      fade: { opacity: 1 },
    };
    remotes.set(id, r);
  }
  return r;
}

export function removeRemote(id: string): void {
  remotes.delete(id);
}

export function clearRemotes(): void {
  remotes.clear();
}

/** A pose from the socket (already sanitized by parseMessage). Out-of-order samples are dropped. */
export function pushPose(pose: RoomPose, bytes = 0, localNow: number = performance.now()): RemotePlayer {
  const r = ensureRemote(pose.id);
  remoteStats.posesIn += 1;
  remoteStats.bytesIn += bytes;
  r.count += 1;
  r.lastReceivedAt = localNow;
  r.stale = false;
  r.lastGate = pose.g;
  r.progressM = pose.pm;
  if (pose.t <= r.newestT) return r;
  r.newestT = pose.t;
  r.samples.push({ t: pose.t, x: pose.p[0], y: pose.p[1], z: pose.p[2], qx: pose.q[0], qy: pose.q[1], qz: pose.q[2], qw: pose.q[3], s: pose.s, st: pose.st });
  if (r.samples.length > BUFFER_MAX) r.samples.shift();
  if (!r.placed) {
    r.pose.position.set(pose.p[0], pose.p[1], pose.p[2]);
    r.pose.quaternion.set(pose.q[0], pose.q[1], pose.q[2], pose.q[3]).normalize();
    r.placed = true;
  }
  return r;
}

/**
 * Write the pose for relay time `renderT` (the caller passes relayNow − INTERP_DELAY_MS) into
 * `r.pose`. `dt` is the frame time in seconds for the easing toward the target.
 */
export function sampleRemote(r: RemotePlayer, renderT: number, dt: number, localNow: number = performance.now()): void {
  const n = r.samples.length;
  if (n === 0) return;
  r.renderT = renderT;
  r.stale = localNow - r.lastReceivedAt > STALE_MS;
  const wantOpacity = r.stale ? 0.35 : 1;
  r.fade.opacity += (wantOpacity - r.fade.opacity) * Math.min(1, dt * 4);

  const last = r.samples[n - 1]!;
  let speed = last.s;
  let steer = last.st;
  if (renderT <= r.samples[0]!.t) {
    const first = r.samples[0]!;
    _target.set(first.x, first.y, first.z);
    _q.set(first.qx, first.qy, first.qz, first.qw);
    speed = first.s;
    steer = first.st;
  } else if (renderT >= last.t) {
    const age = renderT - last.t;
    _q.set(last.qx, last.qy, last.qz, last.qw);
    if (age <= EXTRAPOLATE_MAX_MS && n >= 2) {
      const prev = r.samples[n - 2]!;
      const span = Math.max(1, last.t - prev.t);
      const k = age / span;
      _target.set(last.x + (last.x - prev.x) * k, last.y + (last.y - prev.y) * k, last.z + (last.z - prev.z) * k);
      remoteStats.extrapolatedFrames += 1;
    } else {
      _target.set(last.x, last.y, last.z);
      if (age > EXTRAPOLATE_MAX_MS) {
        remoteStats.frozenFrames += 1;
        speed = 0;
      }
    }
  } else {
    // Bracketing pair (search from the newest end: renderT is normally near it).
    let i = n - 2;
    while (i > 0 && r.samples[i]!.t > renderT) i--;
    const a = r.samples[i]!;
    const b = r.samples[i + 1]!;
    const alpha = (renderT - a.t) / Math.max(1, b.t - a.t);
    _target.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
    _qa.set(a.qx, a.qy, a.qz, a.qw);
    _qb.set(b.qx, b.qy, b.qz, b.qw);
    _q.copy(_qa).slerp(_qb, alpha);
    speed = a.s + (b.s - a.s) * alpha;
    steer = a.st + (b.st - a.st) * alpha;
    // Drop samples that are too old to be needed again.
    if (i > 1) r.samples.splice(0, i - 1);
  }

  const err = r.pose.position.distanceTo(_target);
  if (err > SNAP_DISTANCE_M) {
    r.pose.position.copy(_target);
    r.pose.quaternion.copy(_q);
    remoteStats.snaps += 1;
  } else if (err > EASE_THRESHOLD_M) {
    // A visible correction (after dead reckoning, a late burst): close it over ~100 ms rather than in one frame.
    const k = 1 - Math.exp(-dt * 25);
    r.pose.position.lerp(_target, k);
    r.pose.quaternion.slerp(_q, k);
  } else {
    r.pose.position.copy(_target);
    r.pose.quaternion.copy(_q);
  }
  r.pose.quaternion.normalize();
  r.pose.speedKmh = speed;
  r.pose.steer = steer;
}

/** Everyone in the registry (debug / tests; identities come from the room store). */
export const remoteList = (): RemotePlayer[] => [...remotes.values()];

/** Visit everyone without allocating (the render loop's sampler). */
export function forEachRemote(fn: (r: RemotePlayer) => void): void {
  for (const r of remotes.values()) fn(r);
}
