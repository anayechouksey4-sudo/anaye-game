/**
 * Seats (room.v1 seats) through the real relay: a device's token keeps its seat through a dropped
 * socket, the host stays the host, room size, REMOVE, MAKE HOST, LEAVE hand-over, name de-dup, old
 * (untokened) clients keep the old behaviour, and the bookkeeping stays bounded.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  ROOM_MAX_PLAYERS,
  ROOM_SEAT_GRACE_MS,
  parseMessage,
  sanitizeRoomSize,
  sanitizeRoomToken,
  type RoomIdentity,
  type RoomJoinedMessage,
} from '../../shared/protocol';
import type { RelayServer, RelayServerOptions } from '../src/relay';
import { RoomManager } from '../src/rooms';
import { TestClient, connect, startRelay } from './helpers';

let relay: RelayServer;
let clients: TestClient[] = [];
let fakeNow = 1_700_000_000_000;
const clock = () => fakeNow;

async function boot(options: RelayServerOptions = {}): Promise<void> {
  // Seat sweeps are driven by relay.sweepRooms() with the fake clock (the real interval is far away).
  relay = await startRelay({ rooms: { now: clock }, seatSweepMs: 3_600_000, ...options });
}

async function client(): Promise<TestClient> {
  const c = await connect(relay, 'game');
  clients.push(c);
  return c;
}

const identity = (name: string, carId = 'hypercar'): RoomIdentity => ({ name, carId, look: null, plate: '', avatar: null });
const tok = (n: string): string => `token-${n}-0123456789abcdef`;

async function create(c: TestClient, name: string, token: string | null, size?: number): Promise<RoomJoinedMessage> {
  c.send({ type: 'room:create', ...identity(name), ...(token ? { token } : {}), ...(size !== undefined ? { size } : {}) });
  return c.take('room:joined');
}

async function joinAs(c: TestClient, code: string, name: string, token: string | null): Promise<RoomJoinedMessage> {
  c.send({ type: 'room:join', code, ...identity(name), ...(token ? { token } : {}) });
  return c.take('room:joined');
}

/** The latest room:players a client has buffered (drains the rest). */
async function latestPlayers(c: TestClient) {
  await c.sync();
  let last = null;
  for (;;) {
    const i = c.received.findIndex((m) => m.type === 'room:players');
    if (i < 0) break;
    last = c.received.splice(i, 1)[0];
  }
  return last as Extract<ReturnType<typeof parseMessage>, { type: 'room:players' }> | null;
}

const summary = (players: { id: string; name: string; isHost: boolean; away?: true }[]) => players.map((p) => `${p.id}:${p.name}${p.isHost ? '*' : ''}${p.away ? '~' : ''}`);

beforeEach(async () => {
  fakeNow = 1_700_000_000_000;
  await boot();
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay.close();
});

describe('seat protocol helpers', () => {
  it('tokens, sizes and the new frames are sanitised; unknown extras are dropped, not fatal', () => {
    assert.equal(sanitizeRoomToken('short'), null);
    assert.equal(sanitizeRoomToken('x'.repeat(65)), null);
    assert.equal(sanitizeRoomToken('has space in it 0123'), null);
    assert.equal(sanitizeRoomToken(tok('a')), tok('a'));
    assert.deepEqual([1, 2, 5, 8, 9, 2.5, '4'].map(sanitizeRoomSize), [null, 2, 5, 8, null, null, null]);
    const create = parseMessage(JSON.stringify({ type: 'room:create', ...identity('A'), token: 'bad token', size: 99 }));
    assert.ok(create && create.type === 'room:create');
    assert.equal('token' in create, false, 'a malformed token is dropped (the client counts as untokened)');
    assert.equal('size' in create, false);
    assert.deepEqual(parseMessage(JSON.stringify({ type: 'room:size', size: 3 }))?.type, 'room:size');
    assert.equal(parseMessage(JSON.stringify({ type: 'room:size', size: 1 })), null);
    assert.equal(parseMessage(JSON.stringify({ type: 'room:remove', id: 'c1 ;' })), null);
    assert.deepEqual(parseMessage(JSON.stringify({ type: 'room:host', id: 'c7' })), { v: 1, type: 'room:host', id: 'c7' });
    const leave = parseMessage(JSON.stringify({ type: 'room:leave', to: 'c9' }));
    assert.deepEqual(leave, { v: 1, type: 'room:leave', to: 'c9' });
  });
});

