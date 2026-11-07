/**
 * Rooms (room.v1): membership, host migration, race state and the per-sender pose rate limit —
 * pure bookkeeping with an injectable clock, so the relay tests drive expiry without real timers.
 * The relay (relay.ts) owns the sockets: it calls into this manager and sends what it is told to.
 *
 * Rules (shared/protocol.ts "Rooms"):
 *   - a client is in at most one room; the creator is host; when the host leaves, the member who
 *     joined earliest becomes host; an empty room is deleted at once;
 *   - at most ROOM_MAX_ROOMS rooms and ROOM_MAX_PLAYERS members per room;
 *   - a room nobody has talked in for `idleMs` (ROOM_IDLE_EXPIRY_MS) is deleted by `sweep()`;
 *   - results are owned here: 'countdown' resets them to the present members, `finish` fills a row,
 *     rows of members who leave stay; 'results' clears every READY so the next race needs it again;
 *   - poses above `poseMaxHz` per sender are dropped (token bucket, small burst).
 */
import {
  ROOM_IDLE_EXPIRY_MS,
  ROOM_MAX_PLAYERS,
  ROOM_MAX_ROOMS,
  ROOM_POSE_MAX_HZ,
  makeRoomCode,
  type RoomErrorCode,
  type RoomIdentity,
  type RoomPlayer,
  type RoomRace,
  type RoomResult,
} from '../../shared/protocol';

export interface RoomMember {
  id: string;
  identity: RoomIdentity;
  ready: boolean;
  /** Join order (1 = creator): host migration picks the lowest among those still present. */
  seq: number;
  ping: number | null;
  poseTokens: number;
  poseRefillAt: number;
}

export interface Room {
  code: string;
  createdAt: number;
  /** Last frame from any member (clock ms); `sweep` deletes rooms idle for `idleMs`. */
  lastActivity: number;
  hostId: string;
  /** Insertion order is join order. */
  members: Map<string, RoomMember>;
  race: RoomRace;
  /** When `room:players` last went out because of a ping update (throttled by the relay). */
  lastPingBroadcastAt: number;
  counters: { posesIn: number; posesDropped: number };
}

export type RoomResult2<T = Room> = { ok: true; room: T; changed: boolean } | { ok: false; code: RoomErrorCode; message: string };

export interface RoomManagerOptions {
  /** Clock in ms (Date.now by default). */
  now?: () => number;
  /** Random source for codes ([0, 1)). */
  random?: () => number;
  maxRooms?: number;
  maxPlayers?: number;
  idleMs?: number;
  /** Poses per second per sender above which frames are dropped. */
  poseMaxHz?: number;
  /** Back-to-back poses allowed before the limit bites. */
  poseBurst?: number;
}

export interface RoomStats {
  rooms: number;
  players: number;
  posesIn: number;
  posesDropped: number;
  expired: number;
}

export const ROOM_DEFAULTS = {
  maxRooms: ROOM_MAX_ROOMS,
  maxPlayers: ROOM_MAX_PLAYERS,
  idleMs: ROOM_IDLE_EXPIRY_MS,
  poseMaxHz: ROOM_POSE_MAX_HZ,
  poseBurst: 6,
} as const;

const fail = (code: RoomErrorCode, message: string): RoomResult2 => ({ ok: false, code, message });

