import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  CLIENT_ROLES,
  COUNTRY_NAMES,
  DEFAULT_SERVER_PORT,
  HEARTBEAT_INTERVAL_MS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  RELAY_RULES,
  ROOM_PHASES,
  countryFromTimeZone,
  encodeMessage,
  isClientMessage,
  isClientRole,
  parseMessage,
  type ClientMessage,
  type ClientRole,
  type ErrorMessage,
  type GameSessionInfo,
  type GameStateMessage,
  type GameTelemetryMessage,
  type OutgoingMessage,
  type PeerCounts,
  type PhysicsSetMessage,
  type PlayerAuthFields,
  type RoomPhase,
  type RoomPlayer,
  type RoomRace,
  type ServerSnapshot,
  type SquadControlsMessage,
} from '../../shared/protocol';
import { ADMIN_API_PREFIX, createAdminApi, type AdminActions, type AdminApi, type AdminOptions, type AdminRoomView, type AnnounceView } from './admin';
import type { GoogleTokenVerifier, VerifyResult } from './auth/google';
import { formatControls, formatPeers, formatPhysics, formatSession } from './format';
import { displayHost } from './network';
import { RoomManager, type LeaveResult, type MemberBadge, type Room, type RoomFail, type RoomManagerOptions, type RoomMember, type RoomStats, type SeatRelease } from './rooms';
import { LiveStats, topCounts } from './stats';
import { createThrottledLog } from './throttled-log';

export interface RelayLogger {
  info(line: string): void;
  warn(line: string): void;
}

export const silentLogger: RelayLogger = { info() {}, warn() {} };

export interface RateLimitOptions {
  /** Sustained frames per second per client. */
  perSecond: number;
  /** Bucket size: frames a client may send back-to-back before being limited. */
  burst: number;
}

export interface RelayServerOptions {
  /** TCP port; 0 picks a free one. Default DEFAULT_SERVER_PORT. */
  port?: number;
  /** Bind address. Default '0.0.0.0' so phones on the LAN can reach it. */
  host?: string;
  /** WebSocket ping interval. A client that has not answered the previous ping is terminated. */
  heartbeatMs?: number;
  logger?: RelayLogger;
  rateLimit?: RateLimitOptions;
  /** Consecutive invalid/forbidden frames before the socket is closed with 1008. */
  maxConsecutiveBadFrames?: number;
  /** Telemetry is skipped for a client whose send buffer exceeds this many bytes. */
  telemetryBackpressureBytes?: number;
  /** Rooms (room.v1): clock, limits and the pose rate limit. Tests inject a fake clock here. */
  rooms?: RoomManagerOptions;
  /** How often idle rooms are swept (ROOM_IDLE_EXPIRY_MS decides what is idle). Default 60 s. */
  roomSweepMs?: number;
  /** How often seats left away past ROOM_SEAT_GRACE_MS are freed. Default 2 s. */
  seatSweepMs?: number;
  /**
   * Milestone 6: verifies players' Google ID tokens (badges, SIGNED-IN PLAYERS ONLY rooms) and the admin's
   * Google factor. Null / absent = no sign-in (GOOGLE_CLIENT_ID unset).
   */
  google?: GoogleTokenVerifier | null;
  /** Milestone 6: the owner's admin API (/admin/api/). Without a key of ≥ 24 characters it stays disabled. */
  admin?: AdminOptions;
  /** Wall clock for live stats, announcements and admin sessions / rate limits (tests inject one). */
  now?: () => number;
  /** Shown in the console's stats (the deployed git commit when known). Default 'unknown'. */
  version?: string;
}

export interface RelayCounters {
  framesIn: number;
  framesRelayed: number;
  badFrames: number;
  forbiddenFrames: number;
  rateLimitedFrames: number;
  telemetrySkipped: number;
  heartbeatTerminations: number;
  /** room:pose frames fanned out (one per recipient). */
  posesRelayed: number;
}

export interface RelayClientInfo {
  id: string;
  role: ClientRole;
  name: string | null;
  remoteAddress: string;
  connectedAt: number;
}

export interface RelayStats {
  uptimeSec: number;
  peers: PeerCounts;
  clients: RelayClientInfo[];
  snapshot: ServerSnapshot;
  counters: RelayCounters;
  rooms: RoomStats;
}

export interface RelayServer {
  /** The admin API's state (mode, lockout, sessions) — for tests and the startup log. */
  readonly admin: AdminApi;
  /** Actual bound port (useful with port 0). */
  readonly port: number;
  readonly host: string;
  /** ws:// URL reachable from this machine. */
  readonly url: string;
  /** Closes every client with 1001, then the HTTP server. Idempotent. */
  close(): Promise<void>;
  stats(): RelayStats;
  /**
   * Frees seats away for longer than ROOM_SEAT_GRACE_MS, then deletes rooms idle for ROOM_IDLE_EXPIRY_MS
   * (per the rooms clock) and tells their members; returns the number of idle rooms deleted. Also runs
   * every `seatSweepMs` / `roomSweepMs`.
   */
  sweepRooms(): number;
  /** The rooms a client id is in (for tests and the info page). */
  roomOf(clientId: string): Room | undefined;
}

export const RELAY_DEFAULTS = {
  host: '0.0.0.0',
  rateLimit: { perSecond: 120, burst: 240 },
  maxConsecutiveBadFrames: 20,
  telemetryBackpressureBytes: 1024 * 1024,
} as const;

/** How long `close()` waits for clients to finish the closing handshake before terminating them. */
const CLOSE_GRACE_MS = 1000;
const RATE_LIMIT_ERROR_INTERVAL_MS = 1000;
const LOG_THROTTLE_MS = 1000;
const ROOM_SWEEP_MS = 60_000;
const SEAT_SWEEP_MS = 2_000;
/** room:players goes out for a ping update at most this often per room (membership changes always go out). */
const ROOM_PING_BROADCAST_MS = 4000;