describe('token seats', () => {
  it('a dropped socket keeps the seat (away); the same token takes it back: same id, host role, results row', async () => {
    const host = await client();
    const friend = await client();
    const joined = await create(host, 'Anaye', tok('host'), 2);
    assert.equal(joined.size, 2);
    const hostId = joined.you;
    await joinAs(friend, joined.code, 'Bee', tok('friend'));
    await host.take('room:players');
    host.send({ type: 'room:race', phase: 'countdown', track: 'strip', startAt: fakeNow + 4000, results: [] });
    await friend.take('room:race');

    // The host's phone drops the socket (switching apps to share the link).
    await host.close();
    const away = await friend.take('room:players', (m) => m.players.some((p) => p.away));
    assert.deepEqual(summary(away.players), [`${hostId}:Anaye*~`, `${friend.welcome.clientId}:Bee`], 'still host while away');
    assert.equal(relay.stats().rooms.away, 1);

    // 20 s later it is back on a new socket: the same seat, still host, still in the results.
    fakeNow += 20_000;
    assert.equal(relay.sweepRooms(), 0);
    const back = await client();
    const restored = await joinAs(back, joined.code, 'Anaye', tok('host'));
    assert.equal(restored.restored, true);
    assert.equal(restored.you, hostId, 'same member id');
    assert.equal(restored.size, 2);
    assert.deepEqual(summary(restored.players), [`${hostId}:Anaye*`, `${friend.welcome.clientId}:Bee`]);
    assert.deepEqual(restored.race.results.map((r) => r.id), [hostId, friend.welcome.clientId]);
    const atFriend = await latestPlayers(friend);
    assert.deepEqual(summary(atFriend!.players), [`${hostId}:Anaye*`, `${friend.welcome.clientId}:Bee`], 'the friend never became host');
    assert.equal(relay.stats().rooms.seatsRestored, 1);

    // The restored host still runs the room; its poses carry the seat id.
    back.send({ type: 'room:pose', t: 1, p: [0, 0, 0], q: [0, 0, 0, 1], s: 0, st: 0, g: 0, pm: 0 });
    assert.equal((await friend.take('room:pose')).id, hostId);
    back.send({ type: 'room:finish', finishMs: 50_000, falls: 0 });
    const race = await friend.take('room:race');
    assert.equal(race.results.find((r) => r.id === hostId)?.finishMs, 50_000);
  });

  it('a second socket with the same token replaces the first: never a duplicate member', async () => {
    const host = await client();
    const friend = await client();
    const { code } = await create(host, 'Host', tok('h'), 4);
    const first = await joinAs(friend, code, 'Bee', tok('b'));
    await host.take('room:players');
    // The friend's phone reconnects before the relay noticed the old socket died (zombie connection).
    const second = await client();
    const again = await joinAs(second, code, 'Bee', tok('b'));
    assert.equal(again.restored, true);
    assert.equal(again.you, first.you);
    assert.equal((await friend.take('room:left')).reason, 'replaced', 'the stale socket is told it was replaced');
    const list = await latestPlayers(host);
    assert.equal(list!.players.length, 2);
    assert.deepEqual(summary(list!.players), [`${host.welcome.clientId}:Host*`, `${first.you}:Bee`]);
    // A third time, from yet another socket: still two rows.
    const third = await client();
    await joinAs(third, code, 'Bee', tok('b'));
    await second.take('room:left');
    assert.equal((await latestPlayers(host))!.players.length, 2);
    // The stale socket closing later changes nothing (it no longer holds the seat).
    await friend.close();
    await second.close();
    await host.sync();
    assert.equal(relay.roomOf(third.welcome.clientId)?.members.size, 2);
    assert.equal(relay.stats().rooms.away, 0);
    // The replaced socket's frames are not the seat's any more.
    assert.equal(relay.roomOf(first.you), undefined);
  });

  it('the host role stays through the grace period and moves only when the host seat expires', async () => {
    const host = await client();
    const friend = await client();
    const { code, you: hostId } = await create(host, 'Host', tok('h'), 2);
    await joinAs(friend, code, 'Bee', tok('b'));
    await host.take('room:players');
    await host.close();
    await friend.take('room:players');
    fakeNow += ROOM_SEAT_GRACE_MS - 1;
    relay.sweepRooms();
    // The friend cannot act as host meanwhile.
    friend.send({ type: 'room:race', phase: 'lobby', track: 'ribbon', startAt: null, results: [] });
    assert.equal((await friend.take('room:error')).code, 'not_host');
    assert.equal(relay.roomOf(friend.welcome.clientId)?.hostId, hostId);
    fakeNow += 1;
    relay.sweepRooms();
    const after = await friend.take('room:players');
    assert.deepEqual(summary(after.players), [`${friend.welcome.clientId}:Bee*`], 'host seat expired → the friend is host');
    assert.equal(relay.stats().rooms.seatsExpired, 1);
    // The old host coming back later is a new member (seat gone), not host.
    const late = await client();
    const rejoined = await joinAs(late, code, 'Host', tok('h'));
    assert.equal(rejoined.restored, undefined);
    assert.notEqual(rejoined.you, hostId);
    assert.equal(rejoined.players.find((p) => p.id === rejoined.you)?.isHost, false);
  });

  it('a room whose members are all away waits for them; it closes when the last seat expires', async () => {
    const host = await client();
    const { code } = await create(host, 'Host', tok('h'), 2);
    await host.close();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(relay.stats().rooms.rooms, 1, 'kept for the grace period');
    fakeNow += 60_000;
    const back = await client();
    assert.equal((await joinAs(back, code, 'Host', tok('h'))).restored, true);
    await back.close();
    await new Promise((r) => setTimeout(r, 50));
    fakeNow += ROOM_SEAT_GRACE_MS;
    relay.sweepRooms();
    assert.equal(relay.stats().rooms.rooms, 0);
    const other = await client();
    other.send({ type: 'room:join', code, ...identity('X'), token: tok('x') });
    assert.equal((await other.take('room:error')).code, 'not_found');
  });

  it('several seats expiring in one sweep: one "closed" line, no player list for a deleted room', async () => {
    await relay.close();
    const lines: string[] = [];
    await boot({ logger: { info: (l: string) => lines.push(l), warn: (l: string) => lines.push(l) } as RelayServerOptions['logger'] });
    const host = await client();
    const b = await client();
    const { code } = await create(host, 'Host', tok('h'), 2);
    await joinAs(b, code, 'Bee', tok('b'));
    await host.close();
    await b.close();
    await new Promise((r) => setTimeout(r, 50));
    fakeNow += ROOM_SEAT_GRACE_MS;
    relay.sweepRooms();
    assert.equal(relay.stats().rooms.rooms, 0);
    const mine = lines.filter((l) => l.includes(`room ${code}`) && /seat expired/.test(l));
    assert.equal(mine.length, 2, mine.join('\n'));
    assert.ok(mine.some((l) => l.includes('closed')), mine.join('\n'));
    assert.ok(!mine.some((l) => /left\)|is host now/.test(l)), `no "(n left) / is host now" for a room that is gone:\n${mine.join('\n')}`);
  });

  it('opening a new room gives up the seat in the old one', async () => {
    const host = await client();
    const friend = await client();
    const { code } = await create(host, 'Host', tok('h'), 3);
    await joinAs(friend, code, 'Bee', tok('b'));
    await host.take('room:players');
    await friend.close();
    await host.take('room:players');
    const friendAgain = await client();
    const other = await create(friendAgain, 'Bee', tok('b'), 2);
    assert.notEqual(other.code, code);
    const list = await latestPlayers(host);
    assert.deepEqual(summary(list!.players), [`${host.welcome.clientId}:Host*`]);
  });
});