export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private readonly byClient = new Map<string, Room>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly maxRooms: number;
  private readonly maxPlayers: number;
  private readonly idleMs: number;
  private readonly poseMaxHz: number;
  private readonly poseBurst: number;
  private seq = 0;
  private expiredTotal = 0;
  private posesInTotal = 0;
  private posesDroppedTotal = 0;

  constructor(options: RoomManagerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.maxRooms = options.maxRooms ?? ROOM_DEFAULTS.maxRooms;
    this.maxPlayers = options.maxPlayers ?? ROOM_DEFAULTS.maxPlayers;
    this.idleMs = options.idleMs ?? ROOM_DEFAULTS.idleMs;
    this.poseMaxHz = options.poseMaxHz ?? ROOM_DEFAULTS.poseMaxHz;
    this.poseBurst = options.poseBurst ?? ROOM_DEFAULTS.poseBurst;
  }

  roomOf(clientId: string): Room | undefined {
    return this.byClient.get(clientId);
  }

  /** Members as the wire shows them (host flag, ready, ping). */
  players(room: Room): RoomPlayer[] {
    return [...room.members.values()].map((m) => ({
      id: m.id,
      ...m.identity,
      ready: m.ready,
      isHost: m.id === room.hostId,
      ping: m.ping,
    }));
  }

  create(clientId: string, identity: RoomIdentity): RoomResult2 {
    if (this.byClient.has(clientId)) return fail('already_in_room', 'leave the current room first');
    this.sweep();
    if (this.rooms.size >= this.maxRooms) return fail('rooms_full', `the relay already hosts ${this.maxRooms} rooms; try again later`);
    const code = this.freshCode();
    if (!code) return fail('rooms_full', 'no free room code');
    const now = this.now();
    const room: Room = {
      code,
      createdAt: now,
      lastActivity: now,
      hostId: clientId,
      members: new Map(),
      race: { phase: 'lobby', track: null, startAt: null, results: [] },
      lastPingBroadcastAt: now,
      counters: { posesIn: 0, posesDropped: 0 },
    };
    this.rooms.set(code, room);
    this.addMember(room, clientId, identity);
    return { ok: true, room, changed: true };
  }

  join(clientId: string, code: string, identity: RoomIdentity): RoomResult2 {
    if (this.byClient.has(clientId)) return fail('already_in_room', 'leave the current room first');
    const room = this.rooms.get(code);
    if (!room || this.expired(room)) {
      if (room) this.remove(room);
      return fail('not_found', `no room ${code}`);
    }
    if (room.members.size >= this.maxPlayers) return fail('full', `room ${code} already has ${this.maxPlayers} players`);
    this.addMember(room, clientId, identity);
    return { ok: true, room, changed: true };
  }

  update(clientId: string, identity: RoomIdentity): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room, member } = found;
    const changed = JSON.stringify(member.identity) !== JSON.stringify(identity);
    member.identity = { ...identity, name: identity.name || member.identity.name };
    // A name in the results table follows a rename (it is the same person).
    for (const row of room.race.results) if (row.id === clientId) row.name = member.identity.name;
    this.touch(room);
    return { ok: true, room, changed };
  }

  setReady(clientId: string, ready: boolean): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const changed = found.member.ready !== ready;
    found.member.ready = ready;
    this.touch(found.room);
    return { ok: true, room: found.room, changed };
  }

  /** Host only. `results` on the wire are ignored: this manager owns them. */
  setRace(clientId: string, race: Omit<RoomRace, 'results'>): RoomResult2 {
    const found = this.memberOf(clientId);
    if (!found) return fail('not_in_room', 'not in a room');
    const { room } = found;
    if (room.hostId !== clientId) return fail('not_host', 'only the host sets the race');
    const track = race.track ?? room.race.track;
    if (race.phase === 'countdown') {
      if (race.startAt === null) return fail('bad_state', 'countdown needs startAt');
      if (track === null) return fail('bad_state', 'countdown needs a track');
      room.race = {
        phase: 'countdown',
        track,
        startAt: race.startAt,
        results: [...room.members.values()].map((m): RoomResult => ({ id: m.id, name: m.identity.name, finishMs: null, falls: 0 })),
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
    const { room } = found;
    this.touch(room);
    if (room.race.phase === 'lobby') return { ok: true, room, changed: false };
    const row = room.race.results.find((r) => r.id === clientId);
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

  /** Removes the client; the room closes when empty. `newHostId` is set when the host changed. */
  leave(clientId: string): { room: Room; closed: boolean; newHostId: string | null } | null {
    const found = this.memberOf(clientId);
    if (!found) return null;
    const { room } = found;
    room.members.delete(clientId);
    this.byClient.delete(clientId);
    if (room.members.size === 0) {
      this.rooms.delete(room.code);
      return { room, closed: true, newHostId: null };
    }
    let newHostId: string | null = null;
    if (room.hostId === clientId) {
      let oldest: RoomMember | null = null;
      for (const m of room.members.values()) if (!oldest || m.seq < oldest.seq) oldest = m;
      room.hostId = oldest!.id;
      newHostId = room.hostId;
    }
    this.touch(room);
    return { room, closed: false, newHostId };
  }

  /** Deletes idle rooms; returns them (with their member ids) so the relay can tell the members. */
  sweep(): { code: string; memberIds: string[] }[] {
    const gone: { code: string; memberIds: string[] }[] = [];
    for (const room of [...this.rooms.values()]) {
      if (!this.expired(room)) continue;
      gone.push({ code: room.code, memberIds: [...room.members.keys()] });
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
    for (const room of this.rooms.values()) players += room.members.size;
    return { rooms: this.rooms.size, players, posesIn: this.posesInTotal, posesDropped: this.posesDroppedTotal, expired: this.expiredTotal };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private memberOf(clientId: string): { room: Room; member: RoomMember } | null {
    const room = this.byClient.get(clientId);
    const member = room?.members.get(clientId);
    return room && member ? { room, member } : null;
  }

  private addMember(room: Room, clientId: string, identity: RoomIdentity): void {
    const seq = ++this.seq;
    const now = this.now();
    room.members.set(clientId, {
      id: clientId,
      identity: { ...identity, name: identity.name || `Racer ${seq}` },
      ready: false,
      seq,
      ping: null,
      poseTokens: this.poseBurst,
      poseRefillAt: now,
    });
    this.byClient.set(clientId, room);
    room.lastActivity = now;
  }

  private remove(room: Room): void {
    for (const id of room.members.keys()) this.byClient.delete(id);
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
