/**
 * Rooms (room.v1 + seats): membership, seats held through a dropped socket, the host role, room size,
 * removal, race state and the per-sender pose rate limit — pure bookkeeping with an injectable clock,
 * so the relay tests drive expiry without real timers. The relay (relay.ts) owns the sockets: it
 * calls into this manager and sends what it is told to.
 *
 * Rules (shared/protocol.ts "Rooms" and "Seats"):
 *   - a socket is in at most one room; a member is a seat: a stable member id (the socket id it first
 *     joined with), the socket it currently uses (null while away) and, for a seat-aware client, the
 *     device's player token;
 *   - the creator is host; the host role belongs to the creator's seat and moves only when the host
 *     leaves (to `to` or the earliest present member), hands it over (room:host) or the host's seat
 *     expires — never because someone joined or the host's socket blinked;
 *   - a tokened member whose socket closes keeps the seat for `seatGraceMs` (ROOM_SEAT_GRACE_MS),
 *     shown `away`; a join with the same token takes it back (same id, host role, results row); a
 *     second socket with the same token replaces the first — never two members for one token;
 *   - an untokened member (a client that predates seats) is removed the moment its socket closes;
 *   - a room has `size` seats (2…ROOM_MAX_PLAYERS; ROOM_MAX_PLAYERS when created without one); away
 *     seats count; the host can change the size (never below the seats taken) and remove a player,
 *     who cannot come back by token or by socket for the room's life;
 *   - names are de-duplicated inside a room ("Anaye", "Anaye 2");
 *   - at most ROOM_MAX_ROOMS rooms; a room nobody has talked in for `idleMs` is deleted by `sweep()`;
 *     a room with no members left is deleted at once;
 *   - results are owned here: 'countdown' resets them to the present members, `finish` fills a row,
 *     rows of members who leave stay; 'results' clears every READY so the next race needs it again;
 *   - poses above `poseMaxHz` per sender are dropped (token bucket, small burst).
 */
import {
  ROOM_IDLE_EXPIRY_MS,
  ROOM_MAX_NAME,
  ROOM_MAX_PLAYERS,
  ROOM_MAX_ROOMS,
  ROOM_POSE_MAX_HZ,
  ROOM_SEAT_GRACE_MS,
  makeRoomCode,
  type RoomErrorCode,
  type RoomIdentity,
  type RoomPlayer,
  type RoomRace,
  type RoomResult,
} from '../../shared/protocol';

export interface RoomMember {
  /** Stable member id: the socket id it first joined with (also `you`, the pose id and the results row id). */
  id: string;
  /** The socket this seat uses now; null while the seat is away (grace). */
  clientId: string | null;
  /** The device's player token (seat-aware clients); null for an old client. */
  token: string | null;
  /** The name the player asked for (before de-duplication). */
  baseName: string;
  identity: RoomIdentity;
  ready: boolean;
  /** Join order (1 = creator): a new host is the lowest present seq. */
  seq: number;
  ping: number | null;
  poseTokens: number;
  poseRefillAt: number;
  /** Clock ms when the socket dropped (null while connected). */
  awaySince: number | null;
}

export interface Room {
  code: string;
  createdAt: number;
  /** Last frame from any member (clock ms); `sweep` deletes rooms idle for `idleMs`. */
  lastActivity: number;
  /** Member id of the host. */
  hostId: string;
  /** Insertion order is join order. Keyed by member id. */
  members: Map<string, RoomMember>;
  race: RoomRace;
  /** Seats in the room (away seats count). */
  size: number;
  /** Tokens and socket ids of removed players (bounded). */
  banned: Set<string>;
  /** When `room:players` last went out because of a ping update (throttled by the relay). */
  lastPingBroadcastAt: number;
  counters: { posesIn: number; posesDropped: number };
}

export type RoomResult2<T = Room> = { ok: true; room: T; changed: boolean } | { ok: false; code: RoomErrorCode; message: string };
export type RoomFail = { ok: false; code: RoomErrorCode; message: string };

/** A seat that a create / join gave up elsewhere (the same token was in another room). */
export interface SeatRelease {
  room: Room;
  member: RoomMember;
  closed: boolean;
  newHostId: string | null;
}

