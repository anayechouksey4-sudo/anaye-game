/**
 * The owner's admin API (/admin/api/): login (key-only and two-factor), the disabled state, every route,
 * bearer sessions (sliding expiry, 12 h cap, logout, restart), the per-IP and global login limits, CORS,
 * HTTPS behind the proxy, body limits and schemas, live stats and the audit log's privacy.
 */
import assert from 'node:assert/strict';
import { connect as netConnect } from 'node:net';
import { afterEach, before, describe, it } from 'node:test';
import { ANNOUNCE_MAX_TEXT, DEFAULT_CAR_PHYSICS, type RoomIdentity } from '../../shared/protocol';
import { ADMIN_LIMITS, ADMIN_PUBLIC_ORIGIN, clientIp } from '../src/admin';
import { GoogleTokenVerifier, staticJwksSource } from '../src/auth/google';
import { generateTestKey, mintIdToken, testJwks, type TestSigningKey } from '../src/auth/testKeys';
import { parseAdminEmails, resolveServerConfig } from '../src/config';
import type { RelayServer, RelayServerOptions } from '../src/relay';
import { authed, http, login } from './adminHelpers';
import { TestClient, connect, startRelay } from './helpers';

const KEY = 'test-only owner passphrase 0123456789';
const CLIENT_ID = 'local-test-client.example.com';
const OWNER = 'owner@example.com';
const MIN = 60_000;

let relay: RelayServer;
let clients: TestClient[] = [];
let fakeNow = 1_780_000_000_000;
let signingKey: TestSigningKey;

before(() => {
  signingKey = generateTestKey('admin-test-key');
});

afterEach(async () => {
  await Promise.all(clients.map((c) => c.close()));
  clients = [];
  await relay?.close();
});

function verifier(): GoogleTokenVerifier {
  return new GoogleTokenVerifier({ clientId: CLIENT_ID, source: staticJwksSource(testJwks(signingKey)) });
}

async function boot(options: RelayServerOptions = {}): Promise<RelayServer> {
  fakeNow = 1_780_000_000_000;
  relay = await startRelay({ now: () => fakeNow, ...options, admin: { key: KEY, trustProxy: true, ...(options.admin ?? {}) } });
  return relay;
}

async function sessionFor(r: RelayServer = relay, body: unknown = { key: KEY }): Promise<string> {
  const res = await login(r, body, '198.51.100.1');
  assert.equal(res.status, 200, res.text);
  return res.body.session as string;
}

async function game(query = 'game'): Promise<TestClient> {
  const c = await connect(relay, query);
  clients.push(c);
  return c;
}

const identity = (name: string, carId = 'hypercar'): RoomIdentity => ({ name, carId, look: null, plate: '', avatar: null });
const ownerToken = (extra: Record<string, unknown> = {}, email = OWNER) => mintIdToken(signingKey, { aud: CLIENT_ID, email, givenName: 'Owner' }, extra);

