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
 * loaded: the stores read localStorage synchronously). A socket loss drops the room locally; when the
 * socket is back we re-join the same code automatically with this device's player token
 * (friendsProfile.ts), and a relay with seats gives us back the same seat (room:joined {restored}):
 * same member id, host role and results row. An old relay just adds us as a new member.
 * A reload (Android discards a background tab while the host shares the link) does the same: the
 * room this tab was seated in is kept (friendsProfile.ts rememberSeat) and re-joined when the page
 * comes back within the relay's seat grace, so the host is still the host.
 *
 * Sign-in and time zone (milestone 6, auth/wire.ts): every room:create / room:join / room:update carries
 * the device time zone, and the Google ID token while signed in (null once after SIGN OUT). Signing in or
 * out while connected tells the relay at once with a room:update: in a room it refreshes our badge for
 * everyone; outside a room the relay still records it on the socket and answers 'not_in_room', which is
 * expected and not shown. server:welcome.signIn says whether this relay verifies Google tokens (the
 * FRIENDS sign-in row and the host's SIGNED-IN PLAYERS ONLY switch); server:announce feeds the owner's
 * banner (hud/announce.ts).
 */
import {
  ROOM_COUNTDOWN_LEAD_MS,
  ROOM_SEAT_GRACE_MS,
  isCarClassId,
  sanitizeRoomCode,
  type OutgoingMessage,
  type ProtocolMessage,
  type RoomLeftReason,
  type RoomPlayer,
  type RoomRace,
} from '@shared/protocol';
import { noteSignInRequired, setRelaySignIn, useAuth } from '../auth/authStore';
import { authChangePending, roomAuthFields } from '../auth/wire';
import { carRuntime } from '../car/runtime';
import { getQueryParam } from '../config';
import { receiveAnnounce } from '../hud/announce';
import type { SquadLink } from '../net/squadLink';
import { registerParticipant, resetProgress, routeProgressOf, setFinished, setProgress, setReportedSpeed, standingsRoute } from '../rivals/standings';
import { useProfile } from '../state/profile';
import { selectionState, useSelection } from '../state/selection';
import { gameState } from '../state/store';
import { getTrackEntry } from '../track/catalog';
import { resolveTrackId } from '../track/registry';
import { ClockSync } from './clockSync';
import { forgetSeat, friendsProfile, rememberSeat, seatToRestore, useFriendsProfile } from './friendsProfile';
import { decodePlayer, identityKey, localIdentity } from './identity';
import { createPoseSender, type PoseSender } from './poseSender';
import { installRaceFlow } from './raceFlow';
import { clearRemotes, ensureRemote, pushPose, removeRemote } from './remotePlayers';
import { installRoomDebug } from './roomDebug';
import { isHost, isStaleRoomError, roomLeftNotice, roomState, useRoom } from './roomStore';

const PING_BURST = 5;
const PING_BURST_GAP_MS = 150;
const PING_INTERVAL_MS = 5000;
const JOIN_TIMEOUT_MS = 8000;
const IDENTITY_THROTTLE_MS = 300;
/** How often the saved seat's "last alive in the room" time is refreshed while seated. */
const SEAT_REFRESH_MS = 2000;

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
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;
  /** The room code this tab is asking the other tabs about on start (seat restore), until they answer. */
  private askingSeat: string | null = null;
  private seatSavedAt = 0;
  /** room:update frames sent outside a room to carry a sign-in change: their 'not_in_room' answer is expected. */
  private authProbes = 0;
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
    // A reload while seated (no ?room= in the host's own address): take the seat back like a link blip.
    const restore = fromUrl ? null : seatToRestore(ROOM_SEAT_GRACE_MS);
    const restoreCode = restore ? sanitizeRoomCode(restore.code) : null;
    store.set({ status: 'offline', pendingCode: fromUrl, ...(restoreCode ? { rejoining: restoreCode } : {}) });
    this.offs.push(this.answerSeatQueries());
    if (restore && restoreCode) {
      // A duplicated tab (Chrome's Duplicate, window.open) inherits this tab's saved seat: ask the other
      // live tabs first and only take the seat back when none of them holds it.
      this.askingSeat = restoreCode;
      void askTabsForSeat(restoreCode).then((held) => {
        this.askingSeat = null;
        if (roomState().rejoining !== restoreCode) return;
        if (held) {
          forgetSeat(true);
          roomState().set({ rejoining: null });
          return;
        }
        this.rejoinCode = restoreCode;
        if (this.link.connected && roomState().status === 'idle') this.join(restoreCode);
      });
      // The relay frees the seat after its grace; stop waiting for it then (rooms mode ends, AI rivals may return).
      // Cleared the moment we are seated again (room:joined), so a later link blip still re-joins.
      this.restoreTimer = setTimeout(() => {
        this.restoreTimer = null;
        const now = roomState();
        if (now.status !== 'in-room' && now.rejoining === restoreCode) {
          this.rejoinCode = null;
          now.set({ rejoining: null });
          forgetSeat();
        }
      }, restore.leftMs);
    }
    const saveSeat = () => {
      const now = roomState();
      if (now.status === 'in-room' && now.code) rememberSeat(now.code);
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveSeat();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', saveSeat);
      document.addEventListener('visibilitychange', onHide);
      this.offs.push(() => {
        window.removeEventListener('pagehide', saveSeat);
        document.removeEventListener('visibilitychange', onHide);
      });
    }
    this.offs.push(this.link.onOpen(() => this.onOpen()));
    this.offs.push(this.link.onClose(() => this.onClose()));
    this.offs.push(this.link.onMessage((m) => this.onMessage(m)));
    const identityChanged = () => this.scheduleIdentity();
    this.offs.push(useProfile.subscribe(identityChanged));
    this.offs.push(useFriendsProfile.subscribe((s, prev) => (s.name !== prev.name ? identityChanged() : undefined)));
    this.offs.push(useSelection.subscribe((s, prev) => (s.carId !== prev.carId || s.plates !== prev.plates ? identityChanged() : undefined)));
    this.offs.push(useAuth.subscribe((s, prev) => (s.status !== prev.status || s.serial !== prev.serial ? this.pushAuth() : undefined)));
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
      this.clearRestoreTimer();
      this.stopTimers();
      this.poses.stop();
      this.dropRoom('idle', null);
      useRoom.getState().set({ status: 'offline' });
    };
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  /** Open a room of `size` seats (FRIENDS · ROOM SIZE; the last pick by default). */
  host(size: number = friendsProfile().size): boolean {
    if (!this.canAct()) return false;
    useRoom.getState().set({ status: 'joining', error: null, left: null, rejoining: null });
    this.armJoinTimeout();
    return this.send({ type: 'room:create', ...localIdentity(), token: friendsProfile().token, size, ...roomAuthFields({ force: true }) });
  }

  join(codeInput: string): boolean {
    const code = sanitizeRoomCode(codeInput);
    if (!code) {
      useRoom.getState().set({ error: { code: 'bad_code', message: 'A room code is 4 letters (no vowels)', at: Date.now() } });
      return false;
    }
    if (!this.canAct()) return false;
    // `lastCode` refills ROOM CODE if this join fails (ROOM FULL: try again once a seat frees).
    useRoom.getState().set({ status: 'joining', error: null, left: null, pendingCode: null, lastCode: code });
    this.armJoinTimeout();
    return this.send({ type: 'room:join', code, ...localIdentity(), token: friendsProfile().token, ...roomAuthFields({ force: true }) });
  }

  /** LEAVE. A host hands the room to `to` (the FRIENDS confirm names who); the relay falls back to the earliest present member. */
  leave(to?: string): void {
    this.rejoinCode = null;
    this.clearRestoreTimer();
    forgetSeat();
    if (roomState().status === 'in-room') this.send(to ? { type: 'room:leave', to } : { type: 'room:leave' });
    this.dropRoom('idle', 'left');
    useRoom.getState().set({ rejoining: null });
  }

  /** Host: change the room size (the relay refuses below the seats taken). */
  setSize(size: number): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s) || !s.seats) return false;
    return this.send({ type: 'room:size', size });
  }

  /** Host: remove a player (they cannot come back into this room). */
  remove(id: string): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s) || !s.seats || id === s.you) return false;
    return this.send({ type: 'room:remove', id });
  }

  /** Host: SIGNED-IN PLAYERS ONLY on / off (on needs our own verified badge; the relay checks). */
  setSignedInOnly(on: boolean): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s)) return false;
    return this.send({ type: 'room:settings', signedInOnly: on });
  }

  /** Host: hand the host role to a present player. */
  makeHost(id: string): boolean {
    const s = roomState();
    if (s.status !== 'in-room' || !isHost(s) || !s.seats || id === s.you) return false;
    return this.send({ type: 'room:host', id });
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
    this.authProbes = 0;
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
    this.authProbes = 0;
    // The next relay says again whether it verifies Google tokens.
    setRelaySignIn(null);
    const s = roomState();
    const code = s.status === 'in-room' ? s.code : s.rejoining;
    if (code) this.rejoinCode = code;
    this.dropRoom('offline', s.status === 'in-room' ? 'link' : s.left);
    // Rooms mode holds while we get back in (no AI rivals popping in during a blip).
    useRoom.getState().set({ rejoining: code });
  }

  private onMessage(message: ProtocolMessage): void {
    const store = useRoom.getState();
    switch (message.type) {
      case 'server:welcome':
        // true / false from a relay with sign-in support; absent (old relay) = no sign-in.
        setRelaySignIn(message.signIn === true);
        // Signed in before this socket's hello could carry it (e.g. the token arrived mid-connect).
        this.pushAuth();
        return;
      case 'server:announce':
        receiveAnnounce(message);
        return;
      case 'room:pong': {
        this.clock.addSample(message.t, performance.now(), message.serverNow);
        store.set({ clock: { offsetMs: this.clock.offsetMs, rttMs: this.clock.rttMs, samples: this.clock.count } });
        const now = roomState();
        if (now.status === 'in-room' && now.code && Date.now() - this.seatSavedAt >= SEAT_REFRESH_MS) {
          this.seatSavedAt = Date.now();
          rememberSeat(now.code);
        }
        return;
      }
      case 'room:joined': {
        this.clearJoinTimeout();
        this.clearRestoreTimer();
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
          // A restored seat keeps the race's lights-out we already saw (raceFlow keeps its own record).
          goAt: message.restored ? store.goAt : null,
          size: message.size ?? null,
          seats: message.size !== undefined,
          rejoining: null,
          restores: store.restores + (message.restored ? 1 : 0),
          signedInOnly: message.signedInOnly === true,
        });
        this.lastIdentityKey = identityKey(localIdentity());
        this.seatSavedAt = Date.now();
        rememberSeat(message.code);
        this.finishedSeen.clear();
        this.syncParticipants(message.players, message.you);
        this.applyFinishes(message.race);
        this.poses.start();
        // Signed in or out while the join was on its way: tell the room now.
        if (authChangePending()) this.pushAuth();
        return;
      }
      case 'room:players': {
        if (roomState().status !== 'in-room') return;
        store.set({ players: message.players, ...(message.size !== undefined ? { size: message.size } : {}), signedInOnly: message.signedInOnly === true });
        this.syncParticipants(message.players, roomState().you);
        return;
      }
      case 'room:pose': {
        if (roomState().status !== 'in-room' || !message.id) return;
        const r = pushPose({ ...message, id: message.id }, approxBytes(message));
        if (this.participants.has(message.id)) {
          setProgress(message.id, r.progressM);
          setReportedSpeed(message.id, message.s / 3.6);
        }
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
        // 'replaced': another tab or device took the seat; its own saved seat is left alone.
        forgetSeat(message.reason === 'replaced');
        this.dropRoom('idle', message.reason);
        store.set({ rejoining: null });
        // expired / closed (the owner's console) / removed / replaced: FRIENDS says why.
        const notice = roomLeftNotice(message.reason);
        if (notice) store.set({ error: notice });
        return;
      }
      case 'room:error': {
        // The answer to a sign-in change sent outside a room (pushAuth): expected, nothing to show. Frames are
        // answered in order, so it can arrive while a HOST / JOIN sent just after it is still on its way.
        if (message.code === 'not_in_room' && this.authProbes > 0) {
          this.authProbes -= 1;
          return;
        }
        // A frame that was on the wire when the room ended: keep the notice that says why (see isStaleRoomError).
        if (isStaleRoomError(message.code, roomState().status)) return;
        this.clearJoinTimeout();
        if (message.code === 'sign_in_required') noteSignInRequired();
        const text =
          message.code === 'removed'
            ? 'You were removed from the room'
            : message.code === 'not_found' && roomState().rejoining
              ? 'That room is gone'
              : message.code === 'sign_in_required'
                ? 'SIGNED-IN PLAYERS ONLY: sign in with Google (above), then try again'
                : message.message;
        const patch: Partial<ReturnType<typeof roomState>> = { error: { code: message.code, message: text, at: Date.now() } };
        if (roomState().status === 'joining') {
          patch.status = 'idle';
          // A failed re-join (room gone, full, removed) ends rooms mode.
          patch.rejoining = null;
          forgetSeat();
        }
        store.set(patch);
        return;
      }
      default:
        return;
    }
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private clearRestoreTimer(): void {
    if (this.restoreTimer) clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
  }

  /** Answer another tab of this game asking whether we hold a room's seat (see askTabsForSeat). */
  private answerSeatQueries(): () => void {
    const channel = openSeatChannel();
    if (!channel) return () => undefined;
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { ask?: unknown; nonce?: unknown } | null;
      if (!data || typeof data.ask !== 'string') return;
      const s = roomState();
      // A tab still asking (this one, mid-restore) does not count as holding the seat.
      const holding = (s.status === 'in-room' && s.code === data.ask) || (s.rejoining === data.ask && this.askingSeat !== data.ask);
      if (holding) channel.postMessage({ held: data.ask, nonce: data.nonce });
    };
    return () => channel.close();
  }


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

  private dropRoom(status: 'idle' | 'offline', left: RoomLeftReason | 'link' | null): void {
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
      this.send({ type: 'room:update', ...identity, ...roomAuthFields() });
    }, IDENTITY_THROTTLE_MS);
  }

  /**
   * Tell the relay about a sign-in or sign-out right away (no-op when this socket already knows, e.g. a
   * silent token refresh). A socket that is not open hears it on its next hello; a join on its way
   * carries it already (room:joined checks again).
   */
  private pushAuth(): void {
    // A relay without sign-in (or one that predates it) has nothing to record.
    if (!this.link.connected || useAuth.getState().relaySignIn !== true || !authChangePending()) return;
    const status = roomState().status;
    if (status !== 'in-room' && status !== 'idle') return;
    const identity = localIdentity();
    if (status === 'in-room') this.lastIdentityKey = identityKey(identity);
    else this.authProbes += 1;
    if (!this.send({ type: 'room:update', ...identity, ...roomAuthFields() }) && status !== 'in-room') this.authProbes -= 1;
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
        forgetSeat();
        useRoom.getState().set({ status: 'idle', rejoining: null, error: { code: 'timeout', message: 'The relay did not answer (is it this version?)', at: Date.now() } });
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
  host: (size?: number): boolean => active?.host(size) ?? false,
  join: (code: string): boolean => active?.join(code) ?? false,
  leave: (to?: string): void => active?.leave(to),
  setSize: (size: number): boolean => active?.setSize(size) ?? false,
  remove: (id: string): boolean => active?.remove(id) ?? false,
  makeHost: (id: string): boolean => active?.makeHost(id) ?? false,
  setSignedInOnly: (on: boolean): boolean => active?.setSignedInOnly(on) ?? false,
  ready: (on: boolean): boolean => active?.ready(on) ?? false,
  start: (): boolean => active?.start() ?? false,
  shareUrl: (): string | null => active?.shareUrl() ?? null,
};

// ── Tabs of this game on this device ─────────────────────────────────────────

const SEAT_CHANNEL = 'gamerfleet.room';
const SEAT_ASK_MS = 350;

function openSeatChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(SEAT_CHANNEL) : null;
  } catch {
    return null;
  }
}

/** Does another live tab of this game hold room `code`? Resolves false after a short wait (or without BroadcastChannel). */
export function askTabsForSeat(code: string, waitMs: number = SEAT_ASK_MS): Promise<boolean> {
  const channel = openSeatChannel();
  if (!channel) return Promise.resolve(false);
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const done = (held: boolean) => {
      clearTimeout(timer);
      channel.close();
      resolve(held);
    };
    const timer = setTimeout(() => done(false), waitMs);
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { held?: unknown; nonce?: unknown } | null;
      if (data && data.held === code && data.nonce === nonce) done(true);
    };
    channel.postMessage({ ask: code, nonce });
  });
}