interface Client {
  id: string;
  ws: WebSocket;
  role: ClientRole;
  name: string | null;
  remoteAddress: string;
  connectedAt: number;
  alive: boolean;
  tokens: number;
  lastRefill: number;
  lastRateLimitErrorAt: number;
  consecutiveBadFrames: number;
  /** Milestone 6: country from the device time zone (the zone itself is not kept). */
  country: string | null;
  /** Milestone 6: the latest idToken on this socket verified (only the given name is kept). */
  verified: boolean;
  givenName: string | null;
  /** Sent a milestone 6 field, so it understands 'sign_in_required'. */
  signinAware: boolean;
  /** Car / map from this game's latest game:state (live stats). */
  carId: string | null;
  trackId: string | null;
  /** Counted in the sessions-started stats (once per socket). */
  countedGame: boolean;
  /** An idToken is being verified: later frames wait in `queue` so their order is kept. */
  busy: boolean;
  queue: ClientMessage[];
}

/** Frames held back while a client's idToken verifies (more are dropped). */
const MAX_QUEUED_FRAMES = 64;
const NEW_ROOMS_PAUSED = 'New rooms are paused by the owner';
const SIGN_IN_REQUIRED_OLD_CLIENT = 'SIGNED-IN PLAYERS ONLY: this room needs Google sign-in. Reload the game to get the newest version, then sign in.';
const SIGN_IN_NOT_SET_UP = 'SIGNED-IN PLAYERS ONLY needs Google sign-in, which this relay has not set up';
const STATS_NOTE = 'Counts start when the relay starts (the free plan sleeps and restarts it). Players in offline mode are not counted.';
const STATS_LABELS = {
  'online.players': 'Players online now (games connected to the relay; offline mode is not counted)',
  'online.dashboards': 'Dashboards connected now',
  'online.observers': 'Other connections now',
  'online.signedIn': 'Signed-in players online now',
  'rooms.playersInRooms': 'Players in rooms now',
  'rooms.racesRunning': 'Races running now',
  'peak.today': 'Most players online at once today (UTC), since the relay started',
  'peak.sinceStart': 'Most players online at once since the relay started',
  'sessions.today': 'Game sessions started today (UTC), since the relay started',
  'sessions.sinceStart': 'Game sessions started since the relay started',
  'races.finishedToday': 'Room races finished today (UTC), since the relay started',
  countries: 'Countries of players online now (estimated from the device time zone)',
} as const;

type RelayedMessage = SquadControlsMessage | PhysicsSetMessage | GameStateMessage | GameTelemetryMessage;