export interface JoinOk {
  ok: true;
  room: Room;
  member: RoomMember;
  /** The join took back this token's seat (same member id). */
  restored: boolean;
  /** The socket that held the seat until now (a second socket with the same token), if any. */
  replacedClientId: string | null;
  /** Seats given up in other rooms by this token. */
  released: SeatRelease[];
}

export interface LeaveResult {
  room: Room;
  member: RoomMember;
  closed: boolean;
  /** Set when the host role moved. */
  newHostId: string | null;
}

export type DisconnectResult = ({ kind: 'away' } & { room: Room; member: RoomMember }) | ({ kind: 'left' } & LeaveResult);

export interface RoomManagerOptions {
  /** Clock in ms (Date.now by default). */
  now?: () => number;
  /** Random source for codes ([0, 1)). */
  random?: () => number;
  maxRooms?: number;
  maxPlayers?: number;
  idleMs?: number;
  /** How long a tokened member's seat survives a dropped socket. */
  seatGraceMs?: number;
  /** Poses per second per sender above which frames are dropped. */
  poseMaxHz?: number;
  /** Back-to-back poses allowed before the limit bites. */
  poseBurst?: number;
}

export interface RoomStats {
  rooms: number;
  players: number;
  /** Seats currently away (in grace). */
  away: number;
  posesIn: number;
  posesDropped: number;
  expired: number;
  /** Seats that expired after the grace period. */
  seatsExpired: number;
  /** Seats taken back by a reconnecting device. */
  seatsRestored: number;
}

export const ROOM_DEFAULTS = {
  maxRooms: ROOM_MAX_ROOMS,
  maxPlayers: ROOM_MAX_PLAYERS,
  idleMs: ROOM_IDLE_EXPIRY_MS,
  seatGraceMs: ROOM_SEAT_GRACE_MS,
  poseMaxHz: ROOM_POSE_MAX_HZ,
  poseBurst: 6,
} as const;

/** Removed players remembered per room (memory bound). */
const MAX_BANNED = 32;

const fail = (code: RoomErrorCode, message: string): RoomFail => ({ ok: false, code, message });

const nameKey = (name: string): string => name.toLocaleLowerCase();


