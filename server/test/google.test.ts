/**
 * Google ID-token verification (src/auth/google.ts) with a locally generated RSA key standing in for
 * Google's JWKS: good token, wrong aud / iss, expired, future iat, bad signature, alg confusion, unknown
 * kid refetch (throttled), key-source failures, Cache-Control caching and the admin email check.
 */
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { before, describe, it } from 'node:test';
import { GoogleTokenVerifier, isAdminIdentity, parseJwks, parseMaxAge, type JwksDocument, type JwksSource } from '../src/auth/google';
import { generateTestKey, mintIdToken, signTestToken, testJwks, type TestSigningKey } from '../src/auth/testKeys';

const CLIENT_ID = 'local-test-client.example.com';
const T0 = 1_780_000_000_000;

let keyA: TestSigningKey;
let keyB: TestSigningKey;

before(() => {
  keyA = generateTestKey('kid-a');
  keyB = generateTestKey('kid-b');
});

/** A key source the test can swap and count. */
function switchableSource(initial: JwksDocument, maxAgeSec?: number): { source: JwksSource; set(doc: JwksDocument): void; calls(): number; fail(on: boolean): void } {
  let doc = initial;
  let calls = 0;
  let failing = false;
  return {
    source: async () => {
      calls += 1;
      if (failing) throw new Error('offline');
      return { jwks: doc, ...(maxAgeSec === undefined ? {} : { maxAgeSec }) };
    },
    set(next) {
      doc = next;
    },
    calls: () => calls,
    fail(on) {
      failing = on;
    },
  };
}

function setup(opts: { jwks?: JwksDocument; maxAgeSec?: number } = {}) {
  let now = T0;
  const src = switchableSource(opts.jwks ?? testJwks(keyA), opts.maxAgeSec);
  const verifier = new GoogleTokenVerifier({ clientId: CLIENT_ID, source: src.source, now: () => now });
  return {
    verifier,
    src,
    advance(ms: number) {
      now += ms;
    },
    now: () => now,
  };
}

const token = (key: TestSigningKey, extra: Record<string, unknown> = {}, nowMs = T0) =>
  mintIdToken(key, { aud: CLIENT_ID, email: 'owner@example.com', givenName: 'Anaye', nowMs }, extra);