describe('host controls', () => {
  it('LEAVE: the host hands the room to `to` (or the earliest present member); the leaver gets room:left', async () => {
    const host = await client();
    const b = await client();
    const c = await client();
    const { code } = await create(host, 'Host', tok('h'), 4);
    await joinAs(b, code, 'Bee', tok('b'));
    await joinAs(c, code, 'Cee', tok('c'));
    host.send({ type: 'room:leave', to: c.welcome.clientId });
    assert.equal((await host.take('room:left')).reason, 'left');
    const list = await latestPlayers(b);
    assert.deepEqual(summary(list!.players), [`${b.welcome.clientId}:Bee`, `${c.welcome.clientId}:Cee*`]);
    // Without `to` (or with an away one): the earliest present member.
    await b.close(); // Bee goes away (tokened)
    await c.take('room:players');
    const d = await client();
    await joinAs(d, code, 'Dee', tok('d'));
    c.send({ type: 'room:leave', to: b.welcome.clientId });
    await c.take('room:left');
    const after = await latestPlayers(d);
    assert.deepEqual(summary(after!.players), [`${b.welcome.clientId}:Bee~`, `${d.welcome.clientId}:Dee*`], 'an away member is skipped');
  });

  it('MAKE HOST hands the role over; only the host may; never to an away seat', async () => {
    const host = await client();
    const b = await client();
    const c = await client();
    const { code } = await create(host, 'Host', tok('h'), 3);
    await joinAs(b, code, 'Bee', tok('b'));
    await joinAs(c, code, 'Cee', tok('c'));
    b.send({ type: 'room:host', id: b.welcome.clientId });
    assert.equal((await b.take('room:error')).code, 'not_host');
    await c.close();
    await host.sync();
    host.send({ type: 'room:host', id: c.welcome.clientId });
    assert.equal((await host.take('room:error')).code, 'bad_state');
    host.send({ type: 'room:host', id: b.welcome.clientId });
    const list = await host.take('room:players', (m) => m.players.some((p) => p.id === b.welcome.clientId && p.isHost));
    assert.deepEqual(summary(list.players), [`${host.welcome.clientId}:Host`, `${b.welcome.clientId}:Bee*`, `${c.welcome.clientId}:Cee~`]);
    // The new host runs the race; the old one cannot.
    host.send({ type: 'room:race', phase: 'lobby', track: 'ribbon', startAt: null, results: [] });
    assert.equal((await host.take('room:error')).code, 'not_host');
    b.send({ type: 'room:race', phase: 'lobby', track: 'ribbon', startAt: null, results: [] });
    assert.equal((await host.take('room:race')).track, 'ribbon');
  });

  it('room size: a join beyond it gets ROOM FULL (2/2); the host raises it; never below the seats taken; members cannot', async () => {
    const host = await client();
    const b = await client();
    const c = await client();
    const { code, size } = await create(host, 'Host', tok('h'), 2);
    assert.equal(size, 2);
    await joinAs(b, code, 'Bee', tok('b'));
    c.send({ type: 'room:join', code, ...identity('Cee'), token: tok('c') });
    const full = await c.take('room:error');
    assert.deepEqual([full.code, full.message], ['full', 'ROOM FULL (2/2)']);
    // An away seat still counts; the message says so and what to do (M5 fix: it used to be a bare
    // 'ROOM FULL (2/2)', a dead end for a friend who moved from a chat app's browser to Chrome).
    await b.close();
    await host.take('room:players', (m) => m.players.some((p) => p.away));
    c.send({ type: 'room:join', code, ...identity('Cee'), token: tok('c') });
    const fullAway = await c.take('room:error');
    assert.equal(fullAway.code, 'full');
    assert.equal(fullAway.message, 'ROOM FULL (2/2) · 1 RECONNECTING: ask the host to REMOVE that seat, or try again in 2 min');
    fakeNow += ROOM_SEAT_GRACE_MS - 30_000;
    c.send({ type: 'room:join', code, ...identity('Cee'), token: tok('c') });
    assert.match((await c.take('room:error')).message, /^ROOM FULL \(2\/2\) · 1 RECONNECTING: .* try again in 30 s$/);
    const b2 = await client();
    await joinAs(b2, code, 'Bee', tok('b'));
    b2.send({ type: 'room:size', size: 3 });
    assert.equal((await b2.take('room:error')).code, 'not_host');
    host.send({ type: 'room:size', size: 3 });
    const grown = await host.take('room:players', (m) => m.size === 3);
    assert.equal(grown.size, 3);
    await joinAs(c, code, 'Cee', tok('c'));
    host.send({ type: 'room:size', size: 2 });
    const no = await host.take('room:error');
    assert.equal(no.code, 'bad_state', 'never below the seats taken');
    assert.match(no.message, /3 players/);
    assert.equal(relay.roomOf(host.welcome.clientId)?.size, 3);
  });

  it('REMOVE: the device is told, its seat is gone, and it cannot come back by token or by code', async () => {
    const host = await client();
    const b = await client();
    const c = await client();
    const { code } = await create(host, 'Host', tok('h'), 3);
    await joinAs(b, code, 'Bee', tok('b'));
    const cj = await joinAs(c, code, 'Cee', tok('c'));
    b.send({ type: 'room:remove', id: cj.you });
    assert.equal((await b.take('room:error')).code, 'not_host');
    host.send({ type: 'room:remove', id: host.welcome.clientId });
    assert.equal((await host.take('room:error')).code, 'bad_state');
    host.send({ type: 'room:remove', id: cj.you });
    assert.equal((await c.take('room:left')).reason, 'removed');
    const list = await latestPlayers(b);
    assert.deepEqual(summary(list!.players), [`${host.welcome.clientId}:Host*`, `${b.welcome.clientId}:Bee`]);
    // Back by token (any socket) or on the same socket: refused for the room's life.
    c.send({ type: 'room:join', code, ...identity('Cee'), token: tok('c') });
    const refused = await c.take('room:error');
    assert.deepEqual([refused.code, refused.message], ['removed', 'You were removed from the room']);
    const c2 = await client();
    c2.send({ type: 'room:join', code, ...identity('Cee'), token: tok('c') });
    assert.equal((await c2.take('room:error')).code, 'removed');
    // A different device still gets in.
    const d = await client();
    assert.equal((await joinAs(d, code, 'Dee', tok('d'))).players.length, 3);
  });

  it('REMOVE also works on an away seat (the device never gets it back)', async () => {
    const host = await client();
    const b = await client();
    const { code } = await create(host, 'Host', tok('h'), 2);
    const bj = await joinAs(b, code, 'Bee', tok('b'));
    await b.close();
    await host.take('room:players', (m) => m.players.some((p) => p.away));
    host.send({ type: 'room:remove', id: bj.you });
    const list = await host.take('room:players', (m) => m.players.length === 1);
    assert.equal(list.players.length, 1);
    const b2 = await client();
    b2.send({ type: 'room:join', code, ...identity('Bee'), token: tok('b') });
    assert.equal((await b2.take('room:error')).code, 'removed');
  });
});