describe('admin login', () => {
  it('is disabled (503 admin not configured) without a key or with one shorter than 24 characters', async () => {
    for (const key of [null, '', 'x'.repeat(23)]) {
      await boot({ admin: { key } });
      const res = await login(relay, { key: key || 'anything at all here, long enough' });
      assert.equal(res.status, 503);
      assert.deepEqual(res.body, { error: 'admin not configured' });
      assert.equal(relay.admin.status().enabled, false);
      await relay.close();
    }
    await boot({ admin: { key: 'x'.repeat(24) } });
    assert.equal((await login(relay, { key: 'x'.repeat(24) })).status, 200, 'exactly 24 characters is enough');
  });

  it('key-only: a wrong key is 401 with no detail; the right key gives a session, expiry and a warning', async () => {
    await boot();
    const wrong = await login(relay, { key: `${KEY}!` });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, { error: 'unauthorized' });
    const ok = await login(relay, { key: KEY });
    assert.equal(ok.status, 200);
    assert.match(ok.body.session, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
    assert.equal(ok.body.mode, 'key-only');
    assert.equal(ok.body.expiresAt, fakeNow + 30 * MIN);
    assert.equal(ok.body.maxExpiresAt, fakeNow + 12 * 60 * MIN);
    assert.match(ok.body.warning, /key alone/);
    const again = await login(relay, { key: KEY });
    assert.notEqual(again.body.session, ok.body.session, 'every login gets a fresh session');
  });

  it('two-factor: needs a verified ADMIN_EMAILS Google token AND the key', async () => {
    await boot({ google: verifier(), admin: { emails: ['Owner@Example.com'] } });
    assert.equal(relay.admin.status().mode, 'two-factor');
    const cases: [string, unknown][] = [
      ['key alone', { key: KEY }],
      ['token alone (wrong key)', { key: 'not the key, but long enough...', idToken: ownerToken() }],
      ['another Google account', { key: KEY, idToken: ownerToken({}, 'friend@example.com') }],
      ['email_verified false', { key: KEY, idToken: ownerToken({ email_verified: false }) }],
      ['expired token', { key: KEY, idToken: ownerToken({ exp: Math.floor(Date.now() / 1000) - 3600 }) }],
      ['token for another client id', { key: KEY, idToken: mintIdToken(signingKey, { aud: 'other.example.com', email: OWNER }) }],
      ['token signed by another key', { key: KEY, idToken: mintIdToken(generateTestKey('admin-test-key'), { aud: CLIENT_ID, email: OWNER }) }],
      ['garbage token', { key: KEY, idToken: 'a.b.c' }],
    ];
    for (const [label, body] of cases) {
      const res = await login(relay, body, `192.0.2.${cases.findIndex((c) => c[0] === label) + 1}`);
      assert.equal(res.status, 401, label);
      assert.deepEqual(res.body, { error: 'unauthorized' }, label);
    }
    const ok = await login(relay, { key: KEY, idToken: ownerToken() }, '192.0.2.200');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.mode, 'two-factor');
    assert.equal(ok.body.warning, undefined);
  });

  it('with GOOGLE_CLIENT_ID but no ADMIN_EMAILS (or emails but no client id) it is key-only', async () => {
    await boot({ google: verifier() });
    assert.equal((await login(relay, { key: KEY })).body.mode, 'key-only');
    await relay.close();
    await boot({ admin: { emails: [OWNER] } });
    assert.equal((await login(relay, { key: KEY })).body.mode, 'key-only');
  });

  it('refuses malformed logins with 400 and counts them as failures', async () => {
    await boot();
    const ip = '203.0.113.77';
    const bodies: unknown[] = [{}, { key: 42 }, { key: KEY, extra: 1 }, { key: KEY, idToken: 7 }, [KEY]];
    for (const body of bodies) assert.equal((await login(relay, body, ip)).status, 400, JSON.stringify(body));
    assert.equal((await login(relay, { key: KEY }, ip)).status, 429, '5 failures from that IP');
  });

  it('login only takes POST', async () => {
    await boot();
    const res = await http(relay, '/admin/api/login');
    assert.equal(res.status, 405);
    assert.match(String(res.headers.allow), /POST/);
  });
});

describe('admin login limits', () => {
  it(`${ADMIN_LIMITS.ipFailures} failures per IP per 15 minutes, then 429 (even with the right key) for that IP only`, async () => {
    await boot();
    for (let i = 0; i < 5; i++) assert.equal((await login(relay, { key: 'wrong wrong wrong wrong wrong' }, '203.0.113.5')).status, 401);
    const blocked = await login(relay, { key: KEY }, '203.0.113.5');
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, 'too many attempts');
    assert.ok(blocked.body.retryAfterSec > 0 && blocked.body.retryAfterSec <= 900);
    assert.equal(blocked.headers['retry-after'], String(blocked.body.retryAfterSec));
    assert.equal((await login(relay, { key: KEY }, '203.0.113.6')).status, 200, 'another IP is not affected');
    fakeNow += 15 * MIN;
    assert.equal((await login(relay, { key: KEY }, '203.0.113.5')).status, 200, 'the window has passed');
  });

  it('the client IP is the LAST X-Forwarded-For entry behind the proxy (a spoofed first entry does not help)', async () => {
    await boot();
    for (let i = 0; i < 5; i++) await login(relay, { key: 'wrong wrong wrong wrong wrong' }, `10.0.0.${i}, 203.0.113.9`);
    assert.equal((await login(relay, { key: KEY }, '10.9.9.9, 203.0.113.9')).status, 429);
  });

  it('without TRUST_PROXY the socket address counts and X-Forwarded-For is ignored', async () => {
    await boot({ admin: { trustProxy: false } });
    for (let i = 0; i < 5; i++) await login(relay, { key: 'wrong wrong wrong wrong wrong' }, `203.0.113.${i}`);
    assert.equal((await login(relay, { key: KEY }, '203.0.113.99')).status, 429, 'all from 127.0.0.1');
    const fakeReq = (xff: string | undefined, remote: string) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } }) as never;
    assert.equal(clientIp(fakeReq('1.1.1.1, 2.2.2.2', '::ffff:10.0.0.1'), true), '2.2.2.2');
    assert.equal(clientIp(fakeReq('1.1.1.1, 2.2.2.2', '::ffff:10.0.0.1'), false), '10.0.0.1');
    assert.equal(clientIp(fakeReq(undefined, '10.0.0.1'), true), '10.0.0.1');
  });

  it(`${ADMIN_LIMITS.globalFailures} failures in an hour lock login for everyone for 30 minutes; the owner sees why afterwards`, async () => {
    await boot();
    const session = await sessionFor();
    for (let ip = 0; ip < 4; ip++) {
      for (let i = 0; i < 5; i++) assert.equal((await login(relay, { key: 'wrong wrong wrong wrong wrong' }, `198.18.0.${ip}`)).status, 401);
      fakeNow += 5 * MIN;
    }
    const locked = await login(relay, { key: KEY }, '198.18.1.1');
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error, 'admin locked');
    assert.ok(locked.body.retryAfterSec > 0 && locked.body.retryAfterSec <= 30 * 60);
    const stats = await authed(relay, session, 'stats');
    assert.equal(stats.status, 200, 'a session from before the lockout keeps working');
    assert.ok(stats.body.admin.lockedUntil > fakeNow);
    fakeNow += 30 * MIN;
    const after = await login(relay, { key: KEY }, '198.18.1.1');
    assert.equal(after.status, 200);
    assert.equal(after.body.lastLockout.failures, 20);
    assert.ok(after.body.lastLockout.until <= fakeNow);
    const audit = await authed(relay, after.body.session, 'audit');
    assert.ok(audit.body.entries.some((e: { action: string; detail: string }) => e.action === 'lockout' && /20 failed logins/.test(e.detail)));
  });

  it(`a concurrent burst from many addresses cannot run past ${ADMIN_LIMITS.globalFailures} while Google's keys are still loading`, async () => {
    // Two-factor with an empty key cache: every attempt waits on the (slow) key fetch between its check and its
    // result, so attempts still verifying must count toward the hourly cap.
    const slow = new GoogleTokenVerifier({
      clientId: CLIENT_ID,
      source: async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { jwks: testJwks(signingKey) };
      },
    });
    await boot({ google: slow, admin: { emails: [OWNER] } });
    const visitor = ownerToken({}, 'visitor@example.com');
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => login(relay, { key: 'wrong wrong wrong wrong wrong', idToken: visitor }, `198.19.${i >> 8}.${i & 255}`)),
    );
    const byStatus = results.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    assert.equal(byStatus[401], ADMIN_LIMITS.globalFailures, JSON.stringify(byStatus));
    assert.equal(byStatus[429], 50 - ADMIN_LIMITS.globalFailures, JSON.stringify(byStatus));
    const next = await login(relay, { key: KEY, idToken: ownerToken() }, '198.19.9.9');
    assert.equal(next.status, 429);
    assert.equal(next.body.error, 'admin locked');
    assert.ok(next.body.retryAfterSec > 60, 'the real 30-minute lockout, not the brief in-flight hold');
  });
});

