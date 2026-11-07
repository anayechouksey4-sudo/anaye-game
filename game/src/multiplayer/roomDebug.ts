/**
 * `window.__ROOM__` — the room client for tests and the console: state, actions, the relay clock,
 * the remote cars' live positions and the pose counters. Installed by the room client.
 */
import { remoteList, remoteStats } from './remotePlayers';
import type { RoomClient } from './roomClient';
import { roomState, useRoom, type RoomState } from './roomStore';

export interface RoomDebugHandle {
  state(): Omit<RoomState, 'set' | 'reset'>;
  host(): boolean;
  join(code: string): boolean;
  leave(): void;
  ready(on: boolean): boolean;
  start(): boolean;
  shareUrl(): string | null;
  relayNow(): number;
  clock(): { offsetMs: number; rttMs: number | null; samples: number; synced: boolean };
  remotes(): { id: string; x: number; y: number; z: number; t: number; speedKmh: number; count: number; stale: boolean; placed: boolean; progressM: number; gate: number }[];
  stats(): { sent: number; bytesOut: number; finishesSent: number; poses: { sent: number; bytes: number; skippedHidden: number }; in: typeof remoteStats };
  /** Resolves when the room state matches (test helper). */
  waitFor(predicate: (s: RoomState) => boolean, timeoutMs?: number): Promise<RoomState>;
}

declare global {
  interface Window {
    __ROOM__?: RoomDebugHandle;
  }
}

export function installRoomDebug(client: RoomClient): () => void {
  if (typeof window === 'undefined') return () => {};
  const handle: RoomDebugHandle = {
    state: () => {
      const { set: _set, reset: _reset, ...rest } = roomState();
      return rest;
    },
    host: () => client.host(),
    join: (code) => client.join(code),
    leave: () => client.leave(),
    ready: (on) => client.ready(on),
    start: () => client.start(),
    shareUrl: () => client.shareUrl(),
    relayNow: () => client.relayNow(),
    clock: () => ({ offsetMs: client.clock.offsetMs, rttMs: client.clock.rttMs, samples: client.clock.count, synced: client.clock.synced }),
    remotes: () =>
      remoteList().map((r) => ({
        id: r.id,
        x: r.pose.position.x,
        y: r.pose.position.y,
        z: r.pose.position.z,
        t: r.renderT,
        speedKmh: r.pose.speedKmh,
        count: r.count,
        stale: r.stale,
        placed: r.placed,
        progressM: r.progressM,
        gate: r.lastGate,
      })),
    stats: () => ({ ...client.stats, poses: { ...client.poses.stats }, in: { ...remoteStats } }),
    waitFor: (predicate, timeoutMs = 10_000) =>
      new Promise((resolve, reject) => {
        if (predicate(roomState())) return resolve(roomState());
        const timer = setTimeout(() => {
          off();
          reject(new Error('timed out waiting for room state'));
        }, timeoutMs);
        const off = useRoom.subscribe((s) => {
          if (!predicate(s)) return;
          clearTimeout(timer);
          off();
          resolve(s);
        });
      }),
  };
  window.__ROOM__ = handle;
  return () => {
    if (window.__ROOM__ === handle) delete window.__ROOM__;
  };
}
