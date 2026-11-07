/**
 * Rooms (room.v1) through the real relay: codes, membership, fan-out, host migration, race state,
 * the pose rate limit, expiry (injected clock) and the memory bound.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_IDLE_EXPIRY_MS,
  ROOM_MAX_PLAYERS,
  makeRoomCode,
  parseMessage,
  sanitizeRoomCode,
  sanitizeRoomIdentity,
  sanitizeRoomPose,
  type RoomIdentity,
  type RoomJoinedMessage,
  type RoomPose,
} from '../../shared/protocol';
import type { RelayServer, RelayServerOptions } from '../src/relay';
import { RoomManager } from '../src/rooms';
import { TestClient, connect, startRelay } from './helpers';

let relay: RelayServer;
let clients: TestClient[] = [];
/** Injected room clock: tests move it; the relay never sees real time for rooms. */
let fakeNow = 1_700_000_000_000;
const clock = () => fakeNow;

const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

async function boot(options: RelayServerOptions = {}): Promise<void> {
  relay = await startRelay({ rooms: { now: clock }, ...options });
}

async function join(): Promise<TestClient> {
  const client = await connect(relay, 'game');
  clients.push(client);
  return client;
}

const identity = (name: string, carId = 'hypercar'): RoomIdentity => ({ name, carId, look: null, plate: '', avatar: null });

async function createRoom(client: TestClient, name: string): Promise<RoomJoinedMessage> {
  client.send({ type: 'room:create', ...identity(name) });
  return client.take('room:joined');
}

async function joinRoom(client: TestClient, code: string, name: string): Promise<RoomJoinedMessage> {
  client.send({ type: 'room:join', code, ...identity(name) });
  return client.take('room:joined');
}

const pose = (t: number, x = 1): Omit<RoomPose, 'id'> => ({ t, p: [x, 0.5, -2], q: [0, 0, 0, 1], s: 60, st: 0.1, g: 1, pm: 120 });

beforeEach(async () => {
  fakeNow = 1_700_000_000_000;
  await boot();
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay.close();
});

