/**
 * What the relay hears about this device (shared/protocol.ts "Sign-in, time zone and announcements"):
 *
 *   tz       the device's IANA time zone, on `hello` and on every room:create / room:join / room:update.
 *            The relay maps it to a country for the owner's stats and keeps only the country. Nothing
 *            here or on the relay uses the IP address.
 *   idToken  the Google ID token while signed in; `null` once on SIGN OUT. The relay keeps the latest
 *            verdict per socket, so the token goes out once per socket (on `hello` when we already have
 *            one, else on the first room frame after signing in) and again on room:create / room:join
 *            (the relay checks it right there). A token that is about to run out is never sent: it would
 *            sign the socket out. A relay that predates sign-in drops both fields.
 *
 * One `hello` per socket (net/squadLink.ts sends it on open), so helloAuthFields() starts the socket's
 * record. `told` is what this socket was last told: 'in' (a token went out), 'out' (null went out) or
 * nothing yet.
 */
import { sanitizeTimeZone, type PlayerAuthFields } from '@shared/protocol';
import { authState, currentIdToken } from './authStore';

let told: 'in' | 'out' | null = null;

/** The device's IANA time zone (`Asia/Kolkata`), or undefined when the browser does not say. */
export function deviceTimeZone(): string | undefined {
  try {
    return sanitizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone) ?? undefined;
  } catch {
    return undefined;
  }
}

/** What the relay should believe about this socket: 'in' (we hold a sendable token), 'out' (signed out), null (no change: the token ran out, the relay keeps its verdict). */
function wanted(now: number): 'in' | 'out' | null {
  if (currentIdToken(now) !== null) return 'in';
  return authState().status === 'signed-out' ? 'out' : null;
}

/** tz and (when we have one) the token for the socket's first frame. Resets the socket's record. */
export function helloAuthFields(now: number = Date.now()): PlayerAuthFields {
  told = null;
  const out: PlayerAuthFields = {};
  const tz = deviceTimeZone();
  if (tz) out.tz = tz;
  const t = currentIdToken(now);
  if (t !== null) {
    out.idToken = t;
    told = 'in';
  }
  return out;
}

/**
 * tz plus the sign-in change this socket has not heard yet. `force` re-sends a sendable token even when
 * the socket already has one (room:create / room:join: the relay checks it right there, and a verdict
 * that failed earlier, e.g. keys not reachable, gets another chance).
 */
export function roomAuthFields(opts: { force?: boolean } = {}, now: number = Date.now()): PlayerAuthFields {
  const out: PlayerAuthFields = {};
  const tz = deviceTimeZone();
  if (tz) out.tz = tz;
  const want = wanted(now);
  if (want === 'in' && (opts.force || told !== 'in')) {
    out.idToken = currentIdToken(now);
    told = 'in';
  } else if (want === 'out' && told === 'in') {
    out.idToken = null;
    told = 'out';
  }
  return out;
}

/** The socket has not heard the current sign-in state yet (a room:update should carry it). */
export function authChangePending(now: number = Date.now()): boolean {
  const want = wanted(now);
  return (want === 'in' && told !== 'in') || (want === 'out' && told === 'in');
}

/** Tests: a fresh socket record. */
export function resetWireForTests(): void {
  told = null;
}
