/**
 * The owner's admin API under /admin/api/ (milestone 6).
 *
 * Authentication
 *   - ADMIN_KEY (≥ ADMIN_KEY_MIN_LENGTH characters) is required; missing or shorter = admin disabled
 *     (login answers 503 'admin not configured' after the same work as any other attempt).
 *   - With a Google verifier (GOOGLE_CLIENT_ID) AND at least one ADMIN_EMAILS address, login needs BOTH a
 *     valid Google ID token whose verified email is listed AND the key ('two-factor'). Otherwise the key
 *     alone works ('key-only', reported with a warning).
 *   - The key is compared in constant time over SHA-256 digests of both sides (crypto.timingSafeEqual).
 *   - Failed logins: 5 per client IP per 15 minutes, then 429 for that IP; 20 in total per hour lock
 *     login for everyone for 30 minutes (the next successful login reports the lockout).
 *   - A login returns an opaque session (32 random bytes, base64url), valid 30 minutes after its last use
 *     and 12 hours at most; held in memory only (logout or a relay restart revokes it). Every other route
 *     needs `Authorization: Bearer <session>`; anything else is 401 {error: 'unauthorized'}.
 *
 * Transport
 *   - CORS: Access-Control-Allow-Origin is exactly the console's origin (ADMIN_PUBLIC_ORIGIN), plus
 *     http://localhost / 127.0.0.1 / [::1] on any port when not in production; another Origin gets 403. No
 *     cookies, no credentials mode. Every response: Cache-Control no-store, nosniff, no-referrer.
 *   - With TRUST_PROXY in production, X-Forwarded-Proto must be https (the platform's TLS edge).
 *   - JSON bodies ≤ 8 KB (413 beyond), strict schemas (unknown keys are 400).
 *
 * Privacy: the audit log (last 200 entries, memory only) keeps time, action, success, a detail and a
 * salted hash of the client IP (the salt is random per process); never the IP, the key, a token or an email.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ANNOUNCE_MAX_MINUTES, ANNOUNCE_MAX_TEXT, ANNOUNCE_MIN_MINUTES, MAX_ID_TOKEN_LENGTH, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, sanitizeAnnounceText } from '../../shared/protocol';
import { isAdminIdentity, type GoogleTokenVerifier, type VerifyResult } from './auth/google';

export const ADMIN_KEY_MIN_LENGTH = 24;
/** The admin console is served from the game's public site. */
export const ADMIN_PUBLIC_ORIGIN = 'https://anayechouksey4-sudo.github.io';
export const ADMIN_API_PREFIX = '/admin/api/';

export const ADMIN_LIMITS = {
  bodyBytes: 8 * 1024,
  ipFailures: 5,
  ipWindowMs: 15 * 60_000,
  globalFailures: 20,
  globalWindowMs: 60 * 60_000,
  lockoutMs: 30 * 60_000,
  sessionIdleMs: 30 * 60_000,
  sessionMaxMs: 12 * 60 * 60_000,
  maxSessions: 16,
  auditEntries: 200,
  /** Distinct client IPs whose failures are remembered (oldest forgotten first). */
  trackedIps: 5000,
  bodyTimeoutMs: 10_000,
} as const;

export type AdminMode = 'two-factor' | 'key-only';

export interface AdminOptions {
  /** ADMIN_KEY. Missing or shorter than ADMIN_KEY_MIN_LENGTH = admin disabled. */
  key?: string | null;
  /** ADMIN_EMAILS, any case (compared lower-cased). */
  emails?: readonly string[];
  /** TRUST_PROXY=1: the client IP is the LAST X-Forwarded-For entry (the platform's proxy appends it). */
  trustProxy?: boolean;
  /** NODE_ENV=production: localhost origins are refused. */
  production?: boolean;
  /** Require X-Forwarded-Proto https. Default: trustProxy && production. */
  requireHttps?: boolean;
  /** The console's origin. Default ADMIN_PUBLIC_ORIGIN. */
  origin?: string;
}

