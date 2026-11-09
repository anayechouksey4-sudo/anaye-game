/**
 * Google ID-token verification with Node's own crypto (no dependency).
 *
 * A token is accepted only when ALL of these hold:
 *   - compact JWT shape, ≤ MAX_ID_TOKEN_LENGTH, header `alg` exactly 'RS256' and a `kid`
 *     ('none', HS256 and every other algorithm are refused before any key is looked at);
 *   - the RS256 signature verifies against the key with that `kid` in Google's published JWKS
 *     (https://www.googleapis.com/oauth2/v3/certs), cached for the response's Cache-Control max-age and
 *     refetched when a token names a kid the cache does not have (at most once per `minRefetchMs`);
 *   - `iss` is 'accounts.google.com' or 'https://accounts.google.com';
 *   - `aud` equals the configured client id (a string; an audience list is refused);
 *   - `exp` is in the future and `iat` is not, both with `skewSec` (60 s) of tolerance;
 *   - `sub` is a non-empty string.
 * The verifier returns the few claims the relay uses; callers decide what to keep (the relay keeps only
 * the sanitized given name; the admin check reads `email` / `emailVerified` and then forgets them).
 *
 * The key source is injectable: tests (and local relays, see GOOGLE_JWKS_FILE) use a locally generated RSA
 * key in place of Google's.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { MAX_ID_TOKEN_LENGTH, sanitizeRoomName } from '../../../shared/protocol';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const GOOGLE_ISSUERS: readonly string[] = ['accounts.google.com', 'https://accounts.google.com'];

/** One JSON Web Key as Google publishes it (RSA). */
export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface JwksDocument {
  keys: Jwk[];
}

/** What a key source returns: the key set and how long it may be cached (from Cache-Control). */
export interface JwksFetchResult {
  jwks: JwksDocument;
  maxAgeSec?: number;
}

export type JwksSource = () => Promise<JwksFetchResult>;

export interface GoogleClaims {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  /** `given_name`, sanitized like a room name (≤ ROOM_MAX_NAME); null when absent or empty. */
  givenName: string | null;
  exp: number;
  iat: number;
}

export type VerifyFailure =
  | 'malformed'
  | 'alg'
  | 'kid'
  | 'signature'
  | 'iss'
  | 'aud'
  | 'expired'
  | 'iat'
  | 'claims'
  | 'keys_unavailable';

export type VerifyResult = { ok: true; claims: GoogleClaims } | { ok: false; reason: VerifyFailure };

export interface GoogleVerifierOptions {
  /** The OAuth client id tokens must be issued to (`aud`). */
  clientId: string;
  /** Where the keys come from (default: Google's JWKS over HTTPS). */
  source?: JwksSource;
  /** Wall clock in ms (tests move it). */
  now?: () => number;
  /** Clock tolerance for exp / iat, seconds. Default 60. */
  skewSec?: number;
  /** An unknown kid refetches the key set at most this often. Default 60 s. */
  minRefetchMs?: number;
  /** Cache lifetime when the source gives none. Default 1 h. */
  defaultMaxAgeSec?: number;
}

const DEFAULT_SKEW_SEC = 60;
const DEFAULT_MIN_REFETCH_MS = 60_000;
const DEFAULT_MAX_AGE_SEC = 3600;
/** Cache-Control max-age is clamped into this range (seconds). */
const MIN_MAX_AGE_SEC = 60;
const MAX_MAX_AGE_SEC = 24 * 3600;
const FETCH_TIMEOUT_MS = 5000;
const MAX_JWKS_BYTES = 64 * 1024;
const MAX_KEYS = 16;
const MIN_RSA_BITS = 2048;
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** `max-age=N` from a Cache-Control header, or undefined. */
export function parseMaxAge(cacheControl: string | null | undefined): number | undefined {
  if (!cacheControl) return undefined;
  const match = /(?:^|[,\s])max-age\s*=\s*(\d{1,9})(?:$|[,\s])/i.exec(cacheControl);
  return match ? Number(match[1]) : undefined;
}

/** Google's JWKS over HTTPS (Node's fetch), with the response's Cache-Control max-age. */
export function httpJwksSource(url: string = GOOGLE_JWKS_URL): JwksSource {
  return async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`JWKS fetch answered ${res.status}`);
    const text = await res.text();
    if (text.length > MAX_JWKS_BYTES) throw new Error('JWKS response too large');
    return { jwks: parseJwks(JSON.parse(text)), maxAgeSec: parseMaxAge(res.headers.get('cache-control')) };
  };
}

/** A JWKS file on disk (local relays and tests standing in for Google). Read on every refresh. */
export function fileJwksSource(path: string): JwksSource {
  return async () => ({ jwks: parseJwks(JSON.parse(await readFile(path, 'utf8'))), maxAgeSec: 300 });
}

/** A fixed key set (tests). */
export function staticJwksSource(jwks: JwksDocument, maxAgeSec?: number): JwksSource {
  return async () => ({ jwks, ...(maxAgeSec === undefined ? {} : { maxAgeSec }) });
}

