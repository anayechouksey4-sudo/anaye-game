/**
 * `window.__ROOM__` — the room client for tests and the console: state, actions, the relay clock,
 * the remote cars' live positions and the pose counters. Installed by the room client.
 */
import { remoteList, remoteStats } from './remotePlayers';
import { sceneProbe } from './sceneProbe';
import type { RoomClient } from './roomClient';
import { roomState, useRoom, type RoomState } from './roomStore';

export interface RoomDebugHandle {
  state(): Omit<RoomState, 'set' | 'reset'>;
  host(size?: number): boolean;
  join(code: string): boolean;
  leave(to?: string): void;
  /** Host: room size / remove a player / hand the host role over. */
  setSize(size: number): boolean;
  remove(id: string): boolean;
  makeHost(id: string): boolean;
  /** Every car drawn in the scene graph right now (KinematicCar groups: rivals, ghost, friends) with its name tag text. */
  sceneCars(): { kind: string; label: string; visible: boolean }[];
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
    host: (size) => client.host(size),
    join: (code) => client.join(code),
    leave: (to) => client.leave(to),
    setSize: (size) => client.setSize(size),
    remove: (id) => client.remove(id),
    makeHost: (id) => client.makeHost(id),
    sceneCars: () => {
      const out: { kind: string; label: string; visible: boolean }[] = [];
      sceneProbe.scene?.traverse((o) => {
        if (o.name !== 'kinematic-car') return;
        // Rivals sit under <group name="rivals">, the ghost under "ghost", friends under "friend:<name>" (remote-players).
        let kind = 'other';
        let label = '';
        for (let p = o.parent; p; p = p.parent) {
          if (p.name === 'rivals') kind = 'rival';
          else if (p.name === 'ghost') kind = 'ghost';
          else if (p.name.startsWith('friend:')) {
            kind = 'friend';
            label = p.name.slice(7);
          }
        }
        let visible = true;
        for (let p: typeof o | null = o; p; p = p.parent) if (!p.visible) visible = false;
        out.push({ kind, label, visible });
      });
      return out;
    },
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