describe('room protocol helpers', () => {
  it('codes use the 20-letter alphabet, are 4 long, and typed codes are normalised', () => {
    assert.equal(ROOM_CODE_ALPHABET.length, 20);
    assert.equal(new Set(ROOM_CODE_ALPHABET).size, 20);
    for (const ch of 'AEIOUY01') assert.ok(!ROOM_CODE_ALPHABET.includes(ch), `alphabet contains ${ch}`);
    let seed = 7;
    const random = () => ((seed = (seed * 48271) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) assert.match(makeRoomCode(random), CODE_RE);
    assert.equal(sanitizeRoomCode(' bxkz '), 'BXKZ');
    assert.equal(sanitizeRoomCode('BXK'), null);
    assert.equal(sanitizeRoomCode('AXKZ'), null); // vowel
    assert.equal(sanitizeRoomCode('BXKZQ'), null);
    assert.equal(sanitizeRoomCode(42), null);
  });

  it('sanitises identities: display-text names, ids, share codes and plates', () => {
    const clean = sanitizeRoomIdentity({ name: '  <b>Volt</b>  ', carId: 'kart', look: 'RIDE1-abc_DEF-123', plate: 'ab 12*%cd', avatar: 'DRV1-xyz' });
    assert.deepEqual(clean, { name: 'bVolt/b', carId: 'kart', look: 'RIDE1-abc_DEF-123', plate: 'AB 12CD', avatar: 'DRV1-xyz' });
    assert.equal(sanitizeRoomIdentity({ name: 'x', carId: 'bad id!' }), null);
    assert.equal(sanitizeRoomIdentity({ name: 7, carId: 'kart' }), null);
    const fallbacks = sanitizeRoomIdentity({ name: 'x', carId: 'kart', look: 'DRV1-wrongprefix', avatar: 'RIDE1-wrong', plate: 12 });
    assert.deepEqual(fallbacks, { name: 'x', carId: 'kart', look: null, plate: '', avatar: null });
    assert.equal(sanitizeRoomIdentity({ name: 'x', carId: 'kart', look: `RIDE1-${'a'.repeat(300)}` })?.look, null);
  });

  it('quantises poses and rejects malformed ones; room frames round-trip through parseMessage', () => {
    const q = sanitizeRoomPose({ t: 12.6, p: [1.23456, -0.004, 1e9], q: [0.123456, 0, 0, 1.5], s: 61.26, st: 1.7, g: 2.4, pm: 10.26 });
    assert.deepEqual(q, { id: '', t: 13, p: [1.23, -0, 1e5], q: [0.1235, 0, 0, 1], s: 61.3, st: 1, g: 2, pm: 10.3 });
    assert.equal(sanitizeRoomPose({ t: 1, p: [1, 2], q: [0, 0, 0, 1], s: 0, st: 0, g: 0, pm: 0 }), null);
    assert.equal(sanitizeRoomPose({ t: 1, p: [1, 2, 'x'], q: [0, 0, 0, 1], s: 0, st: 0, g: 0, pm: 0 }), null);
    const race = parseMessage({ type: 'room:race', v: 1, phase: 'countdown', track: 'ribbon', startAt: 5.4, results: [{ id: 'c1', name: 'A', finishMs: null, falls: 0 }] });
    assert.deepEqual(race, { v: 1, type: 'room:race', phase: 'countdown', track: 'ribbon', startAt: 5, results: [{ id: 'c1', name: 'A', finishMs: null, falls: 0 }] });
    assert.equal(parseMessage({ type: 'room:race', v: 1, phase: 'warmup' }), null);
    assert.equal(parseMessage({ type: 'room:join', v: 1, code: 'AAAA', name: 'x', carId: 'kart' }), null);
    assert.deepEqual(parseMessage({ type: 'room:ready', v: 1, ready: true }), { v: 1, type: 'room:ready', ready: true });
    assert.equal(parseMessage({ type: 'room:ready', v: 1, ready: 'yes' }), null);
  });
});

describe('create and join', () => {
  it('create answers room:joined with a valid code, the creator as host, a lobby race and serverNow from the room clock', async () => {
    const a = await join();
    const joined = await createRoom(a, 'Anaye');
    assert.match(joined.code, CODE_RE);
    assert.equal(joined.you, a.welcome.clientId);
    assert.deepEqual(joined.players, [{ id: a.welcome.clientId, name: 'Anaye', carId: 'hypercar', look: null, plate: '', avatar: null, ready: false, isHost: true, ping: null }]);
    assert.deepEqual(joined.race, { phase: 'lobby', track: null, startAt: null, results: [] });
    assert.equal(joined.serverNow, fakeNow);
    assert.equal(relay.stats().rooms.rooms, 1);
  });

  it('join by code (any case) adds the player; the others get room:players; the newcomer sees everyone', async () => {
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'Host');
    const joined = await joinRoom(b, code.toLowerCase(), 'Friend');
    assert.equal(joined.code, code);
    assert.deepEqual(
      joined.players.map((p) => [p.id, p.name, p.isHost]),
      [
        [a.welcome.clientId, 'Host', true],
        [b.welcome.clientId, 'Friend', false],
      ],
    );
    const list = await a.take('room:players');
    assert.equal(list.players.length, 2);
    await b.sync();
    assert.equal(b.count('room:players'), 0, 'the newcomer gets the list in room:joined, not a second time');
  });

  it('rejects malformed codes (bad_message), unknown codes (not_found), double membership and full rooms', async () => {
    await relay.close();
    await boot({ rooms: { now: clock, maxPlayers: 2 } });
    const a = await join();
    const b = await join();
    const c = await join();
    const { code } = await createRoom(a, 'Host');

    b.send({ type: 'room:join', code: 'A1!', ...identity('x') } as never);
    assert.equal((await b.take('server:error')).code, 'bad_message');

    b.send({ type: 'room:join', code: code === 'BBBB' ? 'CCCC' : 'BBBB', ...identity('x') });
    assert.equal((await b.take('room:error')).code, 'not_found');

    a.send({ type: 'room:create', ...identity('again') });
    assert.equal((await a.take('room:error')).code, 'already_in_room');

    await joinRoom(b, code, 'B');
    c.send({ type: 'room:join', code, ...identity('C') });
    assert.equal((await c.take('room:error')).code, 'full');
    await a.take('room:players');
  });

  it('an empty name becomes a default; an oversized/markup name is cleaned; ROOM_MAX_PLAYERS is the default cap', async () => {
    const a = await join();
    a.send({ type: 'room:create', ...identity(''), name: '' });
    const joined = await a.take('room:joined');
    assert.match(joined.players[0]!.name, /^Racer \d+$/);
    const b = await join();
    b.send({ type: 'room:join', code: joined.code, ...identity('x'), name: 'A very very very long name <script>' });
    const bj = await b.take('room:joined');
    assert.equal(bj.players[1]!.name, 'A very very ve');
    assert.equal(ROOM_MAX_PLAYERS, 8);
    await a.take('room:players');
  });

  it('bounds memory: at most maxRooms rooms; a room whose last player disconnected is freed at once', async () => {
    await relay.close();
    await boot({ rooms: { now: clock, maxRooms: 2 } });
    const a = await join();
    const b = await join();
    const c = await join();
    const first = await createRoom(a, 'A');
    await createRoom(b, 'B');
    c.send({ type: 'room:create', ...identity('C') });
    assert.equal((await c.take('room:error')).code, 'rooms_full');
    await a.close();
    await c.take('server:presence');
    assert.equal(relay.stats().rooms.rooms, 1);
    c.send({ type: 'room:join', code: first.code, ...identity('C') });
    assert.equal((await c.take('room:error')).code, 'not_found', 'the closed room is gone');
    await createRoom(c, 'C');
    assert.equal(relay.stats().rooms.rooms, 2);
  });
});

