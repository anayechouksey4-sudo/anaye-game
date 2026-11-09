/**
 * Milestone 6 on the wire: tz / idToken on hello and room frames, verified / givenName / country on room
 * members, SIGNED-IN PLAYERS ONLY rooms (room:create signedInOnly, room:settings), sign_in_required only for
 * games that know it, frame order kept while a token verifies, and old (milestone 5) games seeing exactly
 * the frames, codes and reasons they already understand.
 */
import assert from 'node:assert/strict';
import { afterEach, before, describe, it } from 'node:test';
import {
  COUNTRY_NAMES,
  TIME_ZONE_COUNTRY,
  countryFromTimeZone,
  parseMessage,
  sanitizeAnnounceText,
  sanitizeIdToken,
  sanitizeTimeZone,
  type RoomIdentity,
  type RoomPose,
} from '../../shared/protocol';
import { GoogleTokenVerifier, staticJwksSource } from '../src/auth/google';
import { generateTestKey, mintIdToken, testJwks, type TestSigningKey } from '../src/auth/testKeys';
import type { RelayServer, RelayServerOptions } from '../src/relay';
import { TestClient, connect, startRelay } from './helpers';

const CLIENT_ID = 'local-test-client.example.com';
/** Room error codes and leave reasons the milestone 5 game (38538b9) parses; anything else it drops. */
const M5_ERROR_CODES = ['bad_code', 'not_found', 'full', 'rooms_full', 'already_in_room', 'not_in_room', 'not_host', 'bad_state', 'removed'];
const M5_LEFT_REASONS = ['left', 'expired', 'closed', 'removed', 'replaced'];

let relay: RelayServer;
let clients: TestClient[] = [];
let key: TestSigningKey;

before(() => {
  key = generateTestKey('signin-test-key');
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay?.close();
});

async function boot(options: RelayServerOptions = {}): Promise<void> {
  relay = await startRelay({ google: new GoogleTokenVerifier({ clientId: CLIENT_ID, source: staticJwksSource(testJwks(key)) }), ...options });
}

async function game(): Promise<TestClient> {
  const c = await connect(relay, 'game');
  clients.push(c);
  return c;
}

const identity = (name: string, carId = 'hypercar'): RoomIdentity => ({ name, carId, look: null, plate: '', avatar: null });
const idToken = (givenName = 'Anaye', extra: Record<string, unknown> = {}) => mintIdToken(key, { aud: CLIENT_ID, givenName, email: 'player@example.com' }, extra);
const pose = (t: number): Omit<RoomPose, 'id'> => ({ t, p: [1, 0.5, -2], q: [0, 0, 0, 1], s: 60, st: 0.1, g: 1, pm: 120 });

