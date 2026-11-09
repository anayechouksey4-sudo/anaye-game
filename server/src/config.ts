/**
 * Milestone 6 settings from the environment (the hosting dashboard sets them; none is ever committed):
 *
 *   ADMIN_KEY         the owner's admin passphrase, ≥ 24 characters (missing or shorter = admin off)
 *   ADMIN_EMAILS      comma-separated Google accounts allowed into the console (with GOOGLE_CLIENT_ID:
 *                     two-factor login = that Google account + ADMIN_KEY)
 *   GOOGLE_CLIENT_ID  the game's Google OAuth client id (public): players' ID tokens must be issued to it
 *   TRUST_PROXY       "1" behind the hosting platform's proxy: the visitor's IP is the LAST X-Forwarded-For
 *                     entry (rate limits and the audit's IP hash), and in production the admin API insists
 *                     on X-Forwarded-Proto https
 *   NODE_ENV          "production" refuses localhost origins on the admin API and GOOGLE_JWKS_FILE
 *   GOOGLE_JWKS_FILE  (local testing only, ignored in production) a JWKS file used instead of Google's keys,
 *                     so a local relay accepts tokens signed by a test key (npm run test-google)
 *   RELAY_VERSION / RENDER_GIT_COMMIT   the version shown in the console (default 'unknown')
 *
 * `notes` are startup lines that say what is on and off; they never contain a value of the above.
 */
import type { AdminOptions } from './admin';
import { ADMIN_KEY_MIN_LENGTH } from './admin';
import { GoogleTokenVerifier, fileJwksSource, httpJwksSource, type JwksSource } from './auth/google';

export interface ServerConfig {
  admin: AdminOptions;
  google: GoogleTokenVerifier | null;
  version: string;
  notes: string[];
}

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,200}$/;
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

export function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(raw.split(',').map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s,]+@[^@\s,]+$/.test(e)))].slice(0, 20);
}

export function resolveServerConfig(env: NodeJS.ProcessEnv, overrides: { jwksSource?: JwksSource } = {}): ServerConfig {
  const notes: string[] = [];
  const production = env.NODE_ENV === 'production';
  const trustProxy = env.TRUST_PROXY === '1' || env.TRUST_PROXY?.toLowerCase() === 'true';

  const rawClientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  let google: GoogleTokenVerifier | null = null;
  if (rawClientId && !CLIENT_ID_RE.test(rawClientId)) {
    notes.push('sign-in: off (GOOGLE_CLIENT_ID does not look like a client id)');
  } else if (rawClientId) {
    let source = overrides.jwksSource ?? httpJwksSource();
    const jwksFile = env.GOOGLE_JWKS_FILE?.trim();
    if (jwksFile && !overrides.jwksSource) {
      if (production) {
        notes.push('sign-in: GOOGLE_JWKS_FILE is ignored in production (Google\'s keys are used)');
      } else {
        source = fileJwksSource(jwksFile);
        notes.push('sign-in: using the test keys from GOOGLE_JWKS_FILE (local testing only)');
      }
    }
    google = new GoogleTokenVerifier({ clientId: rawClientId, source });
    notes.push('sign-in: on (Google ID tokens are verified for GOOGLE_CLIENT_ID)');
  } else {
    notes.push('sign-in: off (GOOGLE_CLIENT_ID is not set)');
  }

  const key = env.ADMIN_KEY ?? '';
  const emails = parseAdminEmails(env.ADMIN_EMAILS);
  if (!key) notes.push('admin: off (ADMIN_KEY is not set)');
  else if (key.length < ADMIN_KEY_MIN_LENGTH) notes.push(`admin: off (ADMIN_KEY is shorter than ${ADMIN_KEY_MIN_LENGTH} characters)`);
  else if (google && emails.length > 0) notes.push(`admin: on, two-factor (a Google account from ADMIN_EMAILS + ADMIN_KEY; ${emails.length} account${emails.length === 1 ? '' : 's'})`);
  else notes.push('admin: on, key only (set GOOGLE_CLIENT_ID and ADMIN_EMAILS for two-factor login)');
  if (trustProxy) notes.push('proxy: TRUST_PROXY=1 (client IP = last X-Forwarded-For entry)');

  const rawVersion = (env.RELAY_VERSION ?? env.RENDER_GIT_COMMIT ?? '').trim();
  let version = 'unknown';
  if (VERSION_RE.test(rawVersion)) version = /^[0-9a-f]{40}$/i.test(rawVersion) ? rawVersion.slice(0, 12) : rawVersion;

  return {
    admin: { key: key || null, emails, trustProxy, production },
    google,
    version,
    notes,
  };
}