describe('poses', () => {
  it('fans a pose out to every other member with id and from stamped, never to the sender or outsiders', async () => {
    const a = await join();
    const b = await join();
    const c = await join();
    const outsider = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');
    await joinRoom(c, code, 'C');
    await a.take('room:players');
    await b.take('room:players');

    a.send({ type: 'room:pose', ...pose(1000, 1.23456) });
    const atB = await b.take('room:pose');
    const atC = await c.take('room:pose');
    for (const m of [atB, atC]) {
      assert.equal(m.id, a.welcome.clientId);
      assert.equal(m.from, a.welcome.clientId);
      assert.deepEqual(m.p, [1.23, 0.5, -2]);
      assert.equal(m.t, 1000);
    }
    await a.sync();
    await outsider.sync();
    assert.equal(a.count('room:pose'), 0);
    assert.equal(outsider.count('room:pose'), 0);
    assert.equal(relay.stats().counters.posesRelayed, 2);

    outsider.send({ type: 'room:pose', ...pose(1) });
    assert.equal((await outsider.take('room:error')).code, 'not_in_room');
  });

  it('drops a sender above ROOM_POSE_MAX_HZ (token bucket) and refills with the clock', async () => {
    await relay.close();
    await boot({ rooms: { now: clock, poseMaxHz: 30, poseBurst: 6 } });
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');

    for (let i = 0; i < 40; i++) a.send({ type: 'room:pose', ...pose(i) });
    await a.sync();
    await b.sync();
    assert.equal(b.count('room:pose'), 6, 'only the burst gets through with a frozen clock');
    assert.equal(relay.stats().rooms.posesDropped, 34);

    fakeNow += 1000; // 30 tokens refill (capped at the burst of 6)
    for (let i = 0; i < 10; i++) a.send({ type: 'room:pose', ...pose(100 + i) });
    await a.sync();
    await b.sync();
    assert.equal(b.count('room:pose'), 12);

    // Steady 15 Hz (one frame per 66 ms of clock) is never dropped.
    const before = relay.stats().rooms.posesDropped;
    for (let i = 0; i < 30; i++) {
      fakeNow += 66;
      a.send({ type: 'room:pose', ...pose(200 + i) });
      await a.sync(); // the relay sees each pose at its own clock time
    }
    await b.sync();
    assert.equal(relay.stats().rooms.posesDropped, before);
    assert.equal(b.count('room:pose'), 42);
  });
});