describe('names', () => {
  it('two devices with the default driver name show as "Anaye" and "Anaye 2"; renames are de-duplicated too', async () => {
    const a = await client();
    const b = await client();
    const c = await client();
    const { code } = await create(a, 'Anaye', tok('a'), 4);
    const bj = await joinAs(b, code, 'Anaye', tok('b'));
    assert.deepEqual(bj.players.map((p) => p.name), ['Anaye', 'Anaye 2']);
    const cj = await joinAs(c, code, 'anaye', tok('c'));
    assert.deepEqual(cj.players.map((p) => p.name), ['Anaye', 'Anaye 2', 'anaye 3'], 'case-insensitive');
    c.send({ type: 'room:update', ...identity('Anaye 2') });
    const renamed = await latestPlayers(a);
    assert.deepEqual(renamed!.players.map((p) => p.name), ['Anaye', 'Anaye 2', 'Anaye 2 2']);
    // A long name keeps the suffix within 16 characters; a seat restored keeps its suffix.
    const d = await client();
    await joinAs(d, code, 'Sixteen Chars Ok', tok('d'));
    const e = await client();
    e.send({ type: 'room:size', size: 5 });
    await a.sync();
    a.send({ type: 'room:size', size: 6 });
    await latestPlayers(a);
    const ej = await joinAs(e, code, 'Sixteen Chars Ok', tok('e'));
    assert.equal(ej.players.at(-1)!.name, 'Sixteen Chars 2');
    assert.ok([...ej.players.at(-1)!.name].length <= 16);
    await b.close();
    await a.take('room:players');
    const b2 = await client();
    assert.equal((await joinAs(b2, code, 'Anaye', tok('b'))).players[1]!.name, 'Anaye 2');
  });

  it('a rename during a race also renames the results row on every phone (room:race follows room:players)', async () => {
    const host = await client();
    const friend = await client();
    const { code } = await create(host, 'Anaye', tok('rh'), 2);
    const fj = await joinAs(friend, code, 'Anaye', tok('rf'));
    await host.take('room:players');
    host.send({ type: 'room:race', phase: 'countdown', track: 'strip', startAt: fakeNow + 4000, results: [] });
    await host.take('room:race');
    await friend.take('room:race');
    // The link joiner answers the one-time name card in the room.
    friend.send({ type: 'room:update', ...identity('Ravi') });
    const race = await host.take('room:race', (m) => m.results.some((r) => r.id === fj.you && r.name === 'Ravi'));
    assert.deepEqual(race.results.map((r) => r.name), ['Anaye', 'Ravi']);
  });
});

