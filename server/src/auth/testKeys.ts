/**
 * A locally generated RSA key standing in for Google's, for tests, local relays and the headless sign-in
 * checks. Nothing here is used by a production relay: it only creates keys and signs tokens that a relay
 * accepts when it was started with the matching JWKS (GOOGLE_JWKS_FILE, honoured outside production only)
 * and the same GOOGLE_CLIENT_ID.
 *
 * Test identities must use made-up addresses on the reserved example.com domain.
 */
import { createPrivateKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import type { Jwk, JwksDocument } from './google';

export interface TestSigningKey {
  kid: string;
  privateKey: KeyObject;
  publicJwk: Jwk;
}

export function generateTestKey(kid = 'local-test-key-1'): TestSigningKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string };
  return { kid, privateKey, publicJwk: { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e } };
}

/** A key loaded from a PKCS#8 PEM written by `npm run test-google -- keys`. */
export function loadTestKey(pem: string, kid: string): TestSigningKey {
  const privateKey = createPrivateKey(pem);
  const jwk = privateKey.export({ format: 'jwk' }) as { n: string; e: string };
  return { kid, privateKey, publicJwk: { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e } };
}

export function testJwks(...keys: TestSigningKey[]): JwksDocument {
  return { keys: keys.map((k) => ({ ...k.publicJwk })) };
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Signs `payload` with RS256 under `key` (header overrides allow forging bad tokens in tests). */
export function signTestToken(key: TestSigningKey, payload: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const head = b64({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = b64(payload);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

export interface TestIdentity {
  /** OAuth client id the token is issued to (`aud`). */
  aud: string;
  /** Made-up address on example.com. */
  email?: string;
  emailVerified?: boolean;
  givenName?: string;
  sub?: string;
  /** Token lifetime from `nowMs`, seconds. Default 3600 (like Google's). */
  ttlSec?: number;
  nowMs?: number;
  iss?: string;
}

/** A Google-shaped ID token for `identity`, signed by `key`. */
export function mintIdToken(key: TestSigningKey, identity: TestIdentity, extra: Record<string, unknown> = {}): string {
  const now = Math.floor((identity.nowMs ?? Date.now()) / 1000);
  const payload: Record<string, unknown> = {
    iss: identity.iss ?? 'https://accounts.google.com',
    azp: identity.aud,
    aud: identity.aud,
    sub: identity.sub ?? '100000000000000000001',
    email: identity.email ?? 'player@example.com',
    email_verified: identity.emailVerified ?? true,
    iat: now,
    exp: now + (identity.ttlSec ?? 3600),
    ...extra,
  };
  if (identity.givenName !== undefined) {
    payload.given_name = identity.givenName;
    payload.name = identity.givenName;
  }
  return signTestToken(key, payload);
}
