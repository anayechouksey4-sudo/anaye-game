/**
 * Installable app plumbing: registers the build's service worker (`sw.js`, written by the plugin
 * in vite.config.ts), captures the browser's install prompt and keeps a tiny store the SETTINGS
 * card (InstallCard.tsx) renders from.
 *
 * - Production only: the dev server has no worker (`import.meta.env.PROD` guard), and everything
 *   is wrapped in try/catch because the page also runs inside sandboxed frames and private tabs
 *   where the APIs throw.
 * - Relative URLs (`./sw.js`, scope `./`): the hosted copy lives under `/<repo>/`.
 * - An update never reloads the page mid-run. When a new worker takes control the store flips
 *   `updateReady` and the card offers RESTART; a fresh page start simply gets the new version.
 */
import { useSyncExternalStore } from 'react';

export interface PwaState {
  /** Service workers exist here and this is a production build. */
  supported: boolean;
  /** `./sw.js` registered (or already registered from an earlier visit). */
  registered: boolean;
  /** Version of the worker in control (hash of the build's files), once it answered. */
  version: string | null;
  /** The precache (every file of the build) is complete: the game boots with no network. */
  offlineReady: boolean;
  /** A newer worker installed and took control: RESTART (reload) switches to it. */
  updateReady: boolean;
  /** No network: `navigator.onLine` is false or the worker served the cached page after a failed fetch. */
  offline: boolean;
  /** `beforeinstallprompt` was captured: INSTALL APP can show the browser's prompt. */
  canInstall: boolean;
  /** Running as an installed app (display-mode standalone / iOS `navigator.standalone`). */
  standalone: boolean;
  /** `appinstalled` fired in this page, or we run standalone. */
  installed: boolean;
  /** iOS browser (no install prompt API): the card shows Share → Add to Home Screen. */
  ios: boolean;
}

/** Chromium's `beforeinstallprompt` event (not in lib.dom). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const SW_URL = './sw.js';
const SW_SCOPE = './';
/** A worker update check when the app comes back to the foreground after this long. */
const UPDATE_CHECK_MS = 30 * 60 * 1000;

const listeners = new Set<() => void>();
let state: PwaState = {
  supported: false,
  registered: false,
  version: null,
  offlineReady: false,
  updateReady: false,
  offline: false,
  canInstall: false,
  standalone: false,
  installed: false,
  ios: false,
};
let deferredPrompt: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let installedOnce = false;
let lastUpdateCheck = 0;

function set(patch: Partial<PwaState>): void {
  let changed = false;
  for (const key of Object.keys(patch) as (keyof PwaState)[]) {
    if (state[key] !== patch[key]) changed = true;
  }
  if (!changed) return;
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

export const pwaState = (): PwaState => state;

/** The game's own public page: installing and the offline cache only work there (or on a LAN copy), never
 *  inside another app's frame. */
export const PUBLIC_GAME_URL = 'https://anayechouksey4-sudo.github.io/anaye-game/';

/** True when this copy runs inside another page's frame (an embed or a viewer), where the browser offers no
 *  install prompt and the service worker cannot take control. */
export function isFramed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

export function subscribePwa(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React view of the store (one object per change, so selectors are unnecessary). */
export function usePwa(): PwaState {
  return useSyncExternalStore(subscribePwa, pwaState, pwaState);
}

function isStandalone(): boolean {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches) return true;
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function isIos(): boolean {
  try {
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  } catch {
    return false;
  }
}

/** Ask the controlling worker for its version and precache state. */
function queryStatus(): void {
  try {
    const controller = navigator.serviceWorker.controller;
    if (!controller) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; version?: string; precached?: boolean } | null;
      if (!data || data.type !== 'gf:status') return;
      set({ version: typeof data.version === 'string' ? data.version : state.version, offlineReady: state.offlineReady || data.precached === true });
    };
    controller.postMessage({ type: 'gf:status?' }, [channel.port2]);
  } catch {
    // No messaging: the card just shows no version.
  }
}

function onWorkerMessage(e: MessageEvent): void {
  const data = e.data as { type?: string; version?: string } | null;
  if (!data) return;
  if (data.type === 'gf:precached') {
    set({ offlineReady: true, version: typeof data.version === 'string' ? data.version : state.version });
  } else if (data.type === 'gf:offline') {
    set({ offline: true });
  }
}

async function register(): Promise<void> {
  const sw = navigator.serviceWorker;
  let hadController = sw.controller !== null;
  sw.addEventListener('message', onWorkerMessage);
  sw.addEventListener('controllerchange', () => {
    // A worker took over this page: an update when one was already in charge, else the first install.
    if (hadController) set({ updateReady: true });
    hadController = true;
    queryStatus();
  });
  registration = await sw.register(SW_URL, { scope: SW_SCOPE });
  lastUpdateCheck = Date.now();
  set({ registered: true });
  if (sw.controller) queryStatus();
  // A page that already had an active worker before this load: its precache finished earlier.
  if (registration.active && sw.controller) set({ offlineReady: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
    lastUpdateCheck = Date.now();
    registration?.update().catch(() => undefined);
  });
}

/**
 * Wire everything up (idempotent). Call it before React renders so `beforeinstallprompt`, which
 * Chromium fires soon after load, is not missed.
 */
export function installPwa(): void {
  if (installedOnce || typeof window === 'undefined') return;
  installedOnce = true;
  try {
    const supported = import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext === true;
    set({
      supported,
      standalone: isStandalone(),
      installed: isStandalone(),
      ios: isIos(),
      offline: typeof navigator.onLine === 'boolean' ? !navigator.onLine : false,
    });
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e as InstallPromptEvent;
      set({ canInstall: true });
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      set({ canInstall: false, installed: true });
    });
    window.addEventListener('online', () => set({ offline: false }));
    window.addEventListener('offline', () => set({ offline: true }));
    try {
      window.matchMedia('(display-mode: standalone)').addEventListener('change', (e) => set({ standalone: e.matches, installed: e.matches || state.installed }));
    } catch {
      // Older browsers: the value read at start stands.
    }
    if (supported) {
      const start = () => {
        register().catch(() => set({ registered: false }));
      };
      if (document.readyState === 'complete') start();
      else window.addEventListener('load', start, { once: true });
    }
    (window as Window & { __PWA__?: unknown }).__PWA__ = {
      state: pwaState,
      promptInstall,
      restart: restartForUpdate,
      checkForUpdate,
    };
  } catch {
    // Sandboxed frame / blocked storage: the game runs without any of this.
  }
}

/** Show the browser's install prompt (INSTALL APP). */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      deferredPrompt = null;
      set({ canInstall: false, installed: true });
    }
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** RESTART after an update: a plain reload; the new worker already controls the page. */
export function restartForUpdate(): void {
  try {
    window.location.reload();
  } catch {
    // Nothing else to do.
  }
}

/** Manual update check (the card's debug handle); resolves to whether a new worker was found installing. */
export async function checkForUpdate(): Promise<boolean> {
  try {
    if (!registration) return false;
    lastUpdateCheck = Date.now();
    const reg = await registration.update();
    return (reg ?? registration).installing !== null;
  } catch {
    return false;
  }
}