describe('membership and host migration', () => {
  it('room:leave tells the leaver (room:left) and the rest (room:players); the earliest member becomes host', async () => {
    const a = await join();
    const b = await join();
    const c = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');
    await joinRoom(c, code, 'C');
    await a.take('room:players');
    await b.take('room:players');

    a.send({ type: 'room:leave' });
    assert.equal((await a.take('room:left')).reason, 'left');
    const atB = await b.take('room:players');
    const atC = await c.take('room:players');
    assert.deepEqual(
      atB.players.map((p) => [p.id, p.isHost]),
      [
        [b.welcome.clientId, true],
        [c.welcome.clientId, false],
      ],
    );
    assert.deepEqual(atC.players, atB.players);
    assert.equal(relay.roomOf(a.welcome.clientId), undefined);

    // A disconnect migrates the same way.
    await b.close();
    const afterClose = await c.take('room:players');
    assert.deepEqual(afterClose.players.map((p) => [p.id, p.isHost]), [[c.welcome.clientId, true]]);
    assert.equal(relay.roomOf(c.welcome.clientId)?.hostId, c.welcome.clientId);

    a.send({ type: 'room:leave' });
    assert.equal((await a.take('room:error')).code, 'not_in_room');
  });

  it('READY and identity updates broadcast room:players; a rename follows into the results', async () => {
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');

    b.send({ type: 'room:ready', ready: true });
    assert.equal((await a.take('room:players')).players[1]!.ready, true);
    assert.equal((await b.take('room:players')).players[1]!.ready, true);
    b.send({ type: 'room:ready', ready: true });
    await b.sync();
    assert.equal(b.count('room:players'), 0, 'no broadcast when nothing changed');

    b.send({ type: 'room:update', ...identity('Bee', 'kart'), plate: 'bee 1', look: 'RIDE1-abc', avatar: 'DRV1-def' });
    const list = await a.take('room:players');
    assert.deepEqual(list.players[1], { id: b.welcome.clientId, name: 'Bee', carId: 'kart', look: 'RIDE1-abc', plate: 'BEE 1', avatar: 'DRV1-def', ready: true, isHost: false, ping: null });
    await b.take('room:players');

    a.send({ type: 'room:race', phase: 'countdown', track: 'strip', startAt: fakeNow + 4000, results: [] });
    await a.take('room:race');
    await b.take('room:race');
    await a.take('room:players');
    await b.take('room:players');
    b.send({ type: 'room:update', ...identity('Buzz', 'kart') });
    await a.take('room:players');
    await b.take('room:players');
    assert.equal(relay.roomOf(a.welcome.clientId)?.race.results[1]?.name, 'Buzz');
  });

  it('room:ping answers room:pong with the echoed t and serverNow, and the reported rtt shows up in the player list', async () => {
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');
    b.send({ type: 'room:ping', t: 123.5, rtt: 41 });
    const pong = await b.take('room:pong');
    assert.equal(pong.t, 123.5);
    assert.equal(pong.serverNow, fakeNow);
    fakeNow += 5000;
    b.send({ type: 'room:ping', t: 124, rtt: 43 });
    await b.take('room:pong');
    assert.equal((await a.take('room:players')).players[1]!.ping, 43);
    // Outside a room a ping still gets its pong (clock sync before joining).
    const c = await join();
    c.send({ type: 'room:ping', t: 1 });
    assert.equal((await c.take('room:pong')).t, 1);
  });
});

describe('race state', () => {
  it('only the host sets the race; countdown needs startAt and a track; results are owned by the relay in finish order', async () => {
    const a = await join();
    const b = await join();
    const c = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');

    b.send({ type: 'room:race', phase: 'lobby', track: 'ribbon', startAt: null, results: [] });
    assert.equal((await b.take('room:error')).code, 'not_host');

    a.send({ type: 'room:race', phase: 'countdown', track: null, startAt: null, results: [] });
    assert.equal((await a.take('room:error')).code, 'bad_state');

    a.send({ type: 'room:race', phase: 'lobby', track: 'ribbon', startAt: null, results: [] });
    const lobby = await b.take('room:race');
    assert.deepEqual({ phase: lobby.phase, track: lobby.track, startAt: lobby.startAt, from: lobby.from }, { phase: 'lobby', track: 'ribbon', startAt: null, from: a.welcome.clientId });
    await a.take('room:race');
    await a.take('room:players');
    await b.take('room:players');

    const startAt = fakeNow + 4000;
    // Host-sent results are ignored: the relay builds the rows from the members present.
    a.send({ type: 'room:race', phase: 'countdown', track: null, startAt, results: [{ id: 'zzz', name: 'ghost', finishMs: 1, falls: 0 }] });
    const cd = await b.take('room:race');
    assert.equal(cd.phase, 'countdown');
    assert.equal(cd.track, 'ribbon', 'a null track keeps the lobby track');
    assert.equal(cd.startAt, startAt);
    assert.deepEqual(cd.results, [
      { id: a.welcome.clientId, name: 'A', finishMs: null, falls: 0 },
      { id: b.welcome.clientId, name: 'B', finishMs: null, falls: 0 },
    ]);
    await a.take('room:race');
    await a.take('room:players');
    await b.take('room:players');

    // A late joiner gets the live race in room:joined but no results row.
    await joinRoom(c, code, 'C');
    await a.take('room:players');
    await b.take('room:players');
    assert.equal(relay.roomOf(c.welcome.clientId)?.race.results.length, 2);
    c.send({ type: 'room:finish', finishMs: 100, falls: 0 });
    await c.sync();
    assert.equal(c.count('room:race'), 0, 'a finish without a row changes nothing');

    b.send({ type: 'room:finish', finishMs: 61234.6, falls: 1 });
    const afterB = await a.take('room:race');
    assert.equal(afterB.from, b.welcome.clientId);
    assert.deepEqual(afterB.results[1], { id: b.welcome.clientId, name: 'B', finishMs: 61235, falls: 1 });
    assert.equal(afterB.results[0]!.finishMs, null);
    await b.take('room:race');
    await c.take('room:race');

    b.send({ type: 'room:finish', finishMs: 1, falls: 0 });
    await b.sync();
    assert.equal(b.count('room:race'), 0, 'a second finish is ignored');

    a.send({ type: 'room:finish', finishMs: 65000, falls: 0 });
    for (const x of [a, b, c]) assert.equal((await x.take('room:race')).results[0]!.finishMs, 65000);

    a.send({ type: 'room:race', phase: 'results', track: null, startAt: null, results: [] });
    for (const x of [a, b, c]) {
      const r = await x.take('room:race');
      assert.equal(r.phase, 'results');
      assert.equal(r.startAt, startAt, 'results keep startAt');
      assert.deepEqual(
        r.results.map((row) => row.finishMs),
        [65000, 61235],
      );
      const list = await x.take('room:players');
      assert.ok(list.players.every((p) => !p.ready), 'READY is cleared for the next race');
    }
  });

  it('results rows of a member who left stay; the migrated host can run the next race', async () => {
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');
    a.send({ type: 'room:race', phase: 'countdown', track: 'strip', startAt: fakeNow + 4000, results: [] });
    await a.take('room:race');
    await b.take('room:race');
    await a.take('room:players');
    await b.take('room:players');
    await a.close();
    const migrated = await b.take('room:players');
    assert.equal(migrated.players[0]!.isHost, true);
    assert.equal(relay.roomOf(b.welcome.clientId)?.race.results.length, 2);
    b.send({ type: 'room:race', phase: 'countdown', track: 'strip', startAt: fakeNow + 8000, results: [] });
    const next = await b.take('room:race');
    assert.deepEqual(next.results.map((r) => r.id), [b.welcome.clientId]);
  });
});

