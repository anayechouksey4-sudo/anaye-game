/**
 * Google Identity Services (GIS), loaded on demand: the script at GIS_SCRIPT_URL is added to the page
 * only when the FRIENDS tab opens, a client id is configured (config.ts googleClientId) and the relay
 * verifies tokens (server:welcome.signIn). Nothing is fetched from Google before that, and never in
 * offline mode.
 *
 * The SIGN IN WITH GOOGLE button is the one GIS draws (renderButton); one-tap (prompt) is offered once per
 * page load to a device that signed in last time, and is what refreshes the token a few minutes before it
 * runs out (auto_select: no tap needed when Google can tell who it is). Google may still show its one-tap
 * card, so a refresh only ever prompts while the ☰ menu is open: one that falls due mid-race waits for the
 * next time the menu opens (nothing covers the thumbs while driving). Each credential goes straight to
 * authStore.acceptCredential, which keeps it in memory only.
 */
import { useSelection } from '../state/selection';
import { acceptCredential, installGisHooks, refreshDue, rememberedSignIn, setGisStatus } from './authStore';

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
const LOAD_TIMEOUT_MS = 15_000;

interface GisCredentialResponse {
  credential?: string;
}

interface GisButtonOptions {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'small' | 'medium' | 'large';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle' | 'square';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

/** The part of `google.accounts.id` the game uses. */
export interface GisIdApi {
  initialize(config: {
    client_id: string;
    callback: (response: GisCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    itp_support?: boolean;
    use_fedcm_for_prompt?: boolean;
    context?: 'signin' | 'signup' | 'use';
    ux_mode?: 'popup' | 'redirect';
  }): void;
  renderButton(parent: HTMLElement, options: GisButtonOptions): void;
  prompt(): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GisIdApi } };
  }
}

let loading: Promise<GisIdApi | null> | null = null;
let api: GisIdApi | null = null;
let initializedFor: string | null = null;
let oneTapOffered = false;

const gisApi = (): GisIdApi | null => (typeof window !== 'undefined' ? (window.google?.accounts?.id ?? null) : null);

function loadScript(): Promise<GisIdApi> {
  const present = gisApi();
  if (present) return Promise.resolve(present);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.dataset.gis = '1';
    const done = (ok: boolean) => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      const found = gisApi();
      if (ok && found) resolve(found);
      else {
        script.remove();
        reject(new Error('Google sign-in did not load'));
      }
    };
    const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);
    script.onload = () => done(true);
    script.onerror = () => done(false);
    document.head.appendChild(script);
  });
}

function initialize(gis: GisIdApi, clientId: string): void {
  if (initializedFor === clientId) return;
  gis.initialize({
    client_id: clientId,
    callback: (response) => {
      acceptCredential(response.credential);
    },
    auto_select: rememberedSignIn(),
    cancel_on_tap_outside: true,
    itp_support: true,
    use_fedcm_for_prompt: true,
    context: 'signin',
    ux_mode: 'popup',
  });
  initializedFor = clientId;
  // One-tap with auto_select hands back a fresh token without a tap when Google knows the account; only
  // while the menu is open and the page is visible (else when the menu next opens).
  const refreshQuietly = () => {
    if (!refreshDue()) return;
    if (!useSelection.getState().menuOpen || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    try {
      gis.prompt();
    } catch {
      /* the token simply runs out: SIGN IN shows again */
    }
  };
  useSelection.subscribe((s, prev) => {
    if (s.menuOpen && !prev.menuOpen) refreshQuietly();
  });
  installGisHooks({
    refresh: refreshQuietly,
    signOut: () => {
      try {
        gis.disableAutoSelect();
      } catch {
        /* nothing to undo */
      }
    },
  });
}

/** Load and initialize GIS once (concurrent callers share the load). Resolves null when it cannot load; a later call retries. */
export function ensureGis(clientId: string): Promise<GisIdApi | null> {
  if (!clientId || typeof document === 'undefined') return Promise.resolve(null);
  if (api && initializedFor === clientId) return Promise.resolve(api);
  if (loading) return loading;
  setGisStatus('loading');
  loading = loadScript()
    .then((gis) => {
      initialize(gis, clientId);
      api = gis;
      setGisStatus('ready');
      return gis;
    })
    .catch(() => {
      loading = null;
      setGisStatus('failed');
      return null;
    });
  return loading;
}

/** Draw GIS's SIGN IN WITH GOOGLE button into `el` (GIS replaces its content). */
export function renderGisButton(el: HTMLElement, width: number): void {
  if (!api) return;
  try {
    api.renderButton(el, { type: 'standard', theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'pill', logo_alignment: 'left', width: Math.round(Math.max(200, Math.min(400, width))) });
  } catch {
    setGisStatus('failed');
  }
}

/** One-tap for a device that signed in last time, once per page load. */
export function offerOneTap(): void {
  if (!api || oneTapOffered || !rememberedSignIn()) return;
  oneTapOffered = true;
  try {
    api.prompt();
  } catch {
    /* the button is still there */
  }
}
