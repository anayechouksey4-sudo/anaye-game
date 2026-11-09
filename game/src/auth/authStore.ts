/**
 * Google sign-in state on this device (zustand). The ID token itself lives in this module's memory only:
 * never in the store (so never in a devtools snapshot), never in localStorage or sessionStorage, never in
 * a log. The only thing remembered across visits is "this device signed in last time" (REMEMBER_KEY), so
 * the FRIENDS tab can offer Google's one-tap sign-in again.
 *
 *   status        'signed-out' · 'signed-in' (a token we can still send) · 'expired' (the token ran out and
 *                 GIS could not refresh it; the relay keeps this socket's badge until it reconnects)
 *   relaySignIn   the relay's server:welcome.signIn (null = no relay / not told yet); the sign-in row and the
 *                 host's SIGNED-IN PLAYERS ONLY switch only show while it is true
 *   gis           Google Identity Services script: idle · loading · ready · failed
 *   neededAt      Date.now() of the last room:error 'sign_in_required' (the FRIENDS tab points at SIGN IN)
 */
import { create } from 'zustand';
import { TOKEN_REFRESH_LEAD_MS, TOKEN_SEND_MARGIN_MS, isTokenFresh, readIdToken, type IdTokenInfo } from './idToken';

export type AuthStatus = 'signed-out' | 'signed-in' | 'expired';
export type GisStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface AuthState {
  status: AuthStatus;
  givenName: string | null;
  expiresAt: number | null;
  /** Bumped on every new token (sign-in or refresh) and on sign-out. */
  serial: number;
  relaySignIn: boolean | null;
  gis: GisStatus;
  neededAt: number | null;
  /** The last sign-in attempt failed (a token that was malformed or already expired). */
  error: string | null;
}

/** localStorage: '1' after a sign-in on this device, removed on SIGN OUT. Never the token. */
export const REMEMBER_KEY = 'gamerfleet.signin.v1';

export const useAuth = create<AuthState>()(() => ({
  status: 'signed-out',
  givenName: null,
  expiresAt: null,
  serial: 0,
  relaySignIn: null,
  gis: 'idle',
  neededAt: null,
  error: null,
}));

export const authState = (): AuthState => useAuth.getState();

let token: string | null = null;
let tokenInfo: IdTokenInfo | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let expireTimer: ReturnType<typeof setTimeout> | null = null;
/** Asks GIS for a fresh token (installed by gis.ts once the script is ready). */
let refresher: (() => void) | null = null;
/** Undo for sign-out on the GIS side (disableAutoSelect), installed by gis.ts. */
let onSignOut: (() => void) | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** This device signed in last time (offer one-tap sign-in when FRIENDS opens). */
export function rememberedSignIn(): boolean {
  try {
    return storage()?.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

function setRemembered(on: boolean): void {
  try {
    const s = storage();
    if (!s) return;
    if (on) s.setItem(REMEMBER_KEY, '1');
    else s.removeItem(REMEMBER_KEY);
  } catch {
    /* private mode: sign-in still works for this visit */
  }
}

function clearTimers(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  if (expireTimer) clearTimeout(expireTimer);
  refreshTimer = null;
  expireTimer = null;
}

/** setTimeout that does not keep a node test process alive (browsers return a number: no unref). */
function later(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
  const t = setTimeout(fn, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
  (t as { unref?: () => void }).unref?.();
  return t;
}

/**
 * The token to put on the wire, or null when there is none we can still send (signed out, expired, or
 * within TOKEN_SEND_MARGIN_MS of running out: an expired token would sign this socket out on the relay).
 */
export function currentIdToken(now: number = Date.now()): string | null {
  return token !== null && isTokenFresh(tokenInfo, now) ? token : null;
}

/**
 * A credential from GIS (the sign-in button, one-tap, or a silent refresh). Returns false (and keeps the
 * current state) for a token that is malformed or already too close to its expiry.
 */
export function acceptCredential(credential: unknown, now: number = Date.now()): boolean {
  const info = readIdToken(credential);
  if (!info || !isTokenFresh(info, now)) {
    useAuth.setState({ error: 'Google sign-in returned an unusable token; try again' });
    return false;
  }
  token = credential as string;
  tokenInfo = info;
  setRemembered(true);
  clearTimers();
  const left = info.expiresAt - now;
  refreshTimer = later(() => {
    refreshTimer = null;
    refresher?.();
  }, left - TOKEN_REFRESH_LEAD_MS);
  expireTimer = later(() => {
    expireTimer = null;
    expireToken();
  }, left - TOKEN_SEND_MARGIN_MS);
  useAuth.setState((s) => ({ status: 'signed-in', givenName: info.givenName, expiresAt: info.expiresAt, serial: s.serial + 1, error: null, neededAt: null }));
  return true;
}

/** A silent refresh is due: the token is within TOKEN_REFRESH_LEAD_MS of running out, or ran out already. */
export function refreshDue(now: number = Date.now()): boolean {
  const s = authState();
  if (s.status === 'expired') return true;
  return s.status === 'signed-in' && tokenInfo !== null && tokenInfo.expiresAt - now <= TOKEN_REFRESH_LEAD_MS;
}

/** The token ran out without a refresh: SIGN IN again (the relay keeps this socket's badge meanwhile). */
export function expireToken(): void {
  if (token === null) return;
  token = null;
  tokenInfo = null;
  clearTimers();
  useAuth.setState({ status: 'expired', expiresAt: null });
}

/** SIGN OUT: forget the token and the remembered sign-in; the room client tells the relay (idToken: null). */
export function signOut(): void {
  token = null;
  tokenInfo = null;
  clearTimers();
  setRemembered(false);
  onSignOut?.();
  useAuth.setState((s) => ({ status: 'signed-out', givenName: null, expiresAt: null, serial: s.serial + 1, error: null }));
}

export function setRelaySignIn(value: boolean | null): void {
  if (authState().relaySignIn !== value) useAuth.setState({ relaySignIn: value });
}

export function setGisStatus(gis: GisStatus): void {
  if (authState().gis !== gis) useAuth.setState({ gis });
}

/** A room said SIGNED-IN PLAYERS ONLY: point at the sign-in row. */
export function noteSignInRequired(now: number = Date.now()): void {
  useAuth.setState({ neededAt: now });
}

/** gis.ts: how to refresh the token silently and what to do on sign-out. */
export function installGisHooks(hooks: { refresh: () => void; signOut: () => void }): void {
  refresher = hooks.refresh;
  onSignOut = hooks.signOut;
}

/** Tests: back to a fresh page. */
export function resetAuthForTests(): void {
  token = null;
  tokenInfo = null;
  clearTimers();
  refresher = null;
  onSignOut = null;
  useAuth.setState({ status: 'signed-out', givenName: null, expiresAt: null, serial: 0, relaySignIn: null, gis: 'idle', neededAt: null, error: null });
}