/** What the relay lets the admin API see and do. */
export interface AdminActions {
  stats(): Record<string, unknown>;
  rooms(): AdminRoomView[];
  closeRoom(code: string): { members: number } | null;
  removeMember(code: string, memberId: string): { name: string; closed: boolean } | 'no_room' | 'no_member';
  announce(text: string, minutes: number): AnnounceView;
  clearAnnounce(): AnnounceView | null;
  settings(): AdminSettings;
  setSettings(settings: AdminSettings): void;
}

export interface AdminSettings {
  newRoomsAllowed: boolean;
}

export interface AnnounceView {
  id: string;
  text: string;
  until: number;
}

export interface AdminMemberView {
  id: string;
  name: string;
  verified: boolean;
  givenName: string | null;
  country: string | null;
  car: string;
  host: boolean;
  away: boolean;
}

export interface AdminRoomView {
  code: string;
  size: number;
  players: number;
  phase: string;
  map: string | null;
  ageSec: number;
  signedInOnly: boolean;
  members: AdminMemberView[];
}

export interface AuditEntry {
  at: number;
  action: string;
  ok: boolean;
  ipHash: string;
  detail?: string;
}

export interface LockoutInfo {
  at: number;
  until: number;
  failures: number;
}

export interface AdminStatus {
  enabled: boolean;
  mode: AdminMode;
  warning: string | null;
  sessions: number;
  lockedUntil: number | null;
  lastLockout: LockoutInfo | null;
  failedLoginsLastHour: number;
  blockedAttempts: number;
}

export interface AdminApi {
  /** Handles one request under ADMIN_API_PREFIX (always answers). */
  handle(req: IncomingMessage, res: ServerResponse): void;
  status(): AdminStatus;
}

const KEY_ONLY_WARNING = 'Google sign-in is not configured (GOOGLE_CLIENT_ID and ADMIN_EMAILS): admin uses the key alone.';
const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const MEMBER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BEARER_RE = /^Bearer ([A-Za-z0-9_-]{43})$/;
const LOCAL_ORIGIN_RE = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

const sha256 = (text: string): Buffer => createHash('sha256').update(text, 'utf8').digest();

/** The client's address: the LAST X-Forwarded-For entry behind a trusted proxy, else the socket's. */
export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers['x-forwarded-for'];
    const raw = Array.isArray(header) ? header.join(',') : header;
    if (raw) {
      const last = raw.split(',').map((s) => s.trim()).filter(Boolean).at(-1);
      if (last) return normalizeIp(last);
    }
  }
  return normalizeIp(req.socket.remoteAddress ?? 'unknown');
}

function normalizeIp(ip: string): string {
  return ip.replace(/^::ffff:/, '').slice(0, 64);
}

function lastHeaderValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value.join(',') : value;
  return raw?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).at(-1);
}

/** Failed-login windows per IP hash and in total, with pending attempts counted while they verify. */
class LoginLimiter {
  private readonly perIp = new Map<string, { failures: number[]; pending: number }>();
  private global: number[] = [];
  private globalPending = 0;
  lockedUntil = 0;
  lastLockout: LockoutInfo | null = null;
  blocked = 0;

  /** null when allowed; else why not and for how long. */
  check(ip: string, now: number): { kind: 'locked' | 'ip'; retryAfterSec: number } | null {
    if (now < this.lockedUntil) return { kind: 'locked', retryAfterSec: Math.ceil((this.lockedUntil - now) / 1000) };
    // Attempts still verifying count too, so a concurrent burst (from many addresses) cannot run past the
    // hourly cap before the lockout engages.
    if (this.failuresLastHour(now) + this.globalPending >= ADMIN_LIMITS.globalFailures) return { kind: 'locked', retryAfterSec: 1 };
    const entry = this.prune(ip, now);
    if (entry && entry.failures.length + entry.pending >= ADMIN_LIMITS.ipFailures) {
      const oldest = entry.failures[0] ?? now;
      return { kind: 'ip', retryAfterSec: Math.max(1, Math.ceil((oldest + ADMIN_LIMITS.ipWindowMs - now) / 1000)) };
    }
    return null;
  }

