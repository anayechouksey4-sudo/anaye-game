/**
 * The room client: rides on the relay socket the game already keeps (net/squadLink.ts), owns the
 * relay clock estimate, sends our pose at 15 Hz, keeps the remote players' registry and their
 * standings entries in step with the member list, and exposes the actions the FRIENDS tab calls.
 *
 *   installRoomClient(link)  — from useSquadLink; one per socket, StrictMode-safe (uninstall returns)
 *   roomActions              — host / join / leave / ready / start / shareUrl (UI + window.__ROOM__)
 *   relayNow()               — the relay's clock as this page estimates it (race timing)
 *
 * `?room=CODE` in the URL joins that room as soon as the socket is open (the profile is already
 * loaded: the stores read localStorage synchronously). A socket loss drops the room (the relay
 * forgets us on disconnect); when the socket is back we re-join the same code automatically.
 */
import {
  ROOM_COUNTDOWN_LEAD_MS,
  isCarClassId,
  sanitizeRoomCode,
  type OutgoingMessage,
  type ProtocolMessage,
  type RoomPlayer,
  type RoomRace,
} from '@shared/protocol';
import { carRuntime } from '../car/runtime';
import { getQueryParam } from '../config';
import type { SquadLink } from '../net/squadLink';
import { registerParticipant, resetProgress, routeProgressOf, setFinished, setProgress, standingsRoute } from '../rivals/standings';
import { useProfile } from '../state/profile';
import { selectionState, useSelection } from '../state/selection';
import { gameState } from '../state/store';
import { getTrackEntry } from '../track/catalog';
import { resolveTrackId } from '../track/registry';
import { ClockSync } from './clockSync';
import { decodePlayer, identityKey, localIdentity } from './identity';
import { createPoseSender, type PoseSender } from './poseSender';
import { installRaceFlow } from './raceFlow';
import { clearRemotes, ensureRemote, pushPose, removeRemote } from './remotePlayers';
import { installRoomDebug } from './roomDebug';
import { isHost, roomState, useRoom } from './roomStore';

const PING_BURST = 5;
const PING_BURST_GAP_MS = 150;
const PING_INTERVAL_MS = 5000;
const JOIN_TIMEOUT_MS = 8000;
const IDENTITY_THROTTLE_MS = 300;