describe('admin sessions', () => {
  it('every route needs a valid bearer session: missing, malformed or unknown → 401 with no detail', async () => {
    await boot();
    const routes: [string, string][] = [
      ['GET', 'stats'],
      ['GET', 'rooms'],
      ['GET', 'audit'],
      ['GET', 'settings'],
      ['POST', 'settings'],
      ['POST', 'logout'],
      ['POST', 'announce'],
      ['POST', 'announce/clear'],
      ['POST', 'rooms/BCDF/close'],
      ['POST', 'rooms/BCDF/remove'],
      ['GET', 'no-such-route'],
      ['GET', '../api/stats'],
      ['GET', 'x/../stats'],
    ];
    const bad = [undefined, 'Bearer', 'Bearer ', `Basic ${Buffer.from(`x:${KEY}`).toString('base64')}`, `Bearer ${'A'.repeat(43)}`, `Bearer ${KEY}`];
    for (const [method, path] of routes) {
      for (const header of bad) {
        const res = await http(relay, `/admin/api/${path}`, { method, headers: header === undefined ? {} : { Authorization: header } });
        assert.equal(res.status, 401, `${method} ${path} with ${header}`);
        assert.deepEqual(res.body, { error: 'unauthorized' });
      }
    }
  });

  it('a session slides 30 minutes from its last use, up to 12 hours', async () => {
    await boot();
    const start = fakeNow;
    const session = await sessionFor();
    fakeNow += 29 * MIN;
    const res = await authed(relay, session, 'stats');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-session-expires-at'], String(fakeNow + 30 * MIN));
    for (let t = 0; t < 23; t++) {
      fakeNow += 29 * MIN;
      if (fakeNow - start >= 12 * 60 * MIN) break;
      assert.equal((await authed(relay, session, 'stats')).status, 200, `still alive at ${(fakeNow - start) / MIN} min`);
    }
    fakeNow = start + 12 * 60 * MIN;
    assert.equal((await authed(relay, session, 'stats')).status, 401, 'never longer than 12 hours');

    const idle = await sessionFor();
    fakeNow += 30 * MIN;
    assert.equal((await authed(relay, idle, 'stats')).status, 401, '30 minutes idle');
  });

  it('logout revokes the session; a relay restart revokes all', async () => {
    await boot();
    const a = await sessionFor();
    const b = await sessionFor();
    assert.deepEqual((await authed(relay, a, 'logout', { method: 'POST' })).body, { ok: true });
    assert.equal((await authed(relay, a, 'stats')).status, 401, 'replay after logout');
    assert.equal((await authed(relay, b, 'stats')).status, 200);
    await relay.close();
    await boot();
    assert.equal((await authed(relay, b, 'stats')).status, 401, 'sessions live in memory only');
  });
});