  reserve(ip: string, now: number): void {
    let entry = this.prune(ip, now);
    if (!entry) {
      entry = { failures: [], pending: 0 };
      this.perIp.set(ip, entry);
      while (this.perIp.size > ADMIN_LIMITS.trackedIps) {
        const oldest = this.perIp.keys().next().value;
        if (oldest === undefined) break;
        this.perIp.delete(oldest);
      }
    }
    entry.pending += 1;
    this.globalPending += 1;
  }

  /** Ends a reserved attempt. Returns the lockout it started, if any. */
  settle(ip: string, now: number, failed: boolean): LockoutInfo | null {
    const entry = this.perIp.get(ip);
    if (entry) entry.pending = Math.max(0, entry.pending - 1);
    this.globalPending = Math.max(0, this.globalPending - 1);
    if (!failed) {
      this.perIp.delete(ip);
      return null;
    }
    if (entry) entry.failures.push(now);
    this.global = this.global.filter((t) => now - t < ADMIN_LIMITS.globalWindowMs);
    this.global.push(now);
    if (this.global.length >= ADMIN_LIMITS.globalFailures && now >= this.lockedUntil) {
      this.lockedUntil = now + ADMIN_LIMITS.lockoutMs;
      this.lastLockout = { at: now, until: this.lockedUntil, failures: this.global.length };
      this.global = [];
      return this.lastLockout;
    }
    return null;
  }

  failuresLastHour(now: number): number {
    return this.global.filter((t) => now - t < ADMIN_LIMITS.globalWindowMs).length;
  }

  private prune(ip: string, now: number): { failures: number[]; pending: number } | undefined {
    const entry = this.perIp.get(ip);
    if (!entry) return undefined;
    entry.failures = entry.failures.filter((t) => now - t < ADMIN_LIMITS.ipWindowMs);
    if (entry.failures.length === 0 && entry.pending === 0) {
      this.perIp.delete(ip);
      return undefined;
    }
    return entry;
  }
}

interface Session {
  createdAt: number;
  lastUsedAt: number;
  mode: AdminMode;
}

/** Sessions keyed by the SHA-256 of the token (the token itself is never stored). */
class SessionStore {
  private readonly byHash = new Map<string, Session>();

  create(now: number, mode: AdminMode): { session: string; expiresAt: number; maxExpiresAt: number } {
    const session = randomBytes(32).toString('base64url');
    this.prune(now);
    this.byHash.set(sha256(session).toString('hex'), { createdAt: now, lastUsedAt: now, mode });
    while (this.byHash.size > ADMIN_LIMITS.maxSessions) {
      const oldest = this.byHash.keys().next().value;
      if (oldest === undefined) break;
      this.byHash.delete(oldest);
    }
    return { session, expiresAt: now + ADMIN_LIMITS.sessionIdleMs, maxExpiresAt: now + ADMIN_LIMITS.sessionMaxMs };
  }

  /** Validates and slides a session; null when unknown or expired (an expired one is dropped). */
  touch(token: string, now: number): { expiresAt: number } | null {
    const hash = sha256(token).toString('hex');
    const s = this.byHash.get(hash);
    if (!s) return null;
    if (now - s.lastUsedAt >= ADMIN_LIMITS.sessionIdleMs || now - s.createdAt >= ADMIN_LIMITS.sessionMaxMs) {
      this.byHash.delete(hash);
      return null;
    }
    s.lastUsedAt = now;
    return { expiresAt: Math.min(now + ADMIN_LIMITS.sessionIdleMs, s.createdAt + ADMIN_LIMITS.sessionMaxMs) };
  }

  revoke(token: string): void {
    this.byHash.delete(sha256(token).toString('hex'));
  }

  count(now: number): number {
    this.prune(now);
    return this.byHash.size;
  }