export async function createRelayServer(options: RelayServerOptions = {}): Promise<RelayServer> {
  const host = options.host ?? RELAY_DEFAULTS.host;
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
  const logger = options.logger ?? silentLogger;
  const rateLimit = options.rateLimit ?? RELAY_DEFAULTS.rateLimit;
  const maxBadFrames = options.maxConsecutiveBadFrames ?? RELAY_DEFAULTS.maxConsecutiveBadFrames;
  const backpressureBytes = options.telemetryBackpressureBytes ?? RELAY_DEFAULTS.telemetryBackpressureBytes;
  const rooms = new RoomManager(options.rooms);
  const roomNow = options.rooms?.now ?? Date.now;
  const wallNow = options.now ?? Date.now;
  const google = options.google ?? null;
  const trustProxy = options.admin?.trustProxy === true;
  const version = options.version ?? 'unknown';
  const live = new LiveStats(wallNow);
  const settings = { newRoomsAllowed: true };
  let announce: AnnounceView | null = null;
  /** Clients per role, kept up to date on connect / hello / close (O(1) presence and stats). */
  const roleCounts: PeerCounts = { game: 0, dashboard: 0, observer: 0 };

  const startedAt = Date.now();
  const clients = new Map<WebSocket, Client>();
  const clientsById = new Map<string, Client>();
  const snapshot: ServerSnapshot = { controls: null, physics: null, telemetry: null };
  const counters: RelayCounters = {
    framesIn: 0,
    framesRelayed: 0,
    badFrames: 0,
    forbiddenFrames: 0,
    rateLimitedFrames: 0,
    telemetrySkipped: 0,
    heartbeatTerminations: 0,
    posesRelayed: 0,
  };
  let nextClientNumber = 1;
  let shuttingDown = false;
  let closePromise: Promise<void> | undefined;

  const info = (line: string): void => logger.info(line);
  const warn = (line: string): void => logger.warn(line);
  const controlsLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const physicsLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const stateLog = createThrottledLog(LOG_THROTTLE_MS, info);
  const badFrameLog = createThrottledLog(LOG_THROTTLE_MS, warn);

  // ── Helpers ──────────────────────────────────────────────────────────────

  const peerCounts = (): PeerCounts => ({ ...roleCounts });

  const describe = (c: Client): string => `${c.role} ${c.id}${c.name ? ` "${c.name}"` : ''}`;

  const sendFrame = (c: Client, frame: string): boolean => {
    if (c.ws.readyState !== WebSocket.OPEN) return false;
    c.ws.send(frame);
    return true;
  };

  const send = (c: Client, message: OutgoingMessage): boolean => sendFrame(c, encodeMessage(message));

  const sendError = (c: Client, code: ErrorMessage['code'], message: string): void => {
    send(c, { type: 'server:error', code, message });
  };

  const sendWelcome = (c: Client): void => {
    send(c, {
      type: 'server:welcome',
      clientId: c.id,
      role: c.role,
      protocolVersion: PROTOCOL_VERSION,
      snapshot: { ...snapshot },
      peers: peerCounts(),
      signIn: google !== null,
    });
    // A game that connects while the owner's banner is up sees it too.
    if (c.role === 'game' && announce && announce.until > wallNow()) send(c, announceMessage(announce));
  };

  const announceMessage = (a: AnnounceView): OutgoingMessage => ({ type: 'server:announce', id: a.id, text: a.text, until: a.until, serverNow: wallNow() });

  const broadcastAnnounce = (a: AnnounceView): number => {
    const frame = encodeMessage(announceMessage(a));
    let sent = 0;
    for (const c of clients.values()) if (c.role === 'game' && sendFrame(c, frame)) sent += 1;
    return sent;
  };

  /** A socket became a game client: sessions started (once per socket) and the online peak. */
  const markGame = (c: Client): void => {
    if (c.role !== 'game') return;
    if (!c.countedGame) {
      c.countedGame = true;
      live.gameSessionStarted();
    }
    live.concurrentGames(roleCounts.game);
  };

  const badgeOf = (c: Client): MemberBadge => ({ verified: c.verified, givenName: c.verified ? c.givenName : null, country: c.country });

  /** tz / idToken of a hello or room frame (the idToken itself was verified before this frame was dispatched). */
  const applyAuthFields = (c: Client, m: PlayerAuthFields): void => {
    if (m.tz !== undefined) {
      c.country = countryFromTimeZone(m.tz);
      c.signinAware = true;
    }
    if (m.idToken === undefined) return;
    c.signinAware = true;
    if (m.idToken === null || google === null) {
      c.verified = false;
      c.givenName = null;
    }
  };

  const applyVerification = (c: Client, result: VerifyResult): void => {
    c.verified = result.ok;
    c.givenName = result.ok ? result.claims.givenName : null;
  };

  /** The socket's badge changed: copy it to its seat and tell the room. */
  const syncBadge = (c: Client): void => {
    const result = rooms.setBadge(c.id, badgeOf(c));
    if (result.ok && result.changed) sendRoomPlayers(result.room);
  };

  const broadcastPresence = (): void => {
    if (shuttingDown) return;
    const frame = encodeMessage({ type: 'server:presence', peers: peerCounts() });
    for (const c of clients.values()) sendFrame(c, frame);
  };

  /** Token bucket; returns false when the frame must be dropped. */
  const takeToken = (c: Client): boolean => {
    const now = performance.now();
    c.tokens = Math.min(rateLimit.burst, c.tokens + ((now - c.lastRefill) / 1000) * rateLimit.perSecond);
    c.lastRefill = now;
    if (c.tokens >= 1) {
      c.tokens -= 1;
      return true;
    }
    return false;
  };

  const rejectFrame = (c: Client, code: 'bad_message' | 'forbidden', reason: string): void => {
    if (code === 'bad_message') counters.badFrames += 1;
    else counters.forbiddenFrames += 1;
    c.consecutiveBadFrames += 1;
    badFrameLog.push((n) => `! ${describe(c)}: ${code} (${reason})${n > 1 ? ` [${n} rejected frames in the last second]` : ''}`);
    if (c.consecutiveBadFrames >= maxBadFrames) {
      logger.warn(`! closing ${describe(c)}: ${c.consecutiveBadFrames} consecutive bad frames`);
      sendError(c, code, `${reason}; closing after ${c.consecutiveBadFrames} consecutive bad frames`);
      c.ws.close(1008, 'too many bad frames');
      return;
    }
    sendError(c, code, reason);
  };

  /** Re-encodes the sanitized message (never the raw bytes) with `from` stamped by the server. */
  const relay = (sender: Client, message: RelayedMessage): void => {
    const rule = RELAY_RULES[message.type];
    const frame = encodeMessage({ ...message, from: sender.id });
    const isTelemetry = message.type === 'game:telemetry';
    for (const target of clients.values()) {
      if (target === sender) continue;
      if (rule === 'non-game' && target.role === 'game') continue;
      if (isTelemetry && target.ws.bufferedAmount > backpressureBytes) {
        counters.telemetrySkipped += 1;
        continue;
      }
      if (sendFrame(target, frame)) counters.framesRelayed += 1;
    }
  };

  // ── Rooms ────────────────────────────────────────────────────────────────

  /** The sockets of a room's present seats. */
  const roomClients = (room: Room): Client[] => {
    const out: Client[] = [];
    for (const m of room.members.values()) {
      const member = m.clientId === null ? undefined : clientsById.get(m.clientId);
      if (member) out.push(member);
    }
    return out;
  };

  const playersFrame = (room: Room): string =>
    encodeMessage({ type: 'room:players', players: rooms.players(room), size: room.size, ...(room.signedInOnly ? { signedInOnly: true as const } : {}) });

  const sendRoomPlayers = (room: Room, except?: Client): void => {
    const frame = playersFrame(room);
    for (const member of roomClients(room)) if (member !== except) sendFrame(member, frame);
  };

  const sendRoomRace = (room: Room, fromId: string): void => {
    const race: RoomRace = room.race;
    const frame = encodeMessage({ type: 'room:race', ...race, results: race.results.map((r) => ({ ...r })), from: fromId });
    for (const member of roomClients(room)) sendFrame(member, frame);
  };

  const sendRoomJoined = (c: Client, room: Room, member: RoomMember, restored: boolean): void => {
    send(c, {
      type: 'room:joined',
      code: room.code,
      you: member.id,
      players: rooms.players(room),
      race: { ...room.race, results: room.race.results.map((r) => ({ ...r })) },
      serverNow: roomNow(),
      size: room.size,
      ...(restored ? { restored: true as const } : {}),
      ...(room.signedInOnly ? { signedInOnly: true as const } : {}),
    });
  };

  const roomError = (c: Client, result: RoomFail): void => {
    // A game from before sign-in does not know 'sign_in_required': it gets a code it knows and a message to show.
    if (result.code === 'sign_in_required' && !c.signinAware) {
      send(c, { type: 'room:error', code: 'bad_state', message: SIGN_IN_REQUIRED_OLD_CLIENT });
      return;
    }
    send(c, { type: 'room:error', code: result.code, message: result.message });
  };

  const memberIdOf = (c: Client): string => rooms.memberOfClient(c.id)?.id ?? c.id;

  /** Tell the rest of a room that a seat went (a leave, an expiry, a seat given up elsewhere). */
  const announceLeave = (left: LeaveResult | SeatRelease, why: string): void => {
    if (left.closed) {
      logger.info(`room ${left.room.code} closed (last player ${left.member.id} ${why})`);
      return;
    }
    if (rooms.rooms.get(left.room.code) !== left.room) {
      // Several seats went in one sweep and a later one closed the room: nobody is left to tell.
      logger.info(`room ${left.room.code}: ${left.member.id} ${why}`);
      return;
    }
    sendRoomPlayers(left.room);
    logger.info(`room ${left.room.code}: ${left.member.id} ${why} (${left.room.members.size} left)${left.newHostId ? `; ${left.newHostId} is host now` : ''}`);
  };

  /** An explicit room:leave. */
  const leaveRoom = (c: Client, to?: string): void => {
    const left = rooms.leave(c.id, to);
    if (!left) {
      roomError(c, { ok: false, code: 'not_in_room', message: 'not in a room' });
      return;
    }
    send(c, { type: 'room:left', reason: 'left' });
    announceLeave(left, 'left');
  };

  /** The socket closed: a tokened seat waits ROOM_SEAT_GRACE_MS for its device; an old client is gone at once. */
  const disconnectRoom = (c: Client): void => {
    const result = rooms.disconnect(c.id);
    if (!result) return;
    if (result.kind === 'left') {
      announceLeave(result, 'disconnected');
      return;
    }
    sendRoomPlayers(result.room);
    logger.info(`room ${result.room.code}: ${result.member.id} is away (socket ${c.id} closed); seat held`);
  };

  const sweepSeats = (): number => {
    const gone = rooms.expireSeats();
    for (const left of gone) announceLeave(left, 'did not come back (seat expired)');
    return gone.length;
  };

  const sweepRooms = (): number => {
    sweepSeats();
    const gone = rooms.sweep();
    for (const { code, clientIds } of gone) {
      logger.info(`room ${code} expired (idle)`);
      for (const id of clientIds) {
        const member = clientsById.get(id);
        if (member) send(member, { type: 'room:left', reason: 'expired' });
      }
    }
    return gone.length;
  };

  // ── Routing ──────────────────────────────────────────────────────────────

  /**
   * Frames are handled in order. A frame with an idToken waits for its verification (normally instant: the
   * keys are cached) and the frames behind it wait in the client's queue.
   */
  const dispatch = (c: Client, message: ClientMessage): void => {
    if (c.busy) {
      if (c.queue.length < MAX_QUEUED_FRAMES) c.queue.push(message);
      else counters.rateLimitedFrames += 1;
      return;
    }
    const token = 'idToken' in message ? message.idToken : undefined;
    if (typeof token === 'string' && google) {
      c.busy = true;
      google
        .verify(token)
        .catch((): VerifyResult => ({ ok: false, reason: 'keys_unavailable' }))
        .then((result) => {
          c.busy = false;
          if (!clientsById.has(c.id) || shuttingDown) return;
          try {
            applyVerification(c, result);
            dispatchNow(c, message);
          } finally {
            while (!c.busy && c.queue.length > 0) dispatch(c, c.queue.shift()!);
          }
        })
        .catch((err: unknown) => logger.warn(`! ${describe(c)}: ${(err as Error).message}`));
      return;
    }
    dispatchNow(c, message);
  };

  const dispatchNow = (c: Client, message: ClientMessage): void => {
    switch (message.type) {
      case 'hello': {
        const previous = c.role;
        if (previous !== message.role) {
          roleCounts[previous] -= 1;
          roleCounts[message.role] += 1;
        }
        c.role = message.role;
        if (message.name !== undefined) c.name = message.name;
        applyAuthFields(c, message);
        markGame(c);
        sendWelcome(c);
        broadcastPresence();
        syncBadge(c);
        logger.info(
          `~ ${c.id} hello: ${previous === c.role ? `role ${c.role}` : `${previous} → ${c.role}`}` +
            `${c.name ? ` "${c.name}"` : ''} (${formatPeers(peerCounts())})`,
        );
        return;
      }
      case 'squad:controls': {
        snapshot.controls = message.controls;
        relay(c, message);
        controlsLog.push(
          (n) => `controls ← ${c.id}: ${formatControls(message.controls)}${n > 1 ? `  [${n} updates/s]` : ''}`,
        );
        return;
      }
      case 'physics:set': {
        relay(c, message);
        physicsLog.push((n) => `physics:set ← ${c.id}: ${formatPhysics(message.params)}${n > 1 ? `  [${n}/s]` : ''}`);
        return;
      }
      case 'game:state': {
        snapshot.physics = message.physics;
        const { carId, trackId, bigJumpKmh, driverName, rideName } = message;
        if (carId !== undefined) c.carId = carId;
        if (trackId !== undefined) c.trackId = trackId;
        if (carId !== undefined || trackId !== undefined || bigJumpKmh !== undefined || driverName !== undefined || rideName !== undefined) {
          const session: GameSessionInfo = {};
          if (carId !== undefined) session.carId = carId;
          if (trackId !== undefined) session.trackId = trackId;
          if (bigJumpKmh !== undefined) session.bigJumpKmh = bigJumpKmh;
          // Driver / MY RIDE names (optional): a late dashboard's welcome shows who is at the wheel too.
          if (driverName !== undefined) session.driverName = driverName;
          if (rideName !== undefined) session.rideName = rideName;
          snapshot.session = session;
        }
        relay(c, message);
        const session = formatSession(message);
        stateLog.push(
          (n) => `game:state ← ${c.id}: ${session ? `${session} · ` : ''}${formatPhysics(message.physics)}${n > 1 ? `  [${n}/s]` : ''}`,
        );
        return;
      }
      case 'game:telemetry': {
        snapshot.telemetry = message.telemetry;
        relay(c, message);
        return;
      }
      case 'ping': {
        send(c, { type: 'pong', nonce: message.nonce, serverTime: Date.now() });
        return;
      }
      case 'room:create': {
        const { name, carId, look, plate, avatar } = message;
        applyAuthFields(c, message);
        if (message.signedInOnly !== undefined) c.signinAware = true;
        if (!settings.newRoomsAllowed) {
          // 'rooms_full' is a code every game knows; the message says why.
          roomError(c, { ok: false, code: 'rooms_full', message: NEW_ROOMS_PAUSED });
          return;
        }
        if (message.signedInOnly && !google) {
          roomError(c, { ok: false, code: 'bad_state', message: SIGN_IN_NOT_SET_UP });
          return;
        }
        const result = rooms.create(
          c.id,
          { name, carId, look, plate, avatar },
          { token: message.token ?? null, size: message.size ?? null, badge: badgeOf(c), signedInOnly: message.signedInOnly === true },
        );
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        for (const released of result.released) announceLeave(released, 'opened another room');
        sendRoomJoined(c, result.room, result.member, false);
        logger.info(
          `room ${result.room.code} created by ${c.id} "${result.member.identity.name}" (size ${result.room.size}${result.member.token ? '' : ', untokened'}` +
            `${result.room.signedInOnly ? ', signed-in players only' : ''}; ${rooms.rooms.size} rooms)`,
        );
        return;
      }
      case 'room:join': {
        const { code, name, carId, look, plate, avatar } = message;
        applyAuthFields(c, message);
        const result = rooms.join(c.id, code, { name, carId, look, plate, avatar }, message.token ?? null, badgeOf(c));
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        for (const released of result.released) announceLeave(released, 'joined another room');
        if (result.replacedClientId !== null && result.replacedClientId !== c.id) {
          // The same device on a newer socket: the old one is out of the room (no duplicate seat).
          const old = clientsById.get(result.replacedClientId);
          if (old) send(old, { type: 'room:left', reason: 'replaced' });
        }
        sendRoomJoined(c, result.room, result.member, result.restored);
        // The newcomer already has the list in room:joined; the others learn about it here.
        sendRoomPlayers(result.room, c);
        logger.info(
          `room ${code}: ${c.id} "${result.member.identity.name}" ${result.restored ? `took back seat ${result.member.id}${result.replacedClientId ? ` (replacing ${result.replacedClientId})` : ''}` : 'joined'} (${result.room.members.size}/${result.room.size} players)`,
        );
        return;
      }
      case 'room:size': {
        const result = rooms.setSize(c.id, message.size);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (result.changed) sendRoomPlayers(result.room);
        logger.info(`room ${result.room.code}: size ${result.room.size}`);
        return;
      }
      case 'room:remove': {
        const result = rooms.removeMember(c.id, message.id);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        const gone = result.targetClientId === null ? undefined : clientsById.get(result.targetClientId);
        if (gone) send(gone, { type: 'room:left', reason: result.target.token ? 'removed' : 'closed' });
        sendRoomPlayers(result.room);
        logger.info(`room ${result.room.code}: host removed ${result.target.id} "${result.target.identity.name}"`);
        return;
      }
      case 'room:host': {
        const result = rooms.setHost(c.id, message.id);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (result.changed) sendRoomPlayers(result.room);
        logger.info(`room ${result.room.code}: ${message.id} is host now (handed over)`);
        return;
      }
      case 'room:update': {
        const { name, carId, look, plate, avatar } = message;
        applyAuthFields(c, message);
        const result = rooms.update(c.id, { name, carId, look, plate, avatar });
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        const badge = rooms.setBadge(c.id, badgeOf(c));
        if (!result.changed && badge.ok && badge.changed) sendRoomPlayers(result.room);
        if (result.changed) {
          sendRoomPlayers(result.room);
          // A rename also renames this player's results row: send the race too, so the live table and the
          // results line follow the new name at once.
          const id = memberIdOf(c);
          if (result.room.race.results.some((r) => r.id === id)) sendRoomRace(result.room, id);
        }
        return;
      }
      case 'room:leave':
        leaveRoom(c, message.to);
        return;
      case 'room:settings': {
        c.signinAware = true;
        if (message.signedInOnly && !google) {
          roomError(c, { ok: false, code: 'bad_state', message: SIGN_IN_NOT_SET_UP });
          return;
        }
        const result = rooms.setSignedInOnly(c.id, message.signedInOnly);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (result.changed) sendRoomPlayers(result.room);
        logger.info(`room ${result.room.code}: signed-in players only ${result.room.signedInOnly ? 'on' : 'off'}`);
        return;
      }
      case 'room:ready': {
        const result = rooms.setReady(c.id, message.ready);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (result.changed) sendRoomPlayers(result.room);
        return;
      }
      case 'room:pose': {
        const verdict = rooms.pose(c.id);
        if (verdict === 'not_in_room') {
          roomError(c, { ok: false, code: 'not_in_room', message: 'not in a room' });
          return;
        }
        if (verdict === 'dropped') return;
        const room = rooms.roomOf(c.id)!;
        const id = memberIdOf(c);
        const { t, p, q, s, st, g, pm } = message;
        const frame = encodeMessage({ type: 'room:pose', id, t, p, q, s, st, g, pm, from: id });
        for (const member of roomClients(room)) {
          if (member === c) continue;
          if (member.ws.bufferedAmount > backpressureBytes) continue;
          if (sendFrame(member, frame)) counters.posesRelayed += 1;
        }
        return;
      }
      case 'room:race': {
        const before = rooms.roomOf(c.id)?.race.phase;
        const result = rooms.setRace(c.id, { phase: message.phase, track: message.track, startAt: message.startAt });
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (message.phase === 'results' && before !== 'results' && before !== 'lobby') live.raceFinished();
        sendRoomRace(result.room, memberIdOf(c));
        if (message.phase === 'countdown' || message.phase === 'results' || message.phase === 'lobby') sendRoomPlayers(result.room);
        logger.info(`room ${result.room.code}: race ${message.phase}${result.room.race.track ? ` on ${result.room.race.track}` : ''}${message.startAt !== null ? ` startAt ${message.startAt}` : ''}`);
        return;
      }
      case 'room:finish': {
        const result = rooms.finish(c.id, message.finishMs, message.falls);
        if (!result.ok) {
          roomError(c, result);
          return;
        }
        if (result.changed) {
          sendRoomRace(result.room, memberIdOf(c));
          logger.info(`room ${result.room.code}: ${memberIdOf(c)} finished in ${message.finishMs} ms`);
        }
        return;
      }
      case 'room:ping': {
        const room = rooms.ping(c.id, message.rtt);
        send(c, { type: 'room:pong', t: message.t, serverNow: roomNow() });
        if (room && message.rtt !== undefined && roomNow() - room.lastPingBroadcastAt >= ROOM_PING_BROADCAST_MS) {
          room.lastPingBroadcastAt = roomNow();
          sendRoomPlayers(room);
        }
        return;
      }
    }
  };

  const onFrame = (c: Client, data: RawData, isBinary: boolean): void => {
    counters.framesIn += 1;
    if (!takeToken(c)) {
      counters.rateLimitedFrames += 1;
      const now = performance.now();
      if (now - c.lastRateLimitErrorAt >= RATE_LIMIT_ERROR_INTERVAL_MS) {
        c.lastRateLimitErrorAt = now;
        sendError(c, 'rate_limited', `over ${rateLimit.perSecond} frames/s; frames are being dropped`);
        logger.warn(`! ${describe(c)} is rate limited`);
      }
      return;
    }
    if (isBinary) {
      rejectFrame(c, 'bad_message', 'binary frames are not supported; send JSON text');
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(rawToString(data));
    } catch {
      rejectFrame(c, 'bad_message', 'invalid JSON');
      return;
    }
    const type = isRecordWithType(json) ? json.type : undefined;
    if (type !== undefined && (type.startsWith('server:') || type === 'pong')) {
      rejectFrame(c, 'forbidden', `clients may not send '${type}'`);
      return;
    }
    const message = parseMessage(json);
    if (!message || !isClientMessage(message)) {
      rejectFrame(c, 'bad_message', type === undefined ? 'expected an object with a string "type"' : `invalid or unknown '${type.slice(0, 40)}' message`);
      return;
    }
    c.consecutiveBadFrames = 0;
    dispatch(c, message);
  };

  // ── Connections ──────────────────────────────────────────────────────────

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const queryRole = parseRequestUrl(req.url)?.searchParams.get('role') ?? null;
    const now = performance.now();
    const c: Client = {
      id: `c${nextClientNumber++}`,
      ws,
      role: isClientRole(queryRole) ? queryRole : 'observer',
      name: null,
      remoteAddress: (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, ''),
      connectedAt: Date.now(),
      alive: true,
      tokens: rateLimit.burst,
      lastRefill: now,
      lastRateLimitErrorAt: -Infinity,
      consecutiveBadFrames: 0,
      country: null,
      verified: false,
      givenName: null,
      signinAware: false,
      carId: null,
      trackId: null,
      countedGame: false,
      busy: false,
      queue: [],
    };
    clients.set(ws, c);
    clientsById.set(c.id, c);
    roleCounts[c.role] += 1;
    markGame(c);

    ws.on('pong', () => {
      c.alive = true;
    });
    ws.on('message', (data, isBinary) => onFrame(c, data, isBinary));
    ws.on('error', (err) => {
      // ws emits this for protocol violations (oversized frame → 1009, bad UTF-8 → 1007) and then closes.
      logger.warn(`! ${describe(c)} socket error: ${err.message}`);
    });
    ws.on('close', (code, reason) => {
      clients.delete(ws);
      clientsById.delete(c.id);
      roleCounts[c.role] -= 1;
      c.queue = [];
      if (!shuttingDown) disconnectRoom(c);
      broadcastPresence();
      const why = reason.length > 0 ? ` ${reason.toString('utf8')}` : '';
      logger.info(`- ${describe(c)} disconnected (${code}${why}) (${formatPeers(peerCounts())})`);
    });

    sendWelcome(c);
    broadcastPresence();
    // Behind the hosting proxy the socket address is the proxy's: not worth logging (and visitors' are never logged).
    logger.info(`+ ${describe(c)} connected${trustProxy ? '' : ` from ${c.remoteAddress}`} (${formatPeers(peerCounts())})`);
  });

  const heartbeat = setInterval(() => {
    for (const c of clients.values()) {
      if (!c.alive) {
        counters.heartbeatTerminations += 1;
        logger.warn(`! ${describe(c)} missed a heartbeat; terminating`);
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();
  const roomSweeper = setInterval(sweepRooms, options.roomSweepMs ?? ROOM_SWEEP_MS);
  roomSweeper.unref();
  const seatSweeper = setInterval(sweepSeats, options.seatSweepMs ?? SEAT_SWEEP_MS);
  seatSweeper.unref();

  // ── Owner's console (admin API) ──────────────────────────────────────────

  /** Live numbers for the console: counted from the clients connected now (bounded), plus LiveStats. */
  const adminStats = (): Record<string, unknown> => {
    const maps = new Map<string, number>();
    const cars = new Map<string, number>();
    const countries = new Map<string, number>();
    let countriesUnknown = 0;
    let signedIn = 0;
    for (const c of clients.values()) {
      if (c.role !== 'game') continue;
      const room = rooms.roomOf(c.id);
      const member = rooms.memberOfClient(c.id);
      const car = member?.identity.carId ?? c.carId;
      const map = room?.race.track ?? c.trackId;
      if (car) cars.set(car, (cars.get(car) ?? 0) + 1);
      if (map) maps.set(map, (maps.get(map) ?? 0) + 1);
      if (c.country) countries.set(c.country, (countries.get(c.country) ?? 0) + 1);
      else countriesUnknown += 1;
      if (c.verified) signedIn += 1;
    }
    const byPhase = Object.fromEntries(ROOM_PHASES.map((phase) => [phase, 0])) as Record<RoomPhase, number>;
    let playersInRooms = 0;
    let away = 0;
    let signedInOnlyRooms = 0;
    for (const room of rooms.rooms.values()) {
      byPhase[room.race.phase] += 1;
      if (room.signedInOnly) signedInOnlyRooms += 1;
      for (const m of room.members.values()) {
        if (m.clientId === null) away += 1;
        else playersInRooms += 1;
      }
    }
    const t = wallNow();
    const counters = live.counters(roleCounts.game);
    const topMaps = topCounts(maps, 24);
    const topCars = topCounts(cars, 24);
    const topCountries = topCounts(countries, 48);
    const memory = process.memoryUsage();
    return {
      now: t,
      startedAt: live.startedAt,
      uptimeSec: Math.round((t - live.startedAt) / 1000),
      version,
      memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
      note: STATS_NOTE,
      labels: STATS_LABELS,
      online: { players: roleCounts.game, dashboards: roleCounts.dashboard, observers: roleCounts.observer, signedIn },
      rooms: {
        total: rooms.rooms.size,
        playersInRooms,
        away,
        byPhase,
        racesRunning: byPhase.countdown + byPhase.racing,
        signedInOnly: signedInOnlyRooms,
      },
      maps: topMaps.entries,
      mapsOther: topMaps.other,
      cars: topCars.entries,
      carsOther: topCars.other,
      countries: topCountries.entries.map(({ id, players }) => ({ code: id, name: COUNTRY_NAMES[id] ?? id, players })),
      countriesOther: topCountries.other,
      countriesUnknown,
      peak: { today: counters.peakToday, todayAt: counters.peakTodayAt, sinceStart: counters.peakSinceStart, sinceStartAt: counters.peakSinceStartAt, day: counters.day },
      sessions: { today: counters.sessionsToday, sinceStart: counters.sessionsSinceStart },
      races: { finishedToday: counters.racesFinishedToday, finishedSinceStart: counters.racesFinishedSinceStart },
      settings: { ...settings },
      announce: announce && announce.until > t ? { ...announce } : null,
      signIn: google !== null,
    };
  };

  const adminRooms = (): AdminRoomView[] => {
    const t = roomNow();
    return [...rooms.rooms.values()].map((room) => ({
      code: room.code,
      size: room.size,
      players: room.members.size,
      phase: room.race.phase,
      map: room.race.track,
      ageSec: Math.max(0, Math.round((t - room.createdAt) / 1000)),
      signedInOnly: room.signedInOnly,
      members: [...room.members.values()].map((m) => ({
        id: m.id,
        name: m.identity.name,
        verified: m.verified,
        givenName: m.verified ? m.givenName : null,
        country: m.country,
        car: m.identity.carId,
        host: m.id === room.hostId,
        away: m.clientId === null,
      })),
    }));
  };

  const adminActions: AdminActions = {
    stats: adminStats,
    rooms: adminRooms,
    closeRoom(code) {
      const closed = rooms.closeRoom(code);
      if (!closed) return null;
      for (const id of closed.clientIds) {
        const member = clientsById.get(id);
        if (member) send(member, { type: 'room:left', reason: 'closed' });
      }
      logger.info(`room ${code} closed by the owner (${closed.clientIds.length} present)`);
      return { members: closed.clientIds.length };
    },
    removeMember(code, memberId) {
      const result = rooms.adminRemove(code, memberId);
      if (!result.ok) return result.code === 'not_found' ? 'no_room' : 'no_member';
      // Same as the host's REMOVE: 'removed' for a seat-aware (tokened) game, 'closed' for an old one.
      const gone = result.targetClientId === null ? undefined : clientsById.get(result.targetClientId);
      if (gone) send(gone, { type: 'room:left', reason: result.target.token ? 'removed' : 'closed' });
      if (!result.closed) sendRoomPlayers(result.room);
      logger.info(`room ${code}: the owner removed ${result.target.id} "${result.target.identity.name}"${result.closed ? ' (room closed)' : result.newHostId ? `; ${result.newHostId} is host now` : ''}`);
      return { name: result.target.identity.name, closed: result.closed };
    },
    announce(text, minutes) {
      announce = { id: randomBytes(9).toString('base64url'), text, until: wallNow() + minutes * 60_000 };
      const sent = broadcastAnnounce(announce);
      logger.info(`owner announcement for ${minutes} min sent to ${sent} game${sent === 1 ? '' : 's'}`);
      return { ...announce };
    },
    clearAnnounce() {
      const current = announce;
      announce = null;
      if (!current || current.until <= wallNow()) return null;
      const cleared = { id: current.id, text: '', until: wallNow() };
      broadcastAnnounce(cleared);
      return cleared;
    },
    settings: () => ({ ...settings }),
    setSettings(next) {
      settings.newRoomsAllowed = next.newRoomsAllowed;
    },
  };

  const admin = createAdminApi({ options: options.admin, google, actions: adminActions, now: wallNow, log: (line) => logger.info(line) });

  // ── HTTP ─────────────────────────────────────────────────────────────────

  const health = () => ({
    ok: true,
    protocolVersion: PROTOCOL_VERSION,
    peers: peerCounts(),
    snapshot,
    rooms: rooms.stats(),
    memory: (({ rss, heapUsed, heapTotal }) => ({ rss, heapUsed, heapTotal }))(process.memoryUsage()),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
  });

  const handleHttp = (req: IncomingMessage, res: ServerResponse): void => {
    const url = parseRequestUrl(req.url);
    if (!url) {
      // A malformed absolute-form target (`GET http://[ HTTP/1.1`) used to throw here and stop the process.
      writeJson(res, 400, { ok: false, error: 'bad request' });
      return;
    }
    const { pathname } = url;
    if (pathname === ADMIN_API_PREFIX.slice(0, -1) || pathname.startsWith(ADMIN_API_PREFIX)) {
      admin.handle(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      writeJson(res, 405, { ok: false, error: 'method not allowed' }, { Allow: 'GET, HEAD' });
      return;
    }
    if (pathname === '/health') {
      writeJson(res, 200, health());
      return;
    }
    if (pathname === '/') {
      writeInfoPage(res, req.headers.host, peerCounts());
      return;
    }
    writeJson(res, 404, { ok: false, error: 'not found' });
  };

  const httpServer = createServer(handleHttp);
  httpServer.on('upgrade', (req, socket, head) => {
    if (!parseRequestUrl(req.url)) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  httpServer.on('clientError', (_err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    else socket.destroy();
  });

  try {
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(options.port ?? DEFAULT_SERVER_PORT, host, () => {
        httpServer.off('error', reject);
        resolve();
      });
    });
  } catch (err) {
    clearInterval(heartbeat);
    clearInterval(roomSweeper);
    clearInterval(seatSweeper);
    wss.close();
    throw err;
  }
  httpServer.on('error', (err) => logger.warn(`! http server error: ${err.message}`));

  const port = (httpServer.address() as AddressInfo).port;

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      shuttingDown = true;
      clearInterval(heartbeat);
      clearInterval(roomSweeper);
      clearInterval(seatSweeper);
      for (const log of [controlsLog, physicsLog, stateLog, badFrameLog]) log.cancel();

      const open = [...clients.values()];
      const closed = Promise.all(
        open.map(
          (c) =>
            new Promise<void>((resolve) => {
              if (c.ws.readyState === WebSocket.CLOSED) resolve();
              else c.ws.once('close', () => resolve());
            }),
        ),
      );
      for (const c of open) c.ws.close(1001, 'server shutting down');
      const force = setTimeout(() => {
        for (const c of open) c.ws.terminate();
      }, CLOSE_GRACE_MS);
      await closed;
      clearTimeout(force);

      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections();
      });
    })();
    return closePromise;
  };

  return {
    admin,
    port,
    host,
    url: `ws://${displayHost(host)}:${port}`,
    close,
    stats: () => ({
      uptimeSec: (Date.now() - startedAt) / 1000,
      peers: peerCounts(),
      clients: [...clients.values()].map((c) => ({
        id: c.id,
        role: c.role,
        name: c.name,
        remoteAddress: c.remoteAddress,
        connectedAt: c.connectedAt,
      })),
      snapshot: { ...snapshot },
      counters: { ...counters },
      rooms: rooms.stats(),
    }),
    sweepRooms,
    roomOf: (clientId) => rooms.roomOf(clientId),
  };
}