export class RoomClient {
  readonly clock = new ClockSync();
  readonly stats = { sent: 0, bytesOut: 0, finishesSent: 0 };
  private readonly offs: (() => void)[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private burstTimer: ReturnType<typeof setTimeout> | null = null;
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private identityTimer: ReturnType<typeof setTimeout> | null = null;
  private lastIdentityKey = '';
  /** Remote id → standings unregister, keyed by what was registered (name / car), to re-register on a change. */
  private readonly participants = new Map<string, { key: string; off: () => void }>();
  private readonly finishedSeen = new Set<string>();
  private rejoinCode: string | null = null;
  readonly poses: PoseSender;
  readonly link: SquadLink;

  constructor(link: SquadLink) {
    this.link = link;
    this.poses = createPoseSender({
      send: (m) => this.send(m),
      now: () => this.clock.now(),
      progress: () => this.playerProgress(),
    });
  }

  install(): () => void {
    const store = useRoom.getState();
    const fromUrl = sanitizeRoomCode(getQueryParam('room'));
    store.set({ status: 'offline', pendingCode: fromUrl });
    this.offs.push(this.link.onOpen(() => this.onOpen()));
    this.offs.push(this.link.onClose(() => this.onClose()));
    this.offs.push(this.link.onMessage((m) => this.onMessage(m)));
    const identityChanged = () => this.scheduleIdentity();
    this.offs.push(useProfile.subscribe(identityChanged));
    this.offs.push(useSelection.subscribe((s, prev) => (s.carId !== prev.carId || s.plates !== prev.plates ? identityChanged() : undefined)));
    this.offs.push(
      installRaceFlow({
        relayNow: () => this.clock.now(),
        sendRace: (race) => this.sendRace(race),
        finish: (finishMs, falls) => this.sendFinish(finishMs, falls),
      }),
    );
    this.offs.push(installRoomDebug(this));
    if (this.link.connected) this.onOpen();
    return () => {
      for (const off of this.offs.splice(0)) off();
      this.stopTimers();
      this.poses.stop();
      this.dropRoom('idle', null);
      useRoom.getState().set({ status: 'offline' });
    };
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  host(): boolean {
    if (!this.canAct()) return false;
    useRoom.getState().set({ status: 'joining', error: null, left: null });
    this.armJoinTimeout();
    return this.send({ type: 'room:create', ...localIdentity() });
  }

  join(codeInput: string): boolean {
    const code = sanitizeRoomCode(codeInput);
    if (!code) {
      useRoom.getState().set({ error: { code: 'bad_code', message: 'A room code is 4 letters (no vowels)', at: Date.now() } });
      return false;
    }
    if (!this.canAct()) return false;
    useRoom.getState().set({ status: 'joining', error: null, left: null, pendingCode: null });
    this.armJoinTimeout();
    return this.send({ type: 'room:join', code, ...localIdentity() });
  }

  leave(): void {
    this.rejoinCode = null;
    if (roomState().status === 'in-room') this.send({ type: 'room:leave' });
    this.dropRoom('idle', 'left');
  }

  ready(on: boolean): boolean {
    if (roomState().status !== 'in-room') return false;
    return this.send({ type: 'room:ready', ready: on });
  }

  /** Host: START → everyone's lights go out at relayNow + ROOM_COUNTDOWN_LEAD_MS. */
  start(): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s) || !s.race) return false;
    const track = s.race.track ?? resolveTrackId(selectionState().trackId);
    if (getTrackEntry(track).mode === 'roam') return false;
    if (s.race.phase === 'countdown' || s.race.phase === 'racing') return false;
    return this.sendRace({ phase: 'countdown', track, startAt: Math.round(this.clock.now() + ROOM_COUNTDOWN_LEAD_MS) });
  }

  /** The link friends open: this page's origin + path with ?room=CODE (and the relay, when the URL names one). */
  shareUrl(): string | null {
    const code = roomState().code;
    if (!code || typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    const ws = url.searchParams.get('ws');
    url.search = '';
    url.hash = '';
    if (ws && !['off', 'none', '0', 'false'].includes(ws.toLowerCase())) url.searchParams.set('ws', ws);
    url.searchParams.set('room', code);
    return url.toString();
  }

  relayNow(): number {
    return this.clock.now();
  }

  // ── Socket events ────────────────────────────────────────────────────────

  private onOpen(): void {
    const s = useRoom.getState();
    if (s.status === 'offline' || s.status === 'joining') s.set({ status: 'idle' });
    this.clock.reset();
    this.startPings();
    const code = this.rejoinCode ?? s.pendingCode;
    if (code) {
      this.rejoinCode = null;
      // A few pongs first: the join answer carries serverNow and the race needs the clock anyway.
      setTimeout(() => {
        if (this.link.connected && roomState().status === 'idle') this.join(code);
      }, PING_BURST_GAP_MS * 2);
    }
  }

  private onClose(): void {
    this.stopTimers();
    const s = roomState();
    if (s.status === 'in-room' && s.code) this.rejoinCode = s.code;
    this.dropRoom('offline', s.status === 'in-room' ? 'link' : null);
  }

  private onMessage(message: ProtocolMessage): void {
    const store = useRoom.getState();
    switch (message.type) {
      case 'room:pong': {
        this.clock.addSample(message.t, performance.now(), message.serverNow);
        store.set({ clock: { offsetMs: this.clock.offsetMs, rttMs: this.clock.rttMs, samples: this.clock.count } });
        return;
      }
      case 'room:joined': {
        this.clearJoinTimeout();
        // One more clock sample for free: the join answer carries the relay's clock.
        if (!this.clock.synced) this.clock.addSample(performance.now() - (this.clock.rttMs ?? 40), performance.now(), message.serverNow);
        store.set({
          status: 'in-room',
          code: message.code,
          you: message.you,
          players: message.players,
          race: message.race,
          participant: message.race.results.some((r) => r.id === message.you),
          error: null,
          left: null,
          pendingCode: null,
          goAt: null,
        });
        this.lastIdentityKey = identityKey(localIdentity());
        this.finishedSeen.clear();
        this.syncParticipants(message.players, message.you);
        this.applyFinishes(message.race);
        this.poses.start();
        return;
      }
      case 'room:players': {
        if (roomState().status !== 'in-room') return;
        store.set({ players: message.players });
        this.syncParticipants(message.players, roomState().you);
        return;
      }
      case 'room:pose': {
        if (roomState().status !== 'in-room' || !message.id) return;
        const r = pushPose({ ...message, id: message.id }, approxBytes(message));
        if (this.participants.has(message.id)) setProgress(message.id, r.progressM);
        return;
      }
      case 'room:race': {
        if (roomState().status !== 'in-room') return;
        const race: RoomRace = { phase: message.phase, track: message.track, startAt: message.startAt, results: message.results };
        const you = roomState().you;
        const prev = roomState().race;
        const patch: Partial<ReturnType<typeof roomState>> = { race, participant: race.results.some((r) => r.id === you) };
        if (race.phase === 'results') patch.lastResults = race;
        if (race.phase === 'countdown' && (!prev || prev.startAt !== race.startAt)) {
          this.finishedSeen.clear();
          for (const id of this.participants.keys()) resetProgress(id);
        }
        store.set(patch);
        this.applyFinishes(race);
        return;
      }
      case 'room:left': {
        this.rejoinCode = null;
        this.dropRoom('idle', message.reason);
        if (message.reason === 'expired') store.set({ error: { code: 'not_found', message: 'The room expired (2 h idle)', at: Date.now() } });
        return;
      }
      case 'room:error': {
        this.clearJoinTimeout();
        const patch: Partial<ReturnType<typeof roomState>> = { error: { code: message.code, message: message.message, at: Date.now() } };
        if (roomState().status === 'joining') patch.status = 'idle';
        store.set(patch);
        return;
      }
      default:
        return;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private canAct(): boolean {
    const s = roomState();
    if (!this.link.connected) {
      s.set({ error: { code: 'link', message: 'Not connected to a relay', at: Date.now() } });
      return false;
    }
    return s.status === 'idle';
  }

  private send(message: OutgoingMessage): boolean {
    const ok = this.link.send(message);
    if (ok) {
      this.stats.sent += 1;
      this.stats.bytesOut += approxBytes(message);
    }
    return ok;
  }

  private sendRace(race: Omit<RoomRace, 'results'>): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s)) return false;
    return this.send({ type: 'room:race', ...race, results: [] });
  }

  private sendFinish(finishMs: number, falls: number): boolean {
    if (roomState().status !== 'in-room') return false;
    this.stats.finishesSent += 1;
    return this.send({ type: 'room:finish', finishMs: Math.round(finishMs), falls });
  }

  /** Metres along the race route for our car (the standings' projection; a gate-based fallback without a route). */
  private playerProgress(): number {
    const run = gameState().run;
    if (standingsRoute()) return routeProgressOf(carRuntime.position, run.checkpoint);
    const layout = gameState().trackLayout;
    const next = layout?.checkpoints[run.checkpoint + 1] ?? layout?.finish;
    let toward = 0;
    if (next) {
      const dx = next.position[0] - carRuntime.position.x;
      const dz = next.position[2] - carRuntime.position.z;
      toward = 1000 - Math.min(999, Math.hypot(dx, dz));
    }
    return run.checkpoint * 1000 + (run.finished ? 1000 : toward);
  }

  /** Register / unregister remote standings entries and registry slots to match the member list. */
  private syncParticipants(players: RoomPlayer[], you: string | null): void {
    const present = new Set<string>();
    players.forEach((p, index) => {
      if (p.id === you) return;
      present.add(p.id);
      ensureRemote(p.id);
      const key = `${p.name}|${p.carId}`;
      const current = this.participants.get(p.id);
      if (current?.key === key) return;
      current?.off();
      const off = registerParticipant({
        id: p.id,
        name: p.name,
        carId: isCarClassId(p.carId) ? p.carId : 'hypercar',
        kind: 'remote',
        color: decodePlayer(p, index).color,
      });
      this.participants.set(p.id, { key, off });
    });
    for (const [id, entry] of [...this.participants]) {
      if (present.has(id)) continue;
      entry.off();
      this.participants.delete(id);
      removeRemote(id);
    }
  }

  private applyFinishes(race: RoomRace): void {
    const key = `${race.startAt ?? 0}:`;
    for (const row of race.results) {
      if (row.finishMs === null || !this.participants.has(row.id)) continue;
      const tag = key + row.id;
      if (this.finishedSeen.has(tag)) continue;
      this.finishedSeen.add(tag);
      setFinished(row.id, row.finishMs);
    }
  }

  private dropRoom(status: 'idle' | 'offline', left: 'left' | 'expired' | 'closed' | 'link' | null): void {
    this.clearJoinTimeout();
    this.poses.stop();
    for (const entry of this.participants.values()) entry.off();
    this.participants.clear();
    this.finishedSeen.clear();
    clearRemotes();
    useRoom.getState().reset(status, left);
  }

  private scheduleIdentity(): void {
    if (roomState().status !== 'in-room' || this.identityTimer) return;
    this.identityTimer = setTimeout(() => {
      this.identityTimer = null;
      if (roomState().status !== 'in-room') return;
      const identity = localIdentity();
      const key = identityKey(identity);
      if (key === this.lastIdentityKey) return;
      this.lastIdentityKey = key;
      this.send({ type: 'room:update', ...identity });
    }, IDENTITY_THROTTLE_MS);
  }

  private startPings(): void {
    this.stopTimers();
    let burst = 0;
    const ping = () => this.send({ type: 'room:ping', t: performance.now(), ...(this.clock.rttMs !== null ? { rtt: this.clock.rttMs } : {}) });
    const next = () => {
      ping();
      if (++burst < PING_BURST) this.burstTimer = setTimeout(next, PING_BURST_GAP_MS);
      else this.burstTimer = null;
    };
    next();
    this.pingTimer = setInterval(ping, PING_INTERVAL_MS);
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.burstTimer) clearTimeout(this.burstTimer);
    if (this.identityTimer) clearTimeout(this.identityTimer);
    this.pingTimer = null;
    this.burstTimer = null;
    this.identityTimer = null;
  }

  private armJoinTimeout(): void {
    this.clearJoinTimeout();
    this.joinTimer = setTimeout(() => {
      this.joinTimer = null;
      if (roomState().status === 'joining') {
        useRoom.getState().set({ status: 'idle', error: { code: 'timeout', message: 'The relay did not answer (is it this version?)', at: Date.now() } });
      }
    }, JOIN_TIMEOUT_MS);
  }

  private clearJoinTimeout(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
  }
}

const approxBytes = (message: object): number => JSON.stringify(message).length + 24;

let active: RoomClient | null = null;

/** Mount the room client on a link (useSquadLink). Returns the uninstall function. */
export function installRoomClient(link: SquadLink): () => void {
  const client = new RoomClient(link);
  active = client;
  const uninstall = client.install();
  return () => {
    uninstall();
    if (active === client) active = null;
  };
}

/** `?ws=off`: no socket, so no rooms. */
export function markRoomsOffline(): void {
  useRoom.getState().set({ status: 'offline' });
}

export const roomClient = (): RoomClient | null => active;

/** The relay clock estimate (0-offset before the first pong). */
export const relayNow = (): number => active?.clock.now() ?? performance.now();

/** What the FRIENDS tab calls. Every action is a no-op (returning false) without a link. */
export const roomActions = {
  host: (): boolean => active?.host() ?? false,
  join: (code: string): boolean => active?.join(code) ?? false,
  leave: (): void => active?.leave(),
  ready: (on: boolean): boolean => active?.ready(on) ?? false,
  start: (): boolean => active?.start() ?? false,
  shareUrl: (): string | null => active?.shareUrl() ?? null,
};