describe('Google ID-token verification', () => {
  it('accepts a good token and returns only the claims the relay uses', async () => {
    const { verifier } = setup();
    const result = await verifier.verify(token(keyA));
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.deepEqual(result.claims, {
      sub: '100000000000000000001',
      email: 'owner@example.com',
      emailVerified: true,
      givenName: 'Anaye',
      exp: Math.floor(T0 / 1000) + 3600,
      iat: Math.floor(T0 / 1000),
    });
  });

  it('accepts both Google issuers and refuses any other', async () => {
    const { verifier } = setup();
    assert.equal((await verifier.verify(token(keyA, { iss: 'accounts.google.com' }))).ok, true);
    assert.equal((await verifier.verify(token(keyA, { iss: 'https://accounts.google.com' }))).ok, true);
    for (const iss of ['https://accounts.google.com/', 'http://accounts.google.com', 'https://evil.example.com', 42]) {
      assert.deepEqual(await verifier.verify(token(keyA, { iss })), { ok: false, reason: 'iss' }, String(iss));
    }
  });

  it('refuses a token issued to another client id (and audience lists)', async () => {
    const { verifier } = setup();
    assert.deepEqual(await verifier.verify(token(keyA, { aud: 'someone-else.example.com' })), { ok: false, reason: 'aud' });
    assert.deepEqual(await verifier.verify(token(keyA, { aud: [CLIENT_ID] })), { ok: false, reason: 'aud' });
    assert.deepEqual(await verifier.verify(token(keyA, { aud: `${CLIENT_ID} ` })), { ok: false, reason: 'aud' });
  });

  it('refuses an expired token, allowing 60 s of clock skew', async () => {
    const { verifier, advance } = setup();
    const t = token(keyA, { exp: Math.floor(T0 / 1000) + 10 });
    advance(69_000);
    assert.equal((await verifier.verify(t)).ok, true, 'within the skew');
    advance(2_000);
    assert.deepEqual(await verifier.verify(t), { ok: false, reason: 'expired' });
    assert.deepEqual(await verifier.verify(token(keyA, { exp: 'later' })), { ok: false, reason: 'expired' });
  });

  it('refuses a token issued in the future (beyond the skew)', async () => {
    const { verifier } = setup();
    const nowSec = Math.floor(T0 / 1000);
    assert.equal((await verifier.verify(token(keyA, { iat: nowSec + 50 }))).ok, true, 'within the skew');
    assert.deepEqual(await verifier.verify(token(keyA, { iat: nowSec + 120 })), { ok: false, reason: 'iat' });
    assert.deepEqual(await verifier.verify(token(keyA, { iat: undefined })), { ok: false, reason: 'iat' });
  });

  it('refuses a bad signature: tampered payload, another key under the same kid, truncated signature', async () => {
    const { verifier } = setup();
    const good = token(keyA);
    const [h, p, sig] = good.split('.') as [string, string, string];
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    const tampered = `${h}.${Buffer.from(JSON.stringify({ ...payload, email: 'intruder@example.com' })).toString('base64url')}.${sig}`;
    assert.deepEqual(await verifier.verify(tampered), { ok: false, reason: 'signature' });
    const impostor = { ...keyB, kid: 'kid-a' };
    assert.deepEqual(await verifier.verify(token(impostor)), { ok: false, reason: 'signature' });
    assert.deepEqual(await verifier.verify(`${h}.${p}.${sig.slice(0, 40)}`), { ok: false, reason: 'signature' });
  });

  it('refuses alg none, HS256 signed with the public key (key confusion) and other algorithms before any key lookup', async () => {
    const { verifier, src } = setup();
    const body = { iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: '1', iat: Math.floor(T0 / 1000), exp: Math.floor(T0 / 1000) + 600 };
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const none = `${b64({ alg: 'none', kid: 'kid-a' })}.${b64(body)}.`;
    assert.deepEqual(await verifier.verify(none), { ok: false, reason: 'malformed' }, 'empty signature segment');
    const noneSig = `${b64({ alg: 'none', kid: 'kid-a' })}.${b64(body)}.AAAA`;
    assert.deepEqual(await verifier.verify(noneSig), { ok: false, reason: 'alg' });
    const hsHead = b64({ alg: 'HS256', kid: 'kid-a' });
    const hmac = createHmac('sha256', JSON.stringify(keyA.publicJwk)).update(`${hsHead}.${b64(body)}`).digest('base64url');
    assert.deepEqual(await verifier.verify(`${hsHead}.${b64(body)}.${hmac}`), { ok: false, reason: 'alg' });
    assert.deepEqual(await verifier.verify(signTestToken(keyA, body, { alg: 'RS512' })), { ok: false, reason: 'alg' });
    assert.deepEqual(await verifier.verify(signTestToken(keyA, body, { kid: undefined })), { ok: false, reason: 'kid' });
    assert.equal(src.calls(), 0, 'no key fetch for tokens refused on their header');
  });

  it('refuses malformed input without throwing', async () => {
    const { verifier } = setup();
    for (const bad of [undefined, null, 42, '', 'a.b', 'a.b.c.d', 'a.b.c!', `${'a'.repeat(5000)}.b.c`, 'e30.e30.e30']) {
      const result = await verifier.verify(bad);
      assert.equal(result.ok, false, String(bad).slice(0, 20));
    }
    const notJson = `${Buffer.from('nope').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.AAAA`;
    assert.deepEqual(await verifier.verify(notJson), { ok: false, reason: 'malformed' });
  });

  it('refetches the key set for an unknown kid (Google rotated keys), at most once a minute', async () => {
    const { verifier, src, advance } = setup();
    assert.equal((await verifier.verify(token(keyA))).ok, true);
    assert.equal(src.calls(), 1);
    // Google starts signing with key B; the cache (fresh for an hour) does not have it yet.
    src.set(testJwks(keyA, keyB));
    advance(61_000);
    assert.equal((await verifier.verify(token(keyB, {}, T0 + 61_000))).ok, true, 'unknown kid → refetch → accepted');
    assert.equal(src.calls(), 2);
    // A forged kid refetches at most once per minute.
    const forged = { ...keyB, kid: 'kid-forged' };
    assert.deepEqual(await verifier.verify(token(forged, {}, T0 + 61_000)), { ok: false, reason: 'kid' });
    assert.deepEqual(await verifier.verify(token(forged, {}, T0 + 61_000)), { ok: false, reason: 'kid' });
    assert.equal(src.calls(), 2, 'throttled: no refetch within a minute of the last one');
    advance(61_000);
    assert.deepEqual(await verifier.verify(token(forged, {}, T0 + 122_000)), { ok: false, reason: 'kid' });
    assert.equal(src.calls(), 3);
  });

  it('caches the keys for the Cache-Control max-age, then refreshes', async () => {
    const { verifier, src, advance, now } = setup({ maxAgeSec: 600 });
    await verifier.verify(token(keyA));
    await verifier.verify(token(keyA));
    assert.equal(src.calls(), 1, 'cached');
    advance(601_000);
    assert.equal((await verifier.verify(token(keyA, {}, now()))).ok, true);
    assert.equal(src.calls(), 2, 'refreshed after max-age');
    assert.equal(parseMaxAge('public, max-age=19800, must-revalidate, no-transform'), 19800);
    assert.equal(parseMaxAge('no-cache'), undefined);
    assert.equal(parseMaxAge(null), undefined);
  });

  it('fails closed when the keys cannot be fetched, keeps stale keys through a short outage', async () => {
    const cold = setup();
    cold.src.fail(true);
    assert.deepEqual(await cold.verifier.verify(token(keyA)), { ok: false, reason: 'keys_unavailable' });
    assert.deepEqual(await cold.verifier.verify(token(keyA)), { ok: false, reason: 'keys_unavailable' });
    assert.equal(cold.src.calls(), 1, 'a failed fetch is not retried for every token');

    const warm = setup({ maxAgeSec: 60 });
    assert.equal((await warm.verifier.verify(token(keyA))).ok, true);
    warm.src.fail(true);
    warm.advance(61_000);
    assert.equal((await warm.verifier.verify(token(keyA, {}, warm.now()))).ok, true, 'stale keys still verify during an outage');
  });

  it('ignores unusable keys in the JWKS (wrong kty / alg / use, garbage) and refuses an empty set', async () => {
    const jwks: JwksDocument = {
      keys: [
        { kty: 'EC', kid: 'kid-a' },
        { ...keyA.publicJwk, alg: 'RS512' },
        { ...keyA.publicJwk, use: 'enc' },
        { kty: 'RSA', kid: 'kid-a', n: 'xx', e: 'AQAB' },
      ],
    };
    const { verifier } = setup({ jwks });
    assert.deepEqual(await verifier.verify(token(keyA)), { ok: false, reason: 'keys_unavailable' });
    assert.throws(() => parseJwks({ nope: true }));
    assert.equal(parseJwks({ keys: [1, null, { kty: 'RSA' }] }).keys.length, 1);
  });

  it('given_name is sanitized (markup and controls removed, ≤ 16 characters); absent = null', async () => {
    const { verifier } = setup();
    const r1 = await verifier.verify(mintIdToken(keyA, { aud: CLIENT_ID, nowMs: T0 }, { given_name: '<b>Anaye</b>\u202e the Great Racer' }));
    assert.ok(r1.ok);
    assert.equal(r1.claims.givenName, 'bAnaye/b the Gre');
    const r2 = await verifier.verify(mintIdToken(keyA, { aud: CLIENT_ID, nowMs: T0 }));
    assert.ok(r2.ok);
    assert.equal(r2.claims.givenName, null);
  });

  it('admin identity: verified email in the list (any case); email_verified false or another account is refused', async () => {
    const { verifier } = setup();
    const admins = ['owner@example.com'];
    assert.equal(isAdminIdentity(await verifier.verify(token(keyA, { email: 'Owner@Example.COM' })), admins), true);
    assert.equal(isAdminIdentity(await verifier.verify(token(keyA, { email_verified: false })), admins), false, 'email_verified false');
    assert.equal(isAdminIdentity(await verifier.verify(token(keyA, { email_verified: 'true' })), admins), false, 'only a boolean true counts');
    assert.equal(isAdminIdentity(await verifier.verify(token(keyA, { email: 'friend@example.com' })), admins), false);
    assert.equal(isAdminIdentity(await verifier.verify(token(keyA, { aud: 'other.example.com' })), admins), false);
    assert.equal(isAdminIdentity({ ok: false, reason: 'signature' }, admins), false);
  });
});