// ── Module-level helpers ────────────────────────────────────────────────────

/** The request target as a URL, or null when it cannot be parsed (never throws). */
export function parseRequestUrl(target: string | undefined): URL | null {
  try {
    return new URL(target ?? '/', 'http://relay.invalid');
  } catch {
    return null;
  }
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

function isRecordWithType(value: unknown): value is { type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // The web game and Expo web may poll /health from another origin.
    'Access-Control-Allow-Origin': '*',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function writeInfoPage(res: ServerResponse, hostHeader: string | undefined, peers: PeerCounts): void {
  const wsUrl = escapeHtml(`ws://${hostHeader ?? `localhost:${DEFAULT_SERVER_PORT}`}`);
  const peerList = CLIENT_ROLES.map((role) => `${role}: ${peers[role]}`).join(' · ');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SquadHQ Relay</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}code{background:#8882;padding:.1em .3em;border-radius:4px}</style>
</head><body>
<h1>SquadHQ relay</h1>
<p>Protocol v${PROTOCOL_VERSION} WebSocket relay between the SquadHQ dashboard and the racer.</p>
<p>Connect to <code>${wsUrl}</code>, adding <code>?role=game</code> or <code>?role=dashboard</code>.</p>
<p>Connected now: ${escapeHtml(peerList)}</p>
<p>Machine-readable status: <a href="/health"><code>/health</code></a></p>
</body></html>
`);
}
