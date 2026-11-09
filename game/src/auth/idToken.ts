/**
 * Reading a Google ID token on the device, for display only: when it runs out and the first name to show
 * next to SIGNED IN. The relay is what checks the signature, the audience and the expiry; nothing here
 * trusts the token. The email address in the token is never read or kept.
 */
import { sanitizeIdToken, sanitizeRoomName } from '@shared/protocol';

export interface IdTokenInfo {
  /** When the token runs out (epoch ms, the token's `exp`). */
  expiresAt: number;
  /** The token's `given_name`, cleaned like a room name (≤ 16 characters); null when absent. */
  givenName: string | null;
}

/** A token closer than this to its expiry is not sent any more (the relay allows 60 s of clock skew). */
export const TOKEN_SEND_MARGIN_MS = 60_000;
/** GIS is asked for a fresh token this long before the current one runs out. */
export const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;

function decodeBase64Url(part: string): string | null {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** exp and given_name of a compact JWT, or null when it is not one (bad shape, no numeric exp). */
export function readIdToken(token: unknown): IdTokenInfo | null {
  const clean = sanitizeIdToken(token);
  if (!clean) return null;
  const json = decodeBase64Url(clean.split('.')[1] ?? '');
  if (json === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const claims = payload as Record<string, unknown>;
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  const givenName = sanitizeRoomName(claims.given_name);
  return { expiresAt: Math.round(claims.exp * 1000), givenName: givenName ? givenName : null };
}

/** The token can still be sent: it runs out more than TOKEN_SEND_MARGIN_MS from `now`. */
export function isTokenFresh(info: Pick<IdTokenInfo, 'expiresAt'> | null, now: number = Date.now()): boolean {
  return info !== null && info.expiresAt - TOKEN_SEND_MARGIN_MS > now;
}