export function parseJwks(input: unknown): JwksDocument {
  if (typeof input !== 'object' || input === null || !Array.isArray((input as { keys?: unknown }).keys)) throw new Error('not a JWKS document');
  const keys = ((input as { keys: unknown[] }).keys).filter(
    (k): k is Jwk => typeof k === 'object' && k !== null && typeof (k as Jwk).kty === 'string',
  );
  return { keys: keys.slice(0, MAX_KEYS) };
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class GoogleTokenVerifier {
  readonly clientId: string;
  private readonly source: JwksSource;
  private readonly now: () => number;
  private readonly skewMs: number;
  private readonly minRefetchMs: number;
  private readonly defaultMaxAgeSec: number;
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private lastFetchAt = -Infinity;
  private lastFetchFailed = false;
  private inflight: Promise<boolean> | null = null;
  /** Diagnostics (tests): how many times the key source was called. */
  fetches = 0;

  constructor(options: GoogleVerifierOptions) {
    if (!options.clientId) throw new Error('GoogleTokenVerifier needs a client id');
    this.clientId = options.clientId;
    this.source = options.source ?? httpJwksSource();
    this.now = options.now ?? Date.now;
    this.skewMs = (options.skewSec ?? DEFAULT_SKEW_SEC) * 1000;
    this.minRefetchMs = options.minRefetchMs ?? DEFAULT_MIN_REFETCH_MS;
    this.defaultMaxAgeSec = options.defaultMaxAgeSec ?? DEFAULT_MAX_AGE_SEC;
  }

  async verify(token: unknown): Promise<VerifyResult> {
    if (typeof token !== 'string' || token.length > MAX_ID_TOKEN_LENGTH) return { ok: false, reason: 'malformed' };
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((p) => SEGMENT.test(p))) return { ok: false, reason: 'malformed' };
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = decodeJsonSegment(headerPart);
    const payload = decodeJsonSegment(payloadPart);
    if (!header || !payload) return { ok: false, reason: 'malformed' };
    if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
    if (typeof header.kid !== 'string' || header.kid.length === 0 || header.kid.length > 128) return { ok: false, reason: 'kid' };

    const key = await this.keyFor(header.kid);
    if (key === 'unavailable') return { ok: false, reason: 'keys_unavailable' };
    if (!key) return { ok: false, reason: 'kid' };

    const signature = Buffer.from(signaturePart, 'base64url');
    let valid = false;
    try {
      valid = cryptoVerify('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, signature);
    } catch {
      valid = false;
    }
    if (!valid) return { ok: false, reason: 'signature' };

    if (typeof payload.iss !== 'string' || !GOOGLE_ISSUERS.includes(payload.iss)) return { ok: false, reason: 'iss' };
    if (typeof payload.aud !== 'string' || payload.aud !== this.clientId) return { ok: false, reason: 'aud' };
    const now = this.now();
    const { exp, iat, sub } = payload;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= now - this.skewMs) return { ok: false, reason: 'expired' };
    if (typeof iat !== 'number' || !Number.isFinite(iat) || iat * 1000 > now + this.skewMs) return { ok: false, reason: 'iat' };
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) return { ok: false, reason: 'claims' };

    const email = typeof payload.email === 'string' && payload.email.length <= 320 ? payload.email : null;
    const givenName = typeof payload.given_name === 'string' ? sanitizeRoomName(payload.given_name) || null : null;
    return { ok: true, claims: { sub, email, emailVerified: payload.email_verified === true, givenName, exp, iat } };
  }

  /** The key for `kid`: from the cache, after a refresh when the cache is stale or lacks it. */
  private async keyFor(kid: string): Promise<KeyObject | null | 'unavailable'> {
    const now = this.now();
    const stale = now >= this.expiresAt;
    const throttled = now - this.lastFetchAt < this.minRefetchMs;
    // A stale cache refreshes (unless a refresh just failed); a fresh cache that lacks the token's kid
    // refetches too, because Google rotates keys, but throttled so forged kids cannot make the relay
    // hammer the key endpoint.
    if (stale ? !(this.lastFetchFailed && throttled) : !this.keys.has(kid) && !throttled) await this.refresh();
    if (this.keys.size === 0) return 'unavailable';
    return this.keys.get(kid) ?? null;
  }

  /** One refresh at a time; a failed refresh keeps the previous keys (if any) and retries after minRefetchMs. */
  private refresh(): Promise<boolean> {
    this.inflight ??= (async () => {
      this.fetches += 1;
      this.lastFetchAt = this.now();
      try {
        const { jwks, maxAgeSec } = await this.source();
        const keys = new Map<string, KeyObject>();
        for (const jwk of jwks.keys) {
          if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' || typeof jwk.n !== 'string' || typeof jwk.e !== 'string') continue;
          if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
          if (jwk.use !== undefined && jwk.use !== 'sig') continue;
          try {
            const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
            // Google's keys are 2048-bit; a short modulus is never accepted.
            if ((key.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_RSA_BITS) keys.set(jwk.kid, key);
          } catch {
            // Skip a malformed key; the others still count.
          }
        }
        if (keys.size === 0) throw new Error('no usable RSA keys');
        const age = Math.min(MAX_MAX_AGE_SEC, Math.max(MIN_MAX_AGE_SEC, maxAgeSec ?? this.defaultMaxAgeSec));
        this.keys = keys;
        this.expiresAt = this.now() + age * 1000;
        this.lastFetchFailed = false;
        return true;
      } catch {
        // Keep stale keys (better than refusing every sign-in during a short outage); retry after minRefetchMs.
        this.lastFetchFailed = true;
        return false;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }
}

/**
 * The admin's Google factor: a verified token whose verified email is in `adminEmails`
 * (compared case-insensitively). The email is read here and not kept anywhere.
 */
export function isAdminIdentity(result: VerifyResult, adminEmails: readonly string[]): boolean {
  if (!result.ok || !result.claims.emailVerified || result.claims.email === null) return false;
  const email = result.claims.email.trim().toLowerCase();
  return adminEmails.includes(email);
}
