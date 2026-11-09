/**
 * Google sign-in, time zone and the owner's announcement on the device (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/signin.test.ts
 *
 * - the ID token is read for display only (exp, given_name; never the email) and kept in memory only:
 *   localStorage holds just "signed in last time"
 * - what goes on the wire: tz on hello and on every room frame; the token once per socket (and again on
 *   room:create / room:join), never once it is about to run out; null once after SIGN OUT
 * - the announcement shows once per id, hides at the relay's `until` (from serverNow, not the device
 *   clock), hides at once on text '', and keeps markup characters as plain text
 * - the ✓ badge text for the FRIENDS list and the name tags
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
}
const localStorage = new MemoryStorage();
Object.assign(globalThis, { localStorage });

const { readIdToken, isTokenFresh, TOKEN_SEND_MARGIN_MS } = await import('../src/auth/idToken');
const auth = await import('../src/auth/authStore');
const wire = await import('../src/auth/wire');
const announce = await import('../src/hud/announce');
const { displayName, nameTagLabel, verifiedLabel } = await import('../src/auth/badge');

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
/** A JWT-shaped string (not signed: the device never checks signatures, the relay does). */
function fakeToken(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'RS256', kid: 'test' }))}.${b64url(JSON.stringify(claims))}.${b64url('signature')}`;
}
const NOW = 1_800_000_000_000;
const exp = (msFromNow: number) => Math.floor((NOW + msFromNow) / 1000);

test('readIdToken: exp and a cleaned given_name, nothing else; malformed tokens are refused', () => {
  const info = readIdToken(fakeToken({ exp: exp(3_600_000), given_name: 'Zoë', email: 'owner@example.com', sub: '123' }));
  assert.deepEqual(info, { expiresAt: exp(3_600_000) * 1000, givenName: 'Zoë' });
  assert.equal(JSON.stringify(info).includes('example.com'), false);
  assert.equal(readIdToken(fakeToken({ exp: exp(1000), given_name: 'Bartholomew-Alexander the Third' }))!.givenName, 'Bartholomew-Alex');
  assert.equal(readIdToken(fakeToken({ exp: exp(1000) }))!.givenName, null);
  assert.equal(readIdToken(fakeToken({ given_name: 'No Exp' })), null);
  assert.equal(readIdToken('not-a-token'), null);
  assert.equal(readIdToken('a.b.c'), null);
  assert.equal(readIdToken(`${b64url('{}')}.${b64url('[1,2]')}.${b64url('x')}`), null);
  assert.equal(readIdToken(42), null);
  assert.equal(isTokenFresh({ expiresAt: NOW + TOKEN_SEND_MARGIN_MS + 1 }, NOW), true);
  assert.equal(isTokenFresh({ expiresAt: NOW + TOKEN_SEND_MARGIN_MS }, NOW), false);
});

test('a credential lives in memory only; localStorage keeps just "signed in last time"', () => {
  auth.resetAuthForTests();
  localStorage.clear();
  const token = fakeToken({ exp: exp(3_600_000), given_name: 'Ana', email: 'player@example.com' });
  assert.equal(auth.acceptCredential(token, NOW), true);
  assert.equal(auth.authState().status, 'signed-in');
  assert.equal(auth.authState().givenName, 'Ana');
  assert.equal(auth.currentIdToken(NOW), token);
  // The store (devtools-visible) never holds the token; storage holds only the flag.
  assert.equal(JSON.stringify(auth.authState()).includes(token.split('.')[1]!), false);
  assert.deepEqual(localStorage.keys(), [auth.REMEMBER_KEY]);
  assert.equal(localStorage.getItem(auth.REMEMBER_KEY), '1');
  assert.equal(auth.rememberedSignIn(), true);
  // Near its expiry the token is no longer handed out.
  assert.equal(auth.currentIdToken(NOW + 3_600_000 - TOKEN_SEND_MARGIN_MS), null);
  auth.signOut();
  assert.equal(auth.authState().status, 'signed-out');
  assert.equal(auth.currentIdToken(NOW), null);
  assert.equal(auth.rememberedSignIn(), false);
  assert.deepEqual(localStorage.keys(), []);
});

test('refresh falls due TOKEN_REFRESH_LEAD_MS before expiry (and stays due once expired); never while signed out', () => {
  auth.resetAuthForTests();
  assert.equal(auth.refreshDue(NOW), false);
  auth.acceptCredential(fakeToken({ exp: exp(3_600_000), given_name: 'Ana' }), NOW);
  assert.equal(auth.refreshDue(NOW), false);
  assert.equal(auth.refreshDue(NOW + 3_600_000 - 5 * 60_000), true);
  auth.expireToken();
  assert.equal(auth.refreshDue(NOW), true);
  auth.signOut();
  assert.equal(auth.refreshDue(NOW), false);
});

test('an already-expired or malformed credential is refused and changes nothing', () => {
  auth.resetAuthForTests();
  assert.equal(auth.acceptCredential(fakeToken({ exp: exp(-10_000), given_name: 'Old' }), NOW), false);
  assert.equal(auth.acceptCredential('garbage', NOW), false);
  assert.equal(auth.authState().status, 'signed-out');
  assert.ok(auth.authState().error);
  assert.equal(auth.currentIdToken(NOW), null);
});

test('wire: tz on hello and every room frame; the token once per socket, again on create/join, null once after SIGN OUT', () => {
  auth.resetAuthForTests();
  wire.resetWireForTests();
  const tz = wire.deviceTimeZone();
  assert.ok(tz && /^[A-Za-z]/.test(tz), `device time zone: ${tz}`);
  // Signed out: hello carries only tz; nothing to tell.
  assert.deepEqual(wire.helloAuthFields(NOW), { tz });
  assert.equal(wire.authChangePending(NOW), false);
  assert.deepEqual(wire.roomAuthFields({}, NOW), { tz });

  const token = fakeToken({ exp: exp(3_600_000), given_name: 'Ana' });
  auth.acceptCredential(token, NOW);
  assert.equal(wire.authChangePending(NOW), true);
  assert.deepEqual(wire.roomAuthFields({}, NOW), { tz, idToken: token });
  assert.equal(wire.authChangePending(NOW), false);
  // The socket already has it: an identity update does not repeat it…
  assert.deepEqual(wire.roomAuthFields({}, NOW), { tz });
  // …but room:create / room:join do (the relay checks it right there).
  assert.deepEqual(wire.roomAuthFields({ force: true }, NOW), { tz, idToken: token });

  // A silent refresh: a new token, but the socket is already signed in — nothing pending.
  const refreshed = fakeToken({ exp: exp(7_200_000), given_name: 'Ana' });
  auth.acceptCredential(refreshed, NOW + 1000);
  assert.equal(wire.authChangePending(NOW + 1000), false);
  assert.deepEqual(wire.roomAuthFields({ force: true }, NOW + 1000), { tz, idToken: refreshed });

  // A new socket: hello carries the token, so nothing is pending after it.
  assert.deepEqual(wire.helloAuthFields(NOW + 2000), { tz, idToken: refreshed });
  assert.equal(wire.authChangePending(NOW + 2000), false);

  // SIGN OUT: null exactly once.
  auth.signOut();
  assert.equal(wire.authChangePending(NOW), true);
  assert.deepEqual(wire.roomAuthFields({}, NOW), { tz, idToken: null });
  assert.deepEqual(wire.roomAuthFields({}, NOW), { tz });
  assert.deepEqual(wire.roomAuthFields({ force: true }, NOW), { tz });
  assert.equal(wire.authChangePending(NOW), false);
});

test('wire: a token that ran out is never sent (it would sign the socket out); the relay keeps its verdict', () => {
  auth.resetAuthForTests();
  wire.resetWireForTests();
  const tz = wire.deviceTimeZone();
  const token = fakeToken({ exp: exp(3_600_000), given_name: 'Ana' });
  auth.acceptCredential(token, NOW);
  wire.helloAuthFields(NOW);
  auth.expireToken();
  assert.equal(auth.authState().status, 'expired');
  const late = NOW + 3_600_000;
  assert.equal(wire.authChangePending(late), false);
  assert.deepEqual(wire.roomAuthFields({ force: true }, late), { tz });
  assert.deepEqual(wire.helloAuthFields(late), { tz });
});

test('announce: once per id, hidden at until (relay clock), cleared by text "", markup kept as text', () => {
  announce.resetAnnounceForTests();
  localStorage.clear();
  const serverNow = 5_000_000_000_000; // the relay's clock: far from this device's on purpose
  const text = '<b>Relay restarts</b> in 5 min & more <img src=x onerror=alert(1)>';
  announce.receiveAnnounce({ id: 'a1', text, until: serverNow + 120_000, serverNow }, 1000);
  const shown = announce.useAnnounce.getState().current;
  assert.ok(shown);
  assert.equal(shown.text, text);
  assert.equal(shown.endsAt, 1000 + 120_000);
  announce.tickAnnounce(1000 + 119_000);
  assert.ok(announce.useAnnounce.getState().current, 'still up before until');
  announce.tickAnnounce(1000 + 120_000);
  assert.equal(announce.useAnnounce.getState().current, null, 'gone at until');

  // Re-sent after a welcome: shows again until closed; once closed (✕) it never comes back for that id.
  announce.receiveAnnounce({ id: 'a2', text: 'Hello racers', until: serverNow + 60_000, serverNow }, 0);
  announce.receiveAnnounce({ id: 'a2', text: 'Hello racers', until: serverNow + 60_000, serverNow: serverNow + 10_000 }, 10_000);
  assert.equal(announce.useAnnounce.getState().current?.id, 'a2');
  announce.dismissAnnounce();
  assert.equal(announce.useAnnounce.getState().current, null);
  announce.receiveAnnounce({ id: 'a2', text: 'Hello racers', until: serverNow + 60_000, serverNow: serverNow + 20_000 }, 20_000);
  assert.equal(announce.useAnnounce.getState().current, null, 'closed id stays closed');
  assert.deepEqual(JSON.parse(localStorage.getItem(announce.ANNOUNCE_CLOSED_KEY)!), ['a2']);

  // A new id shows; text '' hides it at once.
  announce.receiveAnnounce({ id: 'a3', text: 'Second', until: serverNow + 60_000, serverNow }, 0);
  assert.equal(announce.useAnnounce.getState().current?.text, 'Second');
  announce.receiveAnnounce({ id: 'a3', text: '', until: serverNow, serverNow }, 5);
  assert.equal(announce.useAnnounce.getState().current, null);

  // Already over, or absurdly long: ignored / capped at the relay's 60 minutes.
  announce.receiveAnnounce({ id: 'a4', text: 'Late', until: serverNow - 1, serverNow }, 0);
  assert.equal(announce.useAnnounce.getState().current, null);
  announce.receiveAnnounce({ id: 'a5', text: 'Long', until: serverNow + 10 * 3_600_000, serverNow }, 0);
  assert.ok(announce.useAnnounce.getState().current!.endsAt <= 60 * 60_000 + 5_000);
  announce.resetAnnounceForTests();
});

test('badge: ✓ + first name in the list; name tags add it to the room name', () => {
  assert.equal(verifiedLabel({}), null);
  assert.equal(verifiedLabel({ verified: true, givenName: 'Ana' }), '✓ Ana');
  assert.equal(verifiedLabel({ verified: true }), '✓ SIGNED IN');
  assert.equal(nameTagLabel({ name: 'SPEEDY' }), 'SPEEDY');
  assert.equal(nameTagLabel({ name: 'SPEEDY', verified: true, givenName: 'Ana' }), 'SPEEDY ✓ Ana');
  assert.equal(nameTagLabel({ name: 'ANA', verified: true, givenName: 'Ana' }), '✓ ANA');
  assert.equal(nameTagLabel({ name: 'SPEEDY', verified: true }), 'SPEEDY ✓');
  // A typed name cannot fake it: check-mark look-alikes are dropped, only `verified` from the relay adds ✓.
  assert.equal(nameTagLabel({ name: '✓ Ana' }), 'Ana');
  assert.equal(nameTagLabel({ name: 'Ana ✔☑✅√🗸' }), 'Ana');
  assert.equal(displayName('✓'), '?');
  assert.equal(verifiedLabel({ givenName: 'Ana' }), null);
});