describe('old clients (no token, no size)', () => {
  it('create a room of ROOM_MAX_PLAYERS, join it, and keep the old disconnect behaviour (gone at once, host migrates)', async () => {
    const oldHost = await client();
    const oldFriend = await client();
    const newFriend = await client();
    const created = await create(oldHost, 'Old', null);
    assert.equal(created.size, ROOM_MAX_PLAYERS);
    await joinAs(oldFriend, created.code, 'Older', null);
    await joinAs(newFriend, created.code, 'New', tok('n'));
    await oldHost.close();
    const list = await oldFriend.take('room:players', (m) => m.players.length === 2);
    assert.deepEqual(summary(list.players), [`${oldFriend.welcome.clientId}:Older*`, `${newFriend.welcome.clientId}:New`], 'old behaviour: gone at once, earliest present member is host');
    // A new host may remove an old client: it gets 'closed' (a reason it knows) and is kept out on that socket.
    oldFriend.send({ type: 'room:leave' });
    await oldFriend.take('room:left');
    const old2 = await client();
    await joinAs(old2, created.code, 'Old2', null);
    newFriend.send({ type: 'room:remove', id: old2.welcome.clientId });
    assert.equal((await old2.take('room:left')).reason, 'closed');
    old2.send({ type: 'room:join', code: created.code, ...identity('Old2') });
    assert.equal((await old2.take('room:error')).code, 'not_found', 'an old client is never sent a code it does not know');
  });

  it('frames to an old client only use codes and reasons the previous parser knows', async () => {
    const host = await client();
    const old = await client();
    const { code } = await create(host, 'Host', tok('h'), 2);
    await joinAs(old, code, 'Old', null);
    const third = await client();
    third.send({ type: 'room:join', code, ...identity('X') });
    assert.equal((await third.take('room:error')).code, 'full'); // in the previous list
    host.send({ type: 'room:remove', id: old.welcome.clientId });
    assert.equal((await old.take('room:left')).reason, 'closed'); // in the previous list
    for (const raw of old.raw.filter((r) => r.includes('"room:'))) {
      const m = JSON.parse(raw) as { type: string; code?: string; reason?: string };
      if (m.type === 'room:error') assert.ok(['bad_code', 'not_found', 'full', 'rooms_full', 'already_in_room', 'not_in_room', 'not_host', 'bad_state'].includes(m.code!));
      if (m.type === 'room:left') assert.ok(['left', 'expired', 'closed'].includes(m.reason!));
    }
  });
});