  private prune(now: number): void {
    for (const [hash, s] of this.byHash) {
      if (now - s.lastUsedAt >= ADMIN_LIMITS.sessionIdleMs || now - s.createdAt >= ADMIN_LIMITS.sessionMaxMs) this.byHash.delete(hash);
    }
  }
}

type BodyResult = { status: 'ok'; text: string } | { status: 'too_large' } | { status: 'aborted' };

function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length']);
    let done = false;
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (result: BodyResult): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (result.status === 'too_large') {
        // Drain (and drop) what is still coming so the 413 reaches the client; give up on a flood.
        let drained = 0;
        req.removeAllListeners('data');
        req.on('data', (chunk: Buffer) => {
          drained += chunk.length;
          if (drained > 1024 * 1024) req.destroy();
        });
        req.resume();
      }
      resolve(result);
    };
    const timer = setTimeout(() => {
      finish({ status: 'aborted' });
      req.destroy();
    }, ADMIN_LIMITS.bodyTimeoutMs);
    if (Number.isFinite(declared) && declared > limit) {
      finish({ status: 'too_large' });
      return;
    }
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        finish({ status: 'too_large' });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish({ status: 'ok', text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', () => finish({ status: 'aborted' }));
    req.on('close', () => finish({ status: 'aborted' }));
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every key of `obj` is in `allowed` and every `required` key is present. */
function hasOnlyKeys(obj: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(obj);
  return required.every((k) => Object.prototype.hasOwnProperty.call(obj, k)) && keys.every((k) => required.includes(k) || optional.includes(k));
}

class HttpError {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, string>;
  constructor(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const bad = (detail?: string): HttpError => new HttpError(400, detail ? { error: 'bad request', detail } : { error: 'bad request' });

export function createAdminApi(params: {
  options?: AdminOptions;
  google: GoogleTokenVerifier | null;
  actions: AdminActions;
  now?: () => number;
  log?: (line: string) => void;
}): AdminApi {
  const options = params.options ?? {};
  const now = params.now ?? Date.now;
  const log = params.log ?? (() => {});
  const { actions, google } = params;
  const key = typeof options.key === 'string' && options.key.length >= ADMIN_KEY_MIN_LENGTH ? options.key : null;
  const enabled = key !== null;
  const emails = [...new Set((options.emails ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))];
  const mode: AdminMode = google && emails.length > 0 ? 'two-factor' : 'key-only';
  const trustProxy = options.trustProxy === true;
  const production = options.production === true;
  const requireHttps = options.requireHttps ?? (trustProxy && production);
  const consoleOrigin = options.origin ?? ADMIN_PUBLIC_ORIGIN;
  // A disabled admin still hashes and compares (against a random value) so every failure costs the same.
  const expectedKey = sha256(key ?? randomBytes(32).toString('hex'));
  const ipSalt = randomBytes(16);
  const limiter = new LoginLimiter();
  const sessions = new SessionStore();
  const audit: AuditEntry[] = [];

  const hashIp = (ip: string): string => createHash('sha256').update(ipSalt).update(ip, 'utf8').digest('hex').slice(0, 12);

  const record = (entry: AuditEntry): void => {
    audit.push(entry);
    if (audit.length > ADMIN_LIMITS.auditEntries) audit.splice(0, audit.length - ADMIN_LIMITS.auditEntries);
  };

  const originAllowed = (origin: string): boolean => origin === consoleOrigin || (!production && LOCAL_ORIGIN_RE.test(origin));

  const status = (): AdminStatus => {
    const t = now();
    return {
      enabled,
      mode,
      warning: enabled && mode === 'key-only' ? KEY_ONLY_WARNING : null,
      sessions: sessions.count(t),
      lockedUntil: t < limiter.lockedUntil ? limiter.lockedUntil : null,
      lastLockout: limiter.lastLockout,
      failedLoginsLastHour: limiter.failuresLastHour(t),
      blockedAttempts: limiter.blocked,
    };
  };

  const keyMatches = (given: string): boolean => timingSafeEqual(sha256(given), expectedKey);

  // ── Routes ───────────────────────────────────────────────────────────────

  interface Ctx {
    req: IncomingMessage;
    ipHash: string;
    body: Record<string, unknown> | null;
    /** The bearer session (authenticated routes). */
    session: string;
  }

  const login = async (ctx: Omit<Ctx, 'session'>): Promise<{ status: number; body: Record<string, unknown>; headers?: Record<string, string> }> => {
    const gate = limiter.check(ctx.ipHash, now());
    if (gate) {
      limiter.blocked += 1;
      return {
        status: 429,
        body: gate.kind === 'locked' ? { error: 'admin locked', retryAfterSec: gate.retryAfterSec } : { error: 'too many attempts', retryAfterSec: gate.retryAfterSec },
        headers: { 'Retry-After': String(gate.retryAfterSec) },
      };
    }
    limiter.reserve(ctx.ipHash, now());
    const body = ctx.body;
    const wellFormed =
      body !== null &&
      hasOnlyKeys(body, ['key'], ['idToken']) &&
      typeof body.key === 'string' &&
      body.key.length >= 1 &&
      body.key.length <= 1024 &&
      (body.idToken === undefined || (typeof body.idToken === 'string' && body.idToken.length <= MAX_ID_TOKEN_LENGTH));
    const fail = (status: number, error: string, detail: string): { status: number; body: Record<string, unknown> } => {
      const t = now();
      const lockout = limiter.settle(ctx.ipHash, t, true);
      record({ at: t, action: 'login', ok: false, ipHash: ctx.ipHash, detail });
      log(`admin: login refused (${detail}) from ip#${ctx.ipHash}`);
      if (lockout) {
        record({ at: t, action: 'lockout', ok: false, ipHash: ctx.ipHash, detail: `${lockout.failures} failed logins in an hour: login locked for everyone until ${new Date(lockout.until).toISOString()}` });
        log(`admin: ${lockout.failures} failed logins in an hour; login locked for 30 minutes`);
      }
      return { status, body: { error } };
    };
    if (!wellFormed) return fail(400, 'bad request', 'malformed request');

    const keyOk = keyMatches(body.key as string);
    let googleOk = true;
    if (mode === 'two-factor' && google) {
      let result: VerifyResult = { ok: false, reason: 'malformed' };
      if (typeof body.idToken === 'string') {
        try {
          result = await google.verify(body.idToken);
        } catch {
          result = { ok: false, reason: 'keys_unavailable' };
        }
      }
      googleOk = isAdminIdentity(result, emails);
    }
    if (!enabled) return fail(503, 'admin not configured', 'admin not configured');
    if (!keyOk || !googleOk) return fail(401, 'unauthorized', !keyOk && !googleOk ? 'wrong key and Google account' : !keyOk ? 'wrong key' : 'Google account not accepted');

    const t = now();
    limiter.settle(ctx.ipHash, t, false);
    const created = sessions.create(t, mode);
    record({ at: t, action: 'login', ok: true, ipHash: ctx.ipHash, detail: mode });
    log(`admin: login (${mode}) from ip#${ctx.ipHash}`);
    const out: Record<string, unknown> = { ...created, mode };
    if (mode === 'key-only') out.warning = KEY_ONLY_WARNING;
    if (limiter.lastLockout) out.lastLockout = limiter.lastLockout;
    return { status: 200, body: out };
  };

  const requireEmptyBody = (body: Record<string, unknown> | null): void => {
    if (body !== null && Object.keys(body).length > 0) throw bad('this action takes no fields');
  };

  type Handler = (ctx: Ctx, match: RegExpMatchArray) => Record<string, unknown>;
  const routes: { method: 'GET' | 'POST'; path: RegExp; run: Handler }[] = [
    {
      method: 'POST',
      path: /^logout$/,
      run: (ctx) => {
        requireEmptyBody(ctx.body);
        sessions.revoke(ctx.session);
        record({ at: now(), action: 'logout', ok: true, ipHash: ctx.ipHash });
        return { ok: true };
      },
    },
    {
      method: 'GET',
      path: /^stats$/,
      run: () => ({ ...actions.stats(), admin: status() }),
    },
    {
      method: 'GET',
      path: /^rooms$/,
      run: () => ({ rooms: actions.rooms(), settings: actions.settings() }),
    },
    {
      method: 'POST',
      path: /^rooms\/([A-Z]{4})\/close$/,
      run: (ctx, match) => {
        requireEmptyBody(ctx.body);
        const code = match[1]!;
        if (!ROOM_CODE_RE.test(code)) throw new HttpError(404, { error: 'no such room' });
        const closed = actions.closeRoom(code);
        if (!closed) throw new HttpError(404, { error: 'no such room' });
        record({ at: now(), action: 'close-room', ok: true, ipHash: ctx.ipHash, detail: `room ${code} (${closed.members} present)` });
        log(`admin: closed room ${code}`);
        return { ok: true, code, members: closed.members };
      },
    },
    {
      method: 'POST',
      path: /^rooms\/([A-Z]{4})\/remove$/,
      run: (ctx, match) => {
        const code = match[1]!;
        const body = ctx.body;
        if (body === null || !hasOnlyKeys(body, ['memberId']) || typeof body.memberId !== 'string' || !MEMBER_ID_RE.test(body.memberId)) {
          throw bad('expected {"memberId": "<id from GET rooms>"}');
        }
        if (!ROOM_CODE_RE.test(code)) throw new HttpError(404, { error: 'no such room' });
        const result = actions.removeMember(code, body.memberId);
        if (result === 'no_room') throw new HttpError(404, { error: 'no such room' });
        if (result === 'no_member') throw new HttpError(404, { error: 'no such player' });
        record({ at: now(), action: 'remove-player', ok: true, ipHash: ctx.ipHash, detail: `${body.memberId} "${result.name}" from room ${code}${result.closed ? ' (room closed)' : ''}` });
        log(`admin: removed ${body.memberId} from room ${code}`);
        return { ok: true, code, memberId: body.memberId, roomClosed: result.closed };
      },
    },
    {
      method: 'POST',
      path: /^announce$/,
      run: (ctx) => {
        const body = ctx.body;
        if (body === null || !hasOnlyKeys(body, ['text', 'minutes'])) throw bad('expected {"text", "minutes"}');
        const text = sanitizeAnnounceText(body.text);
        if (text === null || text.length === 0) throw bad(`text must have 1 to ${ANNOUNCE_MAX_TEXT} characters`);
        const minutes = body.minutes;
        if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < ANNOUNCE_MIN_MINUTES || minutes > ANNOUNCE_MAX_MINUTES) {
          throw bad(`minutes must be a whole number from ${ANNOUNCE_MIN_MINUTES} to ${ANNOUNCE_MAX_MINUTES}`);
        }
        const announce = actions.announce(text, minutes);
        record({ at: now(), action: 'announce', ok: true, ipHash: ctx.ipHash, detail: `${minutes} min: ${text}` });
        log(`admin: announcement for ${minutes} min (${[...text].length} characters)`);
        return { ok: true, announce };
      },
    },
    {
      method: 'POST',
      path: /^announce\/clear$/,
      run: (ctx) => {
        requireEmptyBody(ctx.body);
        const cleared = actions.clearAnnounce();
        record({ at: now(), action: 'announce-clear', ok: true, ipHash: ctx.ipHash, detail: cleared ? 'banner hidden' : 'nothing to hide' });
        return { ok: true, cleared: cleared !== null };
      },
    },
    {
      method: 'GET',
      path: /^settings$/,
      run: () => ({ settings: actions.settings() }),
    },
    {
      method: 'POST',
      path: /^settings$/,
      run: (ctx) => {
        const body = ctx.body;
        if (body === null || !hasOnlyKeys(body, ['newRoomsAllowed']) || typeof body.newRoomsAllowed !== 'boolean') {
          throw bad('expected {"newRoomsAllowed": true|false}');
        }
        actions.setSettings({ newRoomsAllowed: body.newRoomsAllowed });
        record({ at: now(), action: 'settings', ok: true, ipHash: ctx.ipHash, detail: `new rooms ${body.newRoomsAllowed ? 'allowed' : 'paused'}` });
        log(`admin: new rooms ${body.newRoomsAllowed ? 'allowed' : 'paused'}`);
        return { ok: true, settings: actions.settings() };
      },
    },
    {
      method: 'GET',
      path: /^audit$/,
      run: () => ({ entries: [...audit].reverse() }),
    },
  ];

  // ── Request plumbing ─────────────────────────────────────────────────────

  const handleAsync = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
    };
    const send = (status: number, body: Record<string, unknown> | null, extra: Record<string, string> = {}): void => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { ...headers, ...extra });
      res.end(body === null ? undefined : JSON.stringify(body));
    };

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (!originAllowed(origin)) {
        send(403, { error: 'origin not allowed' });
        return;
      }
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Expose-Headers'] = 'X-Session-Expires-At, Retry-After';
    }
    if (requireHttps && lastHeaderValue(req.headers['x-forwarded-proto']) !== 'https') {
      send(403, { error: 'https required' });
      return;
    }
    if (req.method === 'OPTIONS') {
      send(204, null, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return;
    }

    let pathname = '';
    try {
      pathname = new URL(req.url ?? '/', 'http://relay.invalid').pathname;
    } catch {
      send(400, { error: 'bad request' });
      return;
    }
    const path = pathname.startsWith(ADMIN_API_PREFIX) ? pathname.slice(ADMIN_API_PREFIX.length) : '\u0000';
    const ipHash = hashIp(clientIp(req, trustProxy));

    const readJson = async (): Promise<Record<string, unknown> | null> => {
      const body = await readBody(req, ADMIN_LIMITS.bodyBytes);
      if (body.status === 'too_large') throw new HttpError(413, { error: 'body too large', limitBytes: ADMIN_LIMITS.bodyBytes }, { Connection: 'close' });
      if (body.status === 'aborted') throw new HttpError(400, { error: 'bad request' });
      if (body.text.trim().length === 0) return null;
      const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== 'application/json') throw new HttpError(415, { error: 'send JSON (Content-Type: application/json)' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.text);
      } catch {
        throw bad('invalid JSON');
      }
      if (!isPlainObject(parsed)) throw bad('expected a JSON object');
      return parsed;
    };

    try {
      if (path === 'login') {
        if (req.method !== 'POST') throw new HttpError(405, { error: 'method not allowed' }, { Allow: 'POST, OPTIONS' });
        let body: Record<string, unknown> | null;
        try {
          body = await readJson();
        } catch (err) {
          if (err instanceof HttpError && err.status === 413) throw err;
          body = null; // counted as a malformed (failed) attempt by login()
        }
        const result = await login({ req, ipHash, body });
        send(result.status, result.body, result.headers);
        return;
      }

      const auth = BEARER_RE.exec(req.headers.authorization ?? '');
      const touched = auth ? sessions.touch(auth[1]!, now()) : null;
      if (!auth || !touched) throw new HttpError(401, { error: 'unauthorized' });
      headers['X-Session-Expires-At'] = String(touched.expiresAt);

      const candidates = routes.filter((r) => r.path.test(path));
      if (candidates.length === 0) throw new HttpError(404, { error: 'not found' });
      const route = candidates.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, { error: 'method not allowed' }, { Allow: [...new Set(candidates.map((r) => r.method)), 'OPTIONS'].join(', ') });
      const body = route.method === 'POST' ? await readJson() : null;
      send(200, route.run({ req, ipHash, body, session: auth[1]! }, path.match(route.path)!));
    } catch (err) {
      if (err instanceof HttpError) {
        send(err.status, err.body, err.headers);
        return;
      }
      log(`admin: internal error: ${(err as Error).message}`);
      send(500, { error: 'internal error' });
    }
  };

  return {
    handle(req, res) {
      void handleAsync(req, res);
    },
    status,
  };
}