describe('admin transport', () => {
  it(`CORS: Access-Control-Allow-Origin is exactly ${ADMIN_PUBLIC_ORIGIN}; other origins get 403; no credentials`, async () => {
    await boot({ admin: { production: true, requireHttps: false } });
    const pre = await http(relay, '/admin/api/login', { method: 'OPTIONS', headers: { Origin: ADMIN_PUBLIC_ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], ADMIN_PUBLIC_ORIGIN);
    assert.match(String(pre.headers['access-control-allow-methods']), /POST/);
    assert.match(String(pre.headers['access-control-allow-headers']), /Authorization/);
    assert.equal(pre.headers['access-control-allow-credentials'], undefined);
    const ok = await login(relay, { key: KEY }, '203.0.113.1', { Origin: ADMIN_PUBLIC_ORIGIN });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers['access-control-allow-origin'], ADMIN_PUBLIC_ORIGIN);
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.equal(ok.headers['set-cookie'], undefined);
    assert.match(String(ok.headers.vary), /Origin/);
    for (const origin of ['https://evil.example.com', `${ADMIN_PUBLIC_ORIGIN}.evil.example.com`, 'http://anayechouksey4-sudo.github.io', 'null', 'http://localhost:5173']) {
      const res = await login(relay, { key: KEY }, '203.0.113.2', { Origin: origin });
      assert.equal(res.status, 403, origin);
      assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
      const pf = await http(relay, '/admin/api/stats', { method: 'OPTIONS', headers: { Origin: origin } });
      assert.equal(pf.status, 403, `preflight ${origin}`);
    }
  });

  it('outside production, localhost origins are allowed too', async () => {
    await boot();
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:19610', 'http://[::1]:8080']) {
      const res = await login(relay, { key: KEY }, '203.0.113.3', { Origin: origin });
      assert.equal(res.status, 200, origin);
      assert.equal(res.headers['access-control-allow-origin'], origin);
    }
    assert.equal((await login(relay, { key: KEY }, '203.0.113.3', { Origin: 'http://localhost.evil.example.com' })).status, 403);
  });

  it('behind the proxy in production, plain http (X-Forwarded-Proto) is refused', async () => {
    await boot({ admin: { production: true } });
    assert.equal((await login(relay, { key: KEY }, '203.0.113.4', { 'X-Forwarded-Proto': 'http' })).status, 403);
    assert.equal((await login(relay, { key: KEY }, '203.0.113.4')).status, 403, 'header missing');
    assert.equal((await login(relay, { key: KEY }, '203.0.113.4', { 'X-Forwarded-Proto': 'https' })).status, 200);
  });

  it('malformed request targets get 400 and never stop the relay (HTTP and WebSocket upgrade)', async () => {
    await boot();
    const rawRequest = (head: string): Promise<string> =>
      new Promise((resolve) => {
        const socket = netConnect(relay.port, '127.0.0.1', () => socket.write(head));
        let out = '';
        socket.on('data', (d) => (out += d.toString()));
        socket.on('close', () => resolve(out.split('\r\n')[0] ?? ''));
        socket.on('error', () => resolve(out));
        setTimeout(() => socket.destroy(), 1000);
      });
    for (const target of ['http://[', 'http://%zz/admin/api/stats', 'http://[::1/admin/api/login']) {
      assert.match(await rawRequest(`GET ${target} HTTP/1.1\r\nHost: x\r\n\r\n`), /400/, target);
      const upgrade = `GET ${target} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`;
      assert.match(await rawRequest(upgrade), /400/, `upgrade ${target}`);
    }
    assert.equal((await http(relay, '/health')).status, 200, 'still serving');
    assert.equal((await login(relay, { key: KEY })).status, 200);
  });

  it('bodies over 8 KB get 413; schemas are strict (unknown keys, wrong types, non-JSON)', async () => {
    await boot();
    const big = await login(relay, { key: KEY, pad: 'x'.repeat(9000) });
    assert.equal(big.status, 413);
    assert.equal(big.body.limitBytes, 8192);
    const session = await sessionFor();
    assert.equal((await authed(relay, session, 'announce', { method: 'POST', body: { text: 'hi', minutes: 5, pad: 'x'.repeat(8200) } })).status, 413);
    assert.equal((await authed(relay, session, 'announce', { method: 'POST', body: { text: 'hi', minutes: 5, pad: 'x'.repeat(8000) } })).status, 400, 'under the limit: schema error');
    assert.equal((await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: 'no' } })).status, 400);
    assert.equal((await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: false, x: 1 } })).status, 400);
    assert.equal((await authed(relay, session, 'settings', { method: 'POST', body: '{"newRoomsAllowed": false', headers: { 'Content-Type': 'application/json' } })).status, 400);
    assert.equal((await authed(relay, session, 'settings', { method: 'POST', body: 'newRoomsAllowed=false', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await authed(relay, session, 'settings', { method: 'POST', body: [false] })).status, 400);
    assert.equal((await authed(relay, session, 'rooms/BCDF/close', { method: 'POST', body: { force: true } })).status, 400);
    assert.equal((await authed(relay, session, 'stats', { method: 'POST' })).status, 405);
    assert.equal((await authed(relay, session, 'nothing-here')).status, 404);
    assert.equal((await authed(relay, session, 'stats/')).status, 404);
  });
});