describe('expiry', () => {
  it('a room idle for ROOM_IDLE_EXPIRY_MS is swept: members get room:left expired, the code is unknown afterwards', async () => {
    const a = await join();
    const b = await join();
    const { code } = await createRoom(a, 'A');
    await joinRoom(b, code, 'B');
    await a.take('room:players');

    fakeNow += ROOM_IDLE_EXPIRY_MS - 1;
    assert.equal(relay.sweepRooms(), 0);
    a.send({ type: 'room:ready', ready: true }); // activity resets the idle clock
    await a.take('room:players');
    await b.take('room:players');
    fakeNow += ROOM_IDLE_EXPIRY_MS - 1;
    assert.equal(relay.sweepRooms(), 0, 'touched one ms before the deadline');
    fakeNow += 1;
    assert.equal(relay.sweepRooms(), 1);
    assert.equal((await a.take('room:left')).reason, 'expired');
    assert.equal((await b.take('room:left')).reason, 'expired');
    assert.equal(relay.stats().rooms.rooms, 0);
    assert.equal(relay.stats().rooms.expired, 1);
    b.send({ type: 'room:join', code, ...identity('B') });
    assert.equal((await b.take('room:error')).code, 'not_found');
    // Both are free to start again.
    await createRoom(a, 'A');
  });

  it('the relay sweeps on its own interval (fake room clock, short real interval)', async () => {
    await relay.close();
    await boot({ rooms: { now: clock }, roomSweepMs: 30 });
    const a = await join();
    await createRoom(a, 'A');
    fakeNow += ROOM_IDLE_EXPIRY_MS;
    assert.equal((await a.take('room:left', () => true, 2000)).reason, 'expired');
  });

  it('RoomManager alone: idle rooms expire on sweep and a join into an expired room reports not_found', () => {
    let t = 0;
    const m = new RoomManager({ now: () => t, random: () => 0.5 });
    const created = m.create('c1', identity('A'));
    assert.ok(created.ok);
    const code = created.ok ? created.room.code : '';
    t = ROOM_IDLE_EXPIRY_MS;
    const late = m.join('c2', code, identity('B'));
    assert.deepEqual(late.ok ? null : late.code, 'not_found');
    assert.equal(m.rooms.size, 0);
    assert.equal(m.roomOf('c1'), undefined);
  });
});