export class RoomManager {
  readonly rooms = new Map<string, Room>();
  /** Socket id → its room (present seats only). */
  private readonly byClient = new Map<string, Room>();
  /** Token → its room (present or away seats). */
  private readonly byToken = new Map<string, Room>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxRooms: number;
  private readonly maxPlayers: number;
  private readonly idleMs: number;
  private readonly seatGraceMs: number;
  private readonly poseMaxHz: number;
  private readonly poseBurst: number;
  private seq = 0;
  private expiredTotal = 0;
  private seatsExpiredTotal = 0;
  private seatsRestoredTotal = 0;
  private posesInTotal = 0;
  private posesDroppedTotal = 0;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maxRooms = options.maxRooms ?? ROOM_DEFAULTS.maxRooms;
    this.maxPlayers = options.maxPlayers ?? ROOM_DEFAULTS.maxPlayers;
    this.idleMs = options.idleMs ?? ROOM_DEFAULTS.idleMs;
    this.seatGraceMs = options.seatGraceMs ?? ROOM_DEFAULTS.seatGraceMs;
    this.poseMaxHz = options.poseMaxHz ?? ROOM_DEFAULTS.poseMaxHz;
    this.poseBurst = options.poseBurst ?? ROOM_DEFAULTS.poseBurst;
  }

  /** The room a socket is seated in (present seats only). */
  roomOf(clientId: string): Room | undefined {
    return this.byClient.get(clientId);
  }

  /** The member a socket is seated as. */
  memberOfClient(clientId: string): RoomMember | null {
    return this.memberOf(clientId)?.member ?? null;
  }

  /** Members as the wire shows them (host flag, ready, ping, away). */
  players(room: Room): RoomPlayer[] {
    return [...room.members.values()].map((m) => {
      const player: RoomPlayer = { id: m.id, ...m.identity, ready: m.ready, isHost: m.id === room.hostId, ping: m.ping };
      if (m.clientId === null) player.away = true;
      return player;
    });
  }

  create(clientId: string, identity: RoomIdentity, opts: { token?: string | null; size?: number | null } = {}): RoomFail | JoinOk {
    if (this.byClient.has(clientId)) return fail('already_in_room', 'leave the current room first');
    this.sweep();
    if (this.rooms.size >= this.maxRooms) return fail('rooms_full', `the relay already hosts ${this.maxRooms} rooms; try again later`);
    const code = this.freshCode();
    if (!code) return fail('rooms_full', 'no free room code');
    const token = opts.token ?? null;
    // A device opening a new room gives up its seat anywhere else.
    const released = token ? this.releaseToken(token) : [];
    const now = this.now();
    const size = Math.min(this.maxPlayers, Math.max(2, Math.round(opts.size ?? this.maxPlayers)));
    const room: Room = {
      code,
      createdAt: now,
      lastActivity: now,
      hostId: clientId,
      members: new Map(),
      race: { phase: 'lobby', track: null, startAt: null, results: [] },
      size,
      banned: new Set(),
      lastPingBroadcastAt: now,
      counters: { posesIn: 0, posesDropped: 0 },
    };
    this.rooms.set(code, room);
    const member = this.addMember(room, clientId, identity, token);
    return { ok: true, room, member, restored: false, replacedClientId: null, released };
  }

  join(clientId: string, code: string, identity: RoomIdentity, token: string | null = null): RoomFail | JoinOk {
    if (this.byClient.has(clientId)) return fail('already_in_room', 'leave the current room first');
    const room = this.rooms.get(code);
    if (!room || this.expired(room)) {
      if (room) this.remove(room);
      return fail('not_found', `no room ${code}`);
    }
    if (room.banned.has(clientId) || (token && room.banned.has(token))) {
      // An old client cannot be told 'removed' (it does not know the code); it was banned by socket only.
      return token ? fail('removed', 'You were removed from the room') : fail('not_found', `no room ${code}`);
    }
    const seat = token ? this.seatOfToken(room, token) : null;
    if (seat) {
      // The same device: take the seat back (or replace the socket that still holds it).
      const replacedClientId = seat.clientId;
      if (replacedClientId !== null) this.byClient.delete(replacedClientId);
      seat.clientId = clientId;
      seat.awaySince = null;
      seat.poseTokens = this.poseBurst;
      seat.poseRefillAt = this.now();
      this.byClient.set(clientId, room);
      this.applyIdentity(room, seat, identity);
      this.seatsRestoredTotal += 1;
      this.touch(room);
      return { ok: true, room, member: seat, restored: true, replacedClientId, released: [] };
    }
    if (room.members.size >= room.size) return fail('full', this.fullMessage(room));
    const released = token ? this.releaseToken(token) : [];
    const member = this.addMember(room, clientId, identity, token);
    return { ok: true, room, member, restored: false, replacedClientId: null, released };
  }

  update(clientId: string, identity: RoomIdentity): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    const before = JSON.stringify(member.identity);
    this.applyIdentity(room, member, identity);
    this.touch(room);
    return { ok: true, room, changed: JSON.stringify(member.identity) !== before };
  }

  setReady(clientId: string, ready: boolean): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const changed = found.member.ready !== ready;
    found.member.ready = ready;
    this.touch(found.room);
    return { ok: true, room: found.room, changed };
  }

  /** Host only: the room size, never below the seats taken (away seats count). */
  setSize(clientId: string, size: number): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    if (room.hostId !== member.id) return fail('not_host', 'only the host changes the room size');
    const next = Math.round(size);
    if (next < 2 || next > this.maxPlayers) return fail('bad_state', `a room takes 2 to ${this.maxPlayers} players`);
    if (next < room.members.size) return fail('bad_state', `${room.members.size} players are in the room; remove someone first`);
    const changed = room.size !== next;
    room.size = next;
    this.touch(room);
    return { ok: true, room, changed };
  }

  /** Host only: remove a player (not the host). Their token and socket are banned from this room. */
  removeMember(clientId: string, targetId: string): RoomFail | { ok: true; room: Room; target: RoomMember; targetClientId: string | null } {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    if (room.hostId !== member.id) return fail('not_host', 'only the host removes players');
    const target = room.members.get(targetId);
    if (!target) return fail('bad_state', 'no such player in the room');
    if (target.id === member.id) return fail('bad_state', 'the host cannot remove themselves; use LEAVE');
    const targetClientId = target.clientId;
    this.dropMember(room, target);
    if (target.token) this.ban(room, target.token);
    if (targetClientId) this.ban(room, targetClientId);
    this.ban(room, target.id);
    this.touch(room);
    return { ok: true, room, target, targetClientId };
  }

  /** Host only: hand the host role to a present member. */
  setHost(clientId: string, targetId: string): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    if (room.hostId !== member.id) return fail('not_host', 'only the host hands over the room');
    const target = room.members.get(targetId);
    if (!target) return fail('bad_state', 'no such player in the room');
    if (target.clientId === null) return fail('bad_state', 'that player is reconnecting; try again in a moment');
    const changed = room.hostId !== target.id;
    room.hostId = target.id;
    this.touch(room);
    return { ok: true, room, changed };
  }

  /** Host only. `results` on the wire are ignored: this manager owns them. */
  setRace(clientId: string, race: Omit<RoomRace, 'results'>): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    if (room.hostId !== member.id) return fail('not_host', 'only the host sets the race');
    const track = race.track ?? room.race.track;
    if (race.phase === 'countdown') {
      if (race.startAt === null) return fail('bad_state', 'countdown needs startAt');
      if (track === null) return fail('bad_state', 'countdown needs a track');
      room.race = {
        phase: 'countdown',
        track,
        startAt: race.startAt,
        // Present members race; a seat that is away right now sits this one out.
        results: [...room.members.values()].filter((m) => m.clientId !== null).map((m): RoomResult => ({ id: m.id, name: m.identity.name, finishMs: null, falls: 0 })),
      };
    } else {
      const startAt = race.phase === 'lobby' ? null : (race.startAt ?? room.race.startAt);
      room.race = { phase: race.phase, track, startAt, results: room.race.results };
      // The next race needs everyone to tap READY again.
      if (race.phase === 'results' || race.phase === 'lobby') for (const m of room.members.values()) m.ready = false;
    }
    this.touch(room);
    return { ok: true, room, changed: true };
  }

  /** Fills the sender's results row; a sender without a row (late joiner, lobby) changes nothing. */
  finish(clientId: string, finishMs: number, falls: number): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    this.touch(room);
    if (room.race.phase === 'lobby') return { ok: true, room, changed: false };
    const row = room.race.results.find((r) => r.id === member.id);
    if (!row || row.finishMs !== null) return { ok: true, room, changed: false };
    row.finishMs = finishMs;
    row.falls = falls;
    return { ok: true, room, changed: true };
  }

  /** Token bucket per sender: 'dropped' above poseMaxHz. */
  pose(clientId: string): 'ok' | 'dropped' | 'not_in_room' {
    const found = this.memberOf(clientId);
    if (!found) return 'not_in_room';
    const { room, member } = found;
    const now = this.now();
    member.poseTokens = Math.min(this.poseBurst, member.poseTokens + ((now - member.poseRefillAt) / 1000) * this.poseMaxHz);
    member.poseRefillAt = now;
    room.lastActivity = now;
    room.counters.posesIn += 1;
    this.posesInTotal += 1;
    if (member.poseTokens >= 1) {
      member.poseTokens -= 1;
      return 'ok';
    }
    room.counters.posesDropped += 1;
    this.posesDroppedTotal += 1;
    return 'dropped';
  }

  /** Records the sender's reported round trip. Returns the room (touched) or null. */
  ping(clientId: string, rtt?: number): Room | null {
    const found = this.memberOf(clientId);
    if (!found) return null;
    if (rtt !== undefined) found.member.ping = rtt;
    this.touch(found.room);
    return found.room;
  }

  /**
   * An explicit leave: the seat is freed at once (no grace). A host leaving hands the room to `to`
   * when that member is present, else to the earliest present member. The room closes when empty.
   */
  leave(clientId: string, to?: string): LeaveResult | null {
    const found = this.memberOf(clientId);
    if (!found) return null;
    return this.dropMember(found.room, found.member, to);
  }

  /** The socket closed: a tokened seat goes away (grace), an untokened member leaves (old behaviour). */
  disconnect(clientId: string): DisconnectResult | null {
    const found = this.memberOf(clientId);
    if (!found) return null;
    const { room, member } = found;
    if (member.token === null) return { kind: 'left', ...this.dropMember(room, member) };
    this.byClient.delete(clientId);
    member.clientId = null;
    member.awaySince = this.now();
    member.ready = false;
    member.ping = null;
    return { kind: 'away', room, member };
  }

  /** Frees seats that stayed away for `seatGraceMs` (the host role moves if it was the host's). */
  expireSeats(): LeaveResult[] {
    const now = this.now();
    const gone: LeaveResult[] = [];
    for (const room of [...this.rooms.values()]) {
      for (const member of [...room.members.values()]) {
        if (member.awaySince === null || now - member.awaySince < this.seatGraceMs) continue;
        if (!this.rooms.has(room.code)) break;
        gone.push(this.dropMember(room, member));
        this.seatsExpiredTotal += 1;
      }
    }
    return gone;
  }

  /** Deletes idle rooms; returns them (with their present sockets) so the relay can tell the members. */
  sweep(): { code: string; clientIds: string[] }[] {
    const gone: { code: string; clientIds: string[] }[] = [];
    for (const room of [...this.rooms.values()]) {
      if (!this.expired(room)) continue;
      gone.push({ code: room.code, clientIds: [...room.members.values()].map((m) => m.clientId).filter((id): id is string => id !== null) });
      this.remove(room);
    }
    this.expiredTotal += gone.length;
    return gone;
  }

  touch(room: Room): void {
    room.lastActivity = this.now();
  }

  stats(): RoomStats {
    let players = 0;
    let away = 0;
    for (const room of this.rooms.values()) {
      players += room.members.size;
      for (const m of room.members.values()) if (m.clientId === null) away += 1;
    }
    return {
      rooms: this.rooms.size,
      players,
      away,
      posesIn: this.posesInTotal,
      posesDropped: this.posesDroppedTotal,
      expired: this.expiredTotal,
      seatsExpired: this.seatsExpiredTotal,
      seatsRestored: this.seatsRestoredTotal,
    };
  }

  /** Index sizes (tests: memory stays bounded). */
  indexSizes(): { byClient: number; byToken: number; banned: number } {
    let banned = 0;
    for (const room of this.rooms.values()) banned += room.banned.size;
    return { byClient: this.byClient.size, byToken: this.byToken.size, banned };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private memberOf(clientId: string): { room: Room; member: RoomMember } | null {
    const room = this.byClient.get(clientId);
    if (!room) return null;
    for (const member of room.members.values()) if (member.clientId === clientId) return { room, member };
    return null;
  }

  /**
   * "ROOM FULL (2/2)". Away seats count toward the size, so when some are held for a reconnecting
   * device the message says so and what to do: a friend who moved from a chat app's browser to Chrome
   * is a new device until the old seat expires or the host removes it.
   */
  private fullMessage(room: Room): string {
    const head = `ROOM FULL (${room.members.size}/${room.size})`;
    const now = this.now();
    let away = 0;
    let soonestMs = Infinity;
    for (const m of room.members.values()) {
      if (m.awaySince === null) continue;
      away += 1;
      soonestMs = Math.min(soonestMs, Math.max(0, m.awaySince + this.seatGraceMs - now));
    }
    if (away === 0) return head;
    const wait = soonestMs < 60_000 ? `${Math.max(1, Math.ceil(soonestMs / 1000))} s` : `${Math.ceil(soonestMs / 60_000)} min`;
    return `${head} · ${away} RECONNECTING: ask the host to REMOVE ${away === 1 ? 'that seat' : 'those seats'}, or try again in ${wait}`;
  }

  private seatOfToken(room: Room, token: string): RoomMember | null {
    for (const member of room.members.values()) if (member.token === token) return member;
    return null;
  }

  /** Gives up the token's seat in whatever room holds it (a device is seated in one room at a time). */
  private releaseToken(token: string): SeatRelease[] {
    const room = this.byToken.get(token);
    if (!room) return [];
    const member = this.seatOfToken(room, token);
    if (!member) {
      this.byToken.delete(token);
      return [];
    }
    return [this.dropMember(room, member)];
  }

  /** Removes a seat; picks a new host if needed; deletes the room when it is empty. */
  private dropMember(room: Room, member: RoomMember, to?: string): LeaveResult {
    room.members.delete(member.id);
    if (member.clientId !== null) this.byClient.delete(member.clientId);
    if (member.token !== null && this.byToken.get(member.token) === room) this.byToken.delete(member.token);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return { room, member, closed: true, newHostId: null };
    }
    let newHostId: string | null = null;
    if (room.hostId === member.id) {
      const wanted = to !== undefined ? room.members.get(to) : undefined;
      let next: RoomMember | null = wanted && wanted.clientId !== null ? wanted : null;
      if (!next) for (const m of room.members.values()) if (m.clientId !== null && (!next || m.seq < next.seq)) next = m;
      // Everyone left is away: the earliest of them holds the role until they are back or expire.
      if (!next) for (const m of room.members.values()) if (!next || m.seq < next.seq) next = m;
      room.hostId = next!.id;
      newHostId = room.hostId;
    }
    this.touch(room);
    return { room, member, closed: false, newHostId };
  }

  private addMember(room: Room, clientId: string, identity: RoomIdentity, token: string | null): RoomMember {
    const seq = ++this.seq;
    const now = this.now();
    const member: RoomMember = {
      id: clientId,
      clientId,
      token,
      baseName: '',
      identity: { ...identity },
      ready: false,
      seq,
      ping: null,
      poseTokens: this.poseBurst,
      poseRefillAt: now,
      awaySince: null,
    };
    room.members.set(clientId, member);
    this.byClient.set(clientId, room);
    if (token) this.byToken.set(token, room);
    this.applyIdentity(room, member, { ...identity, name: identity.name || `Racer ${seq}` });
    room.lastActivity = now;
    return member;
  }

  /** New identity for a seat; the name is made unique inside the room ("Anaye", "Anaye 2", …). */
  private applyIdentity(room: Room, member: RoomMember, identity: RoomIdentity): void {
    const base = identity.name || member.baseName || `Racer ${member.seq}`;
    member.baseName = base;
    member.identity = { ...identity, name: this.uniqueName(room, member, base) };
    // A name in the results table follows a rename (it is the same person).
    for (const row of room.race.results) if (row.id === member.id) row.name = member.identity.name;
  }

  private uniqueName(room: Room, member: RoomMember, base: string): string {
    const taken = new Set<string>();
    for (const m of room.members.values()) if (m !== member) taken.add(nameKey(m.identity.name));
    if (!taken.has(nameKey(base))) return base;
    for (let n = 2; n <= ROOM_MAX_PLAYERS * 4; n++) {
      const suffix = ` ${n}`;
      const stem = [...base].slice(0, ROOM_MAX_NAME - suffix.length).join('').trim();
      const candidate = `${stem}${suffix}`;
      if (!taken.has(nameKey(candidate))) return candidate;
    }
    return base;
  }

  private ban(room: Room, key: string): void {
    room.banned.add(key);
    while (room.banned.size > MAX_BANNED) {
      const oldest = room.banned.values().next().value;
      if (oldest === undefined) break;
      room.banned.delete(oldest);
    }
  }

  private remove(room: Room): void {
    for (const m of room.members.values()) {
      if (m.clientId !== null) this.byClient.delete(m.clientId);
      if (m.token !== null && this.byToken.get(m.token) === room) this.byToken.delete(m.token);
    }
    room.members.clear();
    this.rooms.delete(room.code);
  }

  private expired(room: Room): boolean {
    return this.now() - room.lastActivity >= this.idleMs;
  }

  private freshCode(): string | null {
    for (let attempt = 0; attempt < 64; attempt++) {
      const code = makeRoomCode(this.random);
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }
}