describe('admin routes', () => {
  it('GET stats: players online (game clients only), dashboards apart, rooms, races, maps, cars, countries, peaks', async () => {
    await boot({ google: verifier(), version: 'abc123def456' });
    const session = await sessionFor();
    const a = await game();
    const b = await game();
    const c = await game();
    const dash = await game('dashboard');
    clients.push(await connect(relay, 'observer'));
    a.send({ type: 'hello', role: 'game', tz: 'Asia/Kolkata', idToken: mintIdToken(signingKey, { aud: CLIENT_ID, givenName: 'Anaye' }) });
    b.send({ type: 'hello', role: 'game', tz: 'Asia/Calcutta' });
    c.send({ type: 'hello', role: 'game', tz: 'Etc/UTC' });
    for (const x of [a, b, c]) await x.sync();
    c.send({ type: 'game:state', physics: { ...DEFAULT_CAR_PHYSICS }, controls: null, carId: 'kart', trackId: 'ice' });
    a.send({ type: 'room:create', ...identity('Anaye', 'rally') });
    const joined = await a.take('room:joined');
    b.send({ type: 'room:join', code: joined.code, ...identity('Bee', 'buggy') });
    await b.take('room:joined');
    a.send({ type: 'room:race', phase: 'countdown', track: 'chaos', startAt: Date.now() + 4000, results: [] });
    await a.take('room:race');
    await c.sync();
    void dash;

    const stats = (await authed(relay, session, 'stats')).body;
    assert.deepEqual(stats.online, { players: 3, dashboards: 1, observers: 1, signedIn: 1 });
    assert.equal(stats.rooms.total, 1);
    assert.equal(stats.rooms.playersInRooms, 2);
    assert.equal(stats.rooms.racesRunning, 1);
    assert.deepEqual(stats.rooms.byPhase, { lobby: 0, countdown: 1, racing: 0, results: 0 });
    assert.deepEqual(stats.maps, [{ id: 'chaos', players: 2 }, { id: 'ice', players: 1 }]);
    assert.deepEqual(stats.cars, [{ id: 'buggy', players: 1 }, { id: 'kart', players: 1 }, { id: 'rally', players: 1 }]);
    assert.deepEqual(stats.countries, [{ code: 'IN', name: 'India', players: 2 }]);
    assert.equal(stats.countriesUnknown, 1);
    assert.equal(stats.peak.sinceStart, 3);
    assert.equal(stats.peak.today, 3);
    assert.equal(stats.sessions.sinceStart, 3, 'game sessions only');
    assert.equal(stats.races.finishedToday, 0);
    assert.equal(stats.version, 'abc123def456');
    assert.match(stats.note, /relay starts/);
    assert.match(stats.labels['online.players'], /offline mode is not counted/);
    assert.ok(stats.memory.rss > 0 && stats.uptimeSec >= 0);
    assert.equal(stats.admin.mode, 'key-only');

    a.send({ type: 'room:race', phase: 'racing', track: 'chaos', startAt: Date.now(), results: [] });
    a.send({ type: 'room:race', phase: 'results', track: 'chaos', startAt: Date.now(), results: [] });
    await a.take('room:race', (m) => m.phase === 'results');
    await b.close();
    const after = (await authed(relay, session, 'stats')).body;
    assert.equal(after.races.finishedToday, 1);
    assert.equal(after.online.players, 2);
    assert.equal(after.peak.sinceStart, 3, 'the peak stays');
    // A new UTC day resets the "today" numbers, not the "since start" ones.
    fakeNow += 24 * 60 * MIN;
    const tomorrow = (await authed(relay, await sessionFor(), 'stats')).body;
    assert.equal(tomorrow.races.finishedToday, 0);
    assert.equal(tomorrow.races.finishedSinceStart, 1);
    assert.equal(tomorrow.sessions.today, 0);
    assert.equal(tomorrow.peak.today, 2, 'today starts at the players online now');
  });

  it('GET rooms lists code, size, phase, map, age and members as {id, name, verified, givenName, country, car, host, away}', async () => {
    await boot({ google: verifier() });
    const session = await sessionFor();
    const a = await game();
    const b = await game();
    a.send({ type: 'room:create', ...identity('Anaye', 'rally'), size: 4, tz: 'Asia/Kolkata', idToken: mintIdToken(signingKey, { aud: CLIENT_ID, givenName: 'Anaye' }) });
    const joined = await a.take('room:joined');
    b.send({ type: 'room:join', code: joined.code, ...identity('Bee', 'kart'), tz: 'Europe/London' });
    await b.take('room:joined');
    const res = await authed(relay, session, 'rooms');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings, { newRoomsAllowed: true });
    assert.equal(res.body.rooms.length, 1);
    const room = res.body.rooms[0];
    assert.equal(room.code, joined.code);
    assert.equal(room.size, 4);
    assert.equal(room.players, 2);
    assert.equal(room.phase, 'lobby');
    assert.equal(room.map, null);
    assert.equal(room.signedInOnly, false);
    assert.ok(room.ageSec >= 0);
    assert.deepEqual(room.members, [
      { id: joined.you, name: 'Anaye', verified: true, givenName: 'Anaye', country: 'IN', car: 'rally', host: true, away: false },
      { id: b.welcome.clientId, name: 'Bee', verified: false, givenName: null, country: 'GB', car: 'kart', host: false, away: false },
    ]);
    assert.ok(!res.text.includes('@'), 'no email in the room list');
  });

  it('POST rooms/:code/close: every member gets room:left closed and the room is gone', async () => {
    await boot();
    const session = await sessionFor();
    const a = await game();
    const b = await game();
    a.send({ type: 'room:create', ...identity('Anaye'), token: 'token-aaaaaaaaaaaaaaaa' });
    const joined = await a.take('room:joined');
    b.send({ type: 'room:join', code: joined.code, ...identity('Bee') });
    await b.take('room:joined');
    const res = await authed(relay, session, `rooms/${joined.code}/close`, { method: 'POST' });
    assert.deepEqual(res.body, { ok: true, code: joined.code, members: 2 });
    assert.equal((await a.take('room:left')).reason, 'closed');
    assert.equal((await b.take('room:left')).reason, 'closed');
    assert.equal(relay.roomOf(a.welcome.clientId), undefined);
    assert.deepEqual((await authed(relay, session, 'rooms')).body.rooms, []);
    a.send({ type: 'room:join', code: joined.code, ...identity('Anaye'), token: 'token-aaaaaaaaaaaaaaaa' });
    assert.equal((await a.take('room:error')).code, 'not_found');
    assert.equal((await authed(relay, session, `rooms/${joined.code}/close`, { method: 'POST' })).status, 404);
    assert.equal((await authed(relay, session, 'rooms/AEIO/close', { method: 'POST' })).status, 404, 'not a room code');
    assert.equal((await authed(relay, session, 'rooms/bcdf/close', { method: 'POST' })).status, 404);
  });

  it("POST rooms/:code/remove: like the host's REMOVE ('removed' with a token, 'closed' without); no way back; the host role moves", async () => {
    await boot();
    const session = await sessionFor();
    const host = await game();
    const tokened = await game();
    const old = await game();
    host.send({ type: 'room:create', ...identity('Host'), token: 'token-hhhhhhhhhhhhhhhh' });
    const joined = await host.take('room:joined');
    tokened.send({ type: 'room:join', code: joined.code, ...identity('Tok'), token: 'token-tttttttttttttttt' });
    await tokened.take('room:joined');
    old.send({ type: 'room:join', code: joined.code, ...identity('Old') });
    await old.take('room:joined');

    const r1 = await authed(relay, session, `rooms/${joined.code}/remove`, { method: 'POST', body: { memberId: tokened.welcome.clientId } });
    assert.deepEqual(r1.body, { ok: true, code: joined.code, memberId: tokened.welcome.clientId, roomClosed: false });
    assert.equal((await tokened.take('room:left')).reason, 'removed');
    tokened.send({ type: 'room:join', code: joined.code, ...identity('Tok'), token: 'token-tttttttttttttttt' });
    assert.equal((await tokened.take('room:error')).code, 'removed');

    await authed(relay, session, `rooms/${joined.code}/remove`, { method: 'POST', body: { memberId: old.welcome.clientId } });
    assert.equal((await old.take('room:left')).reason, 'closed', 'an old (untokened) game gets a reason it knows');

    // The owner can remove the host too: the next present member takes over (here: nobody left → closed).
    const friend = await game();
    friend.send({ type: 'room:join', code: joined.code, ...identity('Friend'), token: 'token-ffffffffffffffff' });
    await friend.take('room:joined');
    await authed(relay, session, `rooms/${joined.code}/remove`, { method: 'POST', body: { memberId: joined.you } });
    assert.equal((await host.take('room:left')).reason, 'removed');
    const list = await friend.take('room:players', (m) => m.players.length === 1);
    assert.equal(list.players[0]!.isHost, true);
    const last = await authed(relay, session, `rooms/${joined.code}/remove`, { method: 'POST', body: { memberId: friend.welcome.clientId } });
    assert.equal(last.body.roomClosed, true);

    assert.equal((await authed(relay, session, `rooms/${joined.code}/remove`, { method: 'POST', body: { memberId: 'c1' } })).status, 404);
    host.send({ type: 'room:create', ...identity('Host') });
    const again = await host.take('room:joined');
    assert.equal((await authed(relay, session, `rooms/${again.code}/remove`, { method: 'POST', body: { memberId: 'c999' } })).body.error, 'no such player');
    assert.equal((await authed(relay, session, `rooms/${again.code}/remove`, { method: 'POST', body: { memberId: '../x' } })).status, 400);
    assert.equal((await authed(relay, session, `rooms/${again.code}/remove`, { method: 'POST', body: {} })).status, 400);
  });

  it('POST announce: every game gets server:announce (late joiners too), dashboards do not; clear hides it', async () => {
    await boot();
    const session = await sessionFor();
    const g = await game();
    const dash = await game('dashboard');
    const res = await authed(relay, session, 'announce', { method: 'POST', body: { text: 'Server\u0007 restart‮ at <b>6 pm</b> &amp; back soon', minutes: 10 } });
    assert.equal(res.status, 200);
    assert.equal(res.body.announce.text, 'Server restart at <b>6 pm</b> &amp; back soon', 'controls stripped, markup kept as plain text');
    assert.equal(res.body.announce.until, fakeNow + 10 * MIN);
    const frame = await g.take('server:announce');
    assert.deepEqual(frame, { v: 1, type: 'server:announce', id: res.body.announce.id, text: res.body.announce.text, until: fakeNow + 10 * MIN, serverNow: fakeNow });
    await dash.sync();
    assert.equal(dash.count('server:announce'), 0);
    const late = await game();
    assert.equal((await late.take('server:announce')).id, res.body.announce.id, 'a game connecting later sees the banner');
    const stats = (await authed(relay, session, 'stats')).body;
    assert.equal(stats.announce.id, res.body.announce.id);

    const cleared = await authed(relay, session, 'announce/clear', { method: 'POST' });
    assert.deepEqual(cleared.body, { ok: true, cleared: true });
    const hide = await g.take('server:announce', (m) => m.text === '');
    assert.equal(hide.id, res.body.announce.id);
    const later = await game();
    await later.sync();
    assert.equal(later.count('server:announce'), 0);
    assert.equal((await authed(relay, session, 'announce/clear', { method: 'POST' })).body.cleared, false);

    for (const body of [
      { text: '', minutes: 5 },
      { text: '\u0000\u0001 ', minutes: 5 },
      { text: 'x'.repeat(ANNOUNCE_MAX_TEXT + 1), minutes: 5 },
      { text: 'hi', minutes: 0 },
      { text: 'hi', minutes: 61 },
      { text: 'hi', minutes: 1.5 },
      { text: 'hi', minutes: '5' },
      { text: 42, minutes: 5 },
      { text: 'hi' },
    ]) {
      assert.equal((await authed(relay, session, 'announce', { method: 'POST', body })).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal((await authed(relay, session, 'announce', { method: 'POST', body: { text: 'x'.repeat(ANNOUNCE_MAX_TEXT), minutes: 60 } })).status, 200);
    // It expires on its own: a game connecting after `until` gets nothing.
    fakeNow += 61 * MIN;
    const afterExpiry = await game();
    await afterExpiry.sync();
    assert.equal(afterExpiry.count('server:announce'), 0);
  });

  it('POST settings newRoomsAllowed: false pauses room:create with a code old games know; joins keep working', async () => {
    await boot();
    const session = await sessionFor();
    const host = await game();
    const friend = await game();
    host.send({ type: 'room:create', ...identity('Host') });
    const joined = await host.take('room:joined');
    const res = await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: false } });
    assert.deepEqual(res.body, { ok: true, settings: { newRoomsAllowed: false } });
    assert.deepEqual((await authed(relay, session, 'settings')).body, { settings: { newRoomsAllowed: false } });
    friend.send({ type: 'room:create', ...identity('Friend'), token: 'token-ffffffffffffffff' });
    const err = await friend.take('room:error');
    assert.deepEqual([err.code, err.message], ['rooms_full', 'New rooms are paused by the owner']);
    friend.send({ type: 'room:join', code: joined.code, ...identity('Friend') });
    assert.equal((await friend.take('room:joined')).code, joined.code);
    await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: true } });
    friend.send({ type: 'room:leave' });
    await friend.take('room:left');
    friend.send({ type: 'room:create', ...identity('Friend') });
    assert.ok((await friend.take('room:joined')).code);
  });

  it('GET audit: newest first; never the key, a session, an ID token, an email or a raw IP', async () => {
    await boot({ google: verifier(), admin: { emails: [OWNER] } });
    const idToken = ownerToken();
    await login(relay, { key: KEY }, '203.0.113.250');
    await login(relay, { key: 'wrong wrong wrong wrong wrong', idToken }, '203.0.113.251');
    const ok = await login(relay, { key: KEY, idToken }, '203.0.113.252');
    const session = ok.body.session as string;
    const g = await game();
    g.send({ type: 'room:create', ...identity('Anaye') });
    const joined = await g.take('room:joined');
    await authed(relay, session, 'announce', { method: 'POST', body: { text: 'Hello racers', minutes: 5 } });
    await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: false } });
    await authed(relay, session, `rooms/${joined.code}/close`, { method: 'POST' });
    const res = await authed(relay, session, 'audit');
    const actions = res.body.entries.map((e: { action: string; ok: boolean }) => `${e.action}:${e.ok}`);
    assert.deepEqual(actions, ['close-room:true', 'settings:true', 'announce:true', 'login:true', 'login:false', 'login:false']);
    for (const e of res.body.entries) {
      assert.match(e.ipHash, /^[0-9a-f]{12}$/);
      assert.equal(typeof e.at, 'number');
    }
    for (const secret of [KEY, session, idToken, OWNER, 'owner@', '203.0.113.25', '127.0.0.1']) {
      assert.ok(!res.text.includes(secret), `audit must not contain ${secret.slice(0, 12)}…`);
    }
    // The same IP always hashes the same within a process (so the owner can spot repeats).
    const hashes = res.body.entries.filter((e: { action: string }) => e.action !== 'login').map((e: { ipHash: string }) => e.ipHash);
    assert.equal(new Set(hashes).size, 1);
    assert.ok(res.body.entries.length <= ADMIN_LIMITS.auditEntries);
  });

  it('the audit keeps the last 200 entries', async () => {
    await boot();
    const session = await sessionFor();
    for (let i = 0; i < 210; i++) await authed(relay, session, 'settings', { method: 'POST', body: { newRoomsAllowed: i % 2 === 0 } });
    const entries = (await authed(relay, session, 'audit')).body.entries;
    assert.equal(entries.length, 200);
    assert.equal(entries[0].action, 'settings');
  });
});