describe('sign-in protocol helpers', () => {
  it('maps time zones to countries (India both spellings, the common zones), unknown → null', () => {
    assert.equal(countryFromTimeZone('Asia/Kolkata'), 'IN');
    assert.equal(countryFromTimeZone('Asia/Calcutta'), 'IN');
    for (const [tz, cc] of Object.entries({
      'America/New_York': 'US', 'America/Los_Angeles': 'US', 'America/Chicago': 'US', 'Europe/London': 'GB', 'Europe/Berlin': 'DE',
      'Europe/Paris': 'FR', 'Asia/Dubai': 'AE', 'Asia/Singapore': 'SG', 'Asia/Tokyo': 'JP', 'Australia/Sydney': 'AU',
      'America/Sao_Paulo': 'BR', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Shanghai': 'CN', 'Africa/Lagos': 'NG',
    })) assert.equal(countryFromTimeZone(tz), cc, tz);
    for (const unknown of ['UTC', 'Etc/UTC', 'Etc/GMT+5', 'Mars/Olympus', '', 'asia/kolkata', '../../etc', 42, null, 'A'.repeat(65)]) {
      assert.equal(countryFromTimeZone(unknown), null, String(unknown));
    }
    assert.equal(countryFromTimeZone('toString'), null, 'no prototype keys');
    assert.ok(Object.keys(TIME_ZONE_COUNTRY).length >= 31);
    for (const cc of new Set(Object.values(TIME_ZONE_COUNTRY))) assert.ok(COUNTRY_NAMES[cc], `name for ${cc}`);
  });

  it('sanitizes tz, idToken and announce text', () => {
    assert.equal(sanitizeTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
    assert.equal(sanitizeTimeZone('Etc/GMT+5'), 'Etc/GMT+5');
    assert.equal(sanitizeTimeZone('Asia/Kolkata<script>'), null);
    assert.equal(sanitizeIdToken('aaa.bbb.ccc'), 'aaa.bbb.ccc');
    assert.equal(sanitizeIdToken('aaa.bbb'), null);
    assert.equal(sanitizeIdToken(`${'a'.repeat(4096)}.b.c`), null);
    assert.equal(sanitizeAnnounceText('  Hello\u0000​  racers‮\n<i>!</i> '), 'Hello racers <i>!</i>');
    assert.equal(sanitizeAnnounceText('x'.repeat(121)), null);
    assert.equal(sanitizeAnnounceText(''), '');
    assert.equal(sanitizeAnnounceText(5), null);
  });

  it('parses the new fields and frames; a malformed idToken counts as signed out', () => {
    const hello = parseMessage({ type: 'hello', role: 'game', tz: 'Asia/Kolkata', idToken: 'not a jwt' });
    assert.deepEqual(hello, { v: 1, type: 'hello', role: 'game', tz: 'Asia/Kolkata', idToken: null });
    const join = parseMessage({ type: 'room:join', code: 'BCDF', ...identity('A'), idToken: 'a.b.c', tz: 'bad zone!' });
    assert.deepEqual(join, { v: 1, type: 'room:join', code: 'BCDF', ...identity('A'), idToken: 'a.b.c' });
    assert.deepEqual(parseMessage({ type: 'room:settings', signedInOnly: true }), { v: 1, type: 'room:settings', signedInOnly: true });
    assert.equal(parseMessage({ type: 'room:settings', signedInOnly: 'yes' }), null);
    const players = parseMessage({ type: 'room:players', players: [{ id: 'c1', ...identity('A'), ready: false, isHost: true, ping: null, verified: true, givenName: '<b>Al</b>', country: 'IN' }], signedInOnly: true });
    assert.deepEqual(players, { v: 1, type: 'room:players', players: [{ id: 'c1', ...identity('A'), ready: false, isHost: true, ping: null, verified: true, givenName: 'bAl/b', country: 'IN' }], signedInOnly: true });
    const forged = parseMessage({ type: 'room:players', players: [{ id: 'c1', ...identity('A'), ready: false, isHost: true, ping: null, verified: 'yes', givenName: 'X', country: 'india' }] });
    assert.deepEqual(forged, { v: 1, type: 'room:players', players: [{ id: 'c1', ...identity('A'), ready: false, isHost: true, ping: null }] });
    assert.deepEqual(parseMessage({ type: 'server:announce', id: 'abc', text: 'Hi\u0007 there', until: 5, serverNow: 1 }), { v: 1, type: 'server:announce', id: 'abc', text: 'Hi there', until: 5, serverNow: 1 });
    assert.equal(parseMessage({ type: 'server:announce', id: 'a b', text: 'x', until: 5, serverNow: 1 }), null);
    assert.equal(parseMessage({ type: 'server:announce', id: 'a', text: 'x'.repeat(200), until: 5, serverNow: 1 }), null);
  });
});

describe('sign-in on the relay', () => {
  it('welcome says whether the relay verifies Google tokens', async () => {
    await boot();
    assert.equal((await game()).welcome.signIn, true);
    await relay.close();
    await boot({ google: null });
    assert.equal((await game()).welcome.signIn, false);
  });

  it('room members show verified + given name + country; an unsigned player only the country; an old game nothing new', async () => {
    await boot();
    const a = await game();
    const b = await game();
    const old = await game();
    a.send({ type: 'room:create', ...identity('Anaye'), tz: 'Asia/Kolkata', idToken: idToken('Anaye') });
    const joined = await a.take('room:joined');
    assert.deepEqual(joined.players[0], { id: joined.you, ...identity('Anaye'), ready: false, isHost: true, ping: null, verified: true, givenName: 'Anaye', country: 'IN' });
    b.send({ type: 'room:join', code: joined.code, ...identity('Bee'), tz: 'America/New_York' });
    await b.take('room:joined');
    old.send({ type: 'room:join', code: joined.code, ...identity('Old') });
    const oldJoined = await old.take('room:joined');
    assert.deepEqual(oldJoined.players[1], { id: b.welcome.clientId, ...identity('Bee'), ready: false, isHost: false, ping: null, country: 'US' });
    assert.deepEqual(oldJoined.players[2], { id: old.welcome.clientId, ...identity('Old'), ready: false, isHost: false, ping: null }, 'exactly the milestone 5 shape');
    assert.ok(!old.raw.some((f) => f.includes('player@example.com') || f.includes('eyJ')), 'no email or token is ever relayed');
  });

  it('the idToken can come once on hello; null signs out; the room sees the badge change', async () => {
    await boot();
    const a = await game();
    const b = await game();
    a.send({ type: 'hello', role: 'game', idToken: idToken('Anaye'), tz: 'Europe/London' });
    await a.take('server:welcome');
    a.send({ type: 'room:create', ...identity('Anaye') });
    const joined = await a.take('room:joined');
    assert.equal(joined.players[0]!.verified, true);
    assert.equal(joined.players[0]!.country, 'GB');
    b.send({ type: 'room:join', code: joined.code, ...identity('Bee') });
    await b.take('room:joined');
    a.send({ type: 'room:update', ...identity('Anaye'), idToken: null });
    const list = await b.take('room:players', (m) => m.players[0]!.verified === undefined);
    assert.equal(list.players[0]!.givenName, undefined);
    assert.equal(list.players[0]!.country, 'GB', 'the country stays');
    a.send({ type: 'room:update', ...identity('Anaye'), idToken: idToken('Ana') });
    const back = await b.take('room:players', (m) => m.players[0]!.verified === true);
    assert.equal(back.players[0]!.givenName, 'Ana');
  });

  it('refuses expired, forged and wrong-audience tokens (not verified)', async () => {
    await boot();
    const bad = [
      idToken('A', { exp: Math.floor(Date.now() / 1000) - 600 }),
      mintIdToken(generateTestKey('signin-test-key'), { aud: CLIENT_ID, givenName: 'A' }),
      mintIdToken(key, { aud: 'other.example.com', givenName: 'A' }),
      'a.b.c',
    ];
    for (const token of bad) {
      const c = await game();
      c.send({ type: 'room:create', ...identity('X'), idToken: token });
      const joined = await c.take('room:joined');
      assert.equal(joined.players[0]!.verified, undefined);
      c.send({ type: 'room:leave' });
      await c.take('room:left');
    }
  });

  it('without GOOGLE_CLIENT_ID nobody is verified and SIGNED-IN PLAYERS ONLY is refused', async () => {
    await boot({ google: null });
    const a = await game();
    a.send({ type: 'room:create', ...identity('Anaye'), idToken: idToken() });
    const joined = await a.take('room:joined');
    assert.equal(joined.players[0]!.verified, undefined);
    a.send({ type: 'room:settings', signedInOnly: true });
    const err = await a.take('room:error');
    assert.equal(err.code, 'bad_state');
    assert.match(err.message, /not set up/);
    a.send({ type: 'room:leave' });
    await a.take('room:left');
    a.send({ type: 'room:create', ...identity('Anaye'), signedInOnly: true });
    assert.equal((await a.take('room:error')).code, 'bad_state');
  });

  it('keeps frame order while a token verifies (join, then ready and poses right behind it)', async () => {
    await boot();
    const host = await game();
    host.send({ type: 'room:create', ...identity('Host') });
    const joined = await host.take('room:joined');
    const c = await game();
    c.send({ type: 'room:join', code: joined.code, ...identity('Fast'), idToken: idToken('Fast') });
    c.send({ type: 'room:ready', ready: true });
    for (let i = 0; i < 3; i++) c.send({ type: 'room:pose', ...pose(100 + i * 70) });
    await c.sync();
    assert.equal(c.count('room:error'), 0, 'nothing ran before the join');
    const list = await host.take('room:players', (m) => m.players.some((p) => p.name === 'Fast' && p.ready));
    assert.equal(list.players[1]!.verified, true);
    assert.ok((await host.take('room:pose')).id);
  });
});

describe('SIGNED-IN PLAYERS ONLY rooms', () => {
  it('a verified host creates one; verified players join; others get sign_in_required (aware) or bad_state (old game)', async () => {
    await boot();
    const host = await game();
    host.send({ type: 'room:create', ...identity('Host'), signedInOnly: true, idToken: idToken('Host'), size: 4 });
    const joined = await host.take('room:joined');
    assert.equal(joined.signedInOnly, true);

    const aware = await game();
    aware.send({ type: 'room:join', code: joined.code, ...identity('Aware'), tz: 'Asia/Kolkata' });
    const e1 = await aware.take('room:error');
    assert.equal(e1.code, 'sign_in_required');
    assert.match(e1.message, /sign in with Google/);

    const old = await game();
    old.send({ type: 'room:join', code: joined.code, ...identity('Old') });
    const e2 = await old.take('room:error');
    assert.equal(e2.code, 'bad_state');
    assert.ok(M5_ERROR_CODES.includes(e2.code));
    assert.match(e2.message, /SIGNED-IN PLAYERS ONLY/);
    assert.ok(old.raw.every((f) => !f.includes('sign_in_required')), 'the old game never sees the new code');

    const signed = await game();
    signed.send({ type: 'room:join', code: joined.code, ...identity('Signed'), idToken: idToken('Signed') });
    const ok = await signed.take('room:joined');
    assert.equal(ok.signedInOnly, true);
    assert.equal(ok.players[1]!.verified, true);
    assert.equal((await host.take('room:players')).signedInOnly, true);
  });

  it('an unverified host cannot create one (sign_in_required), nor switch it on', async () => {
    await boot();
    const host = await game();
    host.send({ type: 'room:create', ...identity('Host'), signedInOnly: true });
    assert.equal((await host.take('room:error')).code, 'sign_in_required', 'signedInOnly marks the game as aware');
    host.send({ type: 'room:create', ...identity('Host') });
    await host.take('room:joined');
    host.send({ type: 'room:settings', signedInOnly: true });
    assert.equal((await host.take('room:error')).code, 'sign_in_required');
  });

  it('room:settings: host only; on/off reaches everyone; members admitted before stay; a seat restore is let in', async () => {
    await boot();
    const host = await game();
    const friend = await game();
    host.send({ type: 'room:create', ...identity('Host'), idToken: idToken('Host'), token: 'token-hhhhhhhhhhhhhhhh' });
    const joined = await host.take('room:joined');
    assert.equal(joined.signedInOnly, undefined);
    friend.send({ type: 'room:join', code: joined.code, ...identity('Friend'), token: 'token-ffffffffffffffff' });
    await friend.take('room:joined');
    friend.send({ type: 'room:settings', signedInOnly: true });
    assert.equal((await friend.take('room:error')).code, 'not_host');
    host.send({ type: 'room:settings', signedInOnly: true });
    assert.equal((await friend.take('room:players', (m) => m.signedInOnly === true)).players.length, 2, 'the unverified friend stays');
    // The friend's phone drops and comes back with the same device token: the seat is theirs.
    await friend.close();
    const back = await game();
    back.send({ type: 'room:join', code: joined.code, ...identity('Friend'), token: 'token-ffffffffffffffff' });
    const restored = await back.take('room:joined');
    assert.equal(restored.restored, true);
    // A newcomer without sign-in is refused.
    const newcomer = await game();
    newcomer.send({ type: 'room:join', code: joined.code, ...identity('New'), tz: 'Europe/Paris' });
    assert.equal((await newcomer.take('room:error')).code, 'sign_in_required');
    host.send({ type: 'room:settings', signedInOnly: false });
    assert.equal((await back.take('room:players', (m) => m.signedInOnly === undefined)).players.length, 2);
    newcomer.send({ type: 'room:join', code: joined.code, ...identity('New') });
    assert.equal((await newcomer.take('room:joined')).signedInOnly, undefined);
  });
});

describe('old games against the milestone 6 relay', () => {
  it('only codes and reasons the milestone 5 parser knows reach a game that sent no milestone 6 field', async () => {
    await boot();
    const old = await game();
    const host = await game();
    host.send({ type: 'room:create', ...identity('Host'), idToken: idToken('Host'), signedInOnly: true });
    const joined = await host.take('room:joined');
    old.send({ type: 'room:join', code: joined.code, ...identity('Old') });
    await old.take('room:error');
    old.send({ type: 'room:create', ...identity('Old') });
    await old.take('room:joined');
    await old.sync();
    for (const frame of old.raw.map((f) => JSON.parse(f) as { type: string; code?: string; reason?: string })) {
      if (frame.type === 'room:error') assert.ok(M5_ERROR_CODES.includes(frame.code!), frame.code);
      if (frame.type === 'room:left') assert.ok(M5_LEFT_REASONS.includes(frame.reason!), frame.reason);
    }
  });
});