describe('memory', () => {
  it('RoomManager indexes stay bounded through churn: reconnects, replaces, expiries and bans', () => {
    let t = 0;
    const m = new RoomManager({ now: () => t, random: Math.random, maxRooms: 4 });
    let socket = 0;
    const sock = () => `s${++socket}`;
    for (let round = 0; round < 200; round++) {
      const hostSock = sock();
      const created = m.create(hostSock, identity('H'), { token: `tok-host-${round % 3}-0123456789`, size: 3 });
      assert.ok(created.ok);
      const code = created.ok ? created.room.code : '';
      const friendTok = `tok-friend-${round % 5}-0123456789`;
      let friendSock = sock();
      m.join(friendSock, code, identity('F'), friendTok);
      for (let k = 0; k < 5; k++) {
        m.disconnect(friendSock);
        friendSock = sock();
        m.join(friendSock, code, identity('F'), friendTok); // restore
        friendSock = sock();
        m.join(friendSock, code, identity('F'), friendTok); // replace (the previous socket is dropped from the index)
      }
      const intruder = sock();
      const j = m.join(intruder, code, identity('I'), `tok-x-${round}-0123456789`);
      if (j.ok) m.removeMember(hostSock, j.member.id);
      // Every third round the friend stays (its room lives on); the others drop and expire.
      if (round % 3 !== 0) m.disconnect(friendSock);
      m.disconnect(hostSock);
      t += ROOM_SEAT_GRACE_MS;
      m.expireSeats();
      const sizes = m.indexSizes();
      assert.ok(sizes.byClient <= m.stats().players && sizes.byToken <= m.stats().players, `round ${round}: ${JSON.stringify(sizes)}`);
      if (m.stats().rooms >= 4) {
        t += 3 * 60 * 60 * 1000; // idle rooms go
        m.sweep();
      }
    }
    const sizes = m.indexSizes();
    const stats = m.stats();
    assert.ok(stats.rooms <= 4, `rooms ${stats.rooms}`);
    assert.ok(sizes.byClient <= stats.players, `byClient ${sizes.byClient} ≤ players ${stats.players}`);
    assert.ok(sizes.byToken <= stats.players, `byToken ${sizes.byToken} ≤ players ${stats.players}`);
    assert.ok(sizes.banned <= 4 * 32);
    t += 10 * 60 * 60 * 1000;
    m.sweep();
    assert.deepEqual(m.indexSizes(), { byClient: 0, byToken: 0, banned: 0 });
    assert.equal(m.stats().rooms, 0);
  });
});