describe('environment', () => {
  it('reads the M6 variables; startup notes never contain a key or an address', () => {
    const env = {
      ADMIN_KEY: KEY,
      ADMIN_EMAILS: ' Owner@Example.com, second@example.com ,not-an-email',
      GOOGLE_CLIENT_ID: CLIENT_ID,
      TRUST_PROXY: '1',
      NODE_ENV: 'production',
      GOOGLE_JWKS_FILE: '/tmp/never-read.json',
      RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567',
    };
    const config = resolveServerConfig(env, { jwksSource: staticJwksSource({ keys: [] }) });
    assert.deepEqual(config.admin, { key: KEY, emails: ['owner@example.com', 'second@example.com'], trustProxy: true, production: true });
    assert.equal(config.google?.clientId, CLIENT_ID);
    assert.equal(config.version, '0123456789ab');
    const joined = config.notes.join('\n');
    assert.match(joined, /two-factor/);
    for (const secret of [KEY, 'owner@example.com', 'Owner@Example.com', 'second@example.com']) assert.ok(!joined.includes(secret));

    const prod = resolveServerConfig({ ...env, ADMIN_KEY: 'short' });
    assert.match(prod.notes.join('\n'), /GOOGLE_JWKS_FILE is ignored in production/);
    assert.match(prod.notes.join('\n'), /admin: off \(ADMIN_KEY is shorter than 24/);
    const bare = resolveServerConfig({});
    assert.equal(bare.google, null);
    assert.deepEqual(bare.admin, { key: null, emails: [], trustProxy: false, production: false });
    assert.equal(bare.version, 'unknown');
    assert.match(bare.notes.join('\n'), /admin: off \(ADMIN_KEY is not set\)/);
    assert.match(resolveServerConfig({ ADMIN_KEY: KEY }).notes.join('\n'), /key only/);
    assert.equal(resolveServerConfig({ GOOGLE_CLIENT_ID: 'bad id with spaces' }).google, null);
    assert.equal(resolveServerConfig({ RELAY_VERSION: 'v6<script>' }).version, 'unknown');
    assert.deepEqual(parseAdminEmails('A@example.com,a@example.com,,b@'), ['a@example.com']);
  });
});
