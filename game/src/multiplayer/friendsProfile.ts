/**
 * Who this device is in a room, kept on the device next to the profile (own versioned key):
 *   token — a random player token, made once and never shown; the relay keys this device's seat by it,
 *           so a reconnect takes back the same seat (host role, results row) instead of a new one;
 *   name  — YOUR NAME in FRIENDS (≤ ROOM_MAX_NAME, display-text rule); '' = use the selected driver's;
 *   asked — the one-time "what should friends call you?" card was answered or skipped.
 */
import { create } from 'zustand';
import { ROOM_DEFAULT_SIZE, ROOM_MAX_NAME, sanitizeRoomName, sanitizeRoomSize, sanitizeRoomToken } from '@shared/protocol';
import { DEFAULT_DRIVERS } from '../drivers/avatar';
import { activeDriver, profileState, type ProfileState } from '../state/profile';

export const FRIENDS_STORAGE_KEY = 'gamerfleet.friends.v1';

interface Saved {
  token?: unknown;
  name?: unknown;
  asked?: unknown;
  size?: unknown;
}

export interface FriendsProfile {
  token: string;
  name: string;
  asked: boolean;
  /** The last room size picked on HOST A ROOM. */
  size: number;
  setName: (name: string) => void;
  markAsked: () => void;
  setSize: (size: number) => void;
}

function makeToken(): string {
  const bytes = new Uint8Array(18);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(FRIENDS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

function save(p: Pick<FriendsProfile, 'token' | 'name' | 'asked' | 'size'>): void {
  try {
    window.localStorage.setItem(FRIENDS_STORAGE_KEY, JSON.stringify({ token: p.token, name: p.name, asked: p.asked, size: p.size }));
  } catch {
    // Private mode: the token lives for this visit (a reconnect still finds the seat).
  }
}

/** YOUR NAME as typed: the wire rule, cut to ROOM_MAX_NAME. */
export const cleanName = (input: string): string => (sanitizeRoomName(input) ?? '').slice(0, ROOM_MAX_NAME * 2);

const initial = (() => {
  const saved = load();
  const token = sanitizeRoomToken(saved.token) ?? makeToken();
  const out = {
    token,
    name: typeof saved.name === 'string' ? cleanName(saved.name) : '',
    asked: saved.asked === true,
    size: sanitizeRoomSize(saved.size) ?? ROOM_DEFAULT_SIZE,
  };
  if (saved.token !== token) save(out);
  return out;
})();

export const useFriendsProfile = create<FriendsProfile>()((set, get) => ({
  ...initial,
  setName: (name) => {
    set({ name: cleanName(name) });
    save(get());
  },
  markAsked: () => {
    if (get().asked) return;
    set({ asked: true });
    save(get());
  },
  setSize: (size) => {
    const s = sanitizeRoomSize(size);
    if (s === null || s === get().size) return;
    set({ size: s });
    save(get());
  },
}));

export const friendsProfile = (): FriendsProfile => useFriendsProfile.getState();

/** The name friends see: YOUR NAME, else the selected driver's. */
export function roomName(profile: Pick<ProfileState, 'drivers' | 'activeDriverId'> = profileState()): string {
  const mine = friendsProfile().name;
  if (mine) return mine;
  return sanitizeRoomName(activeDriver(profile).name) || 'Racer';
}

const OWNER_DRIVER = DEFAULT_DRIVERS[0]!;

/**
 * Ask once for a name before HOST / JOIN: the name friends would see is still the owner's default
 * driver ("Anaye") and this is not the owner's own profile. The owner's profile is recognised by a
 * personalised owner driver (its look changed from the stock one); a fresh install on a friend's phone
 * has the stock look.
 */
export function needsNamePrompt(profile: Pick<ProfileState, 'drivers' | 'activeDriverId'> = profileState()): boolean {
  const fp = friendsProfile();
  if (fp.asked || fp.name) return false;
  const driver = activeDriver(profile);
  if (driver.name.trim().toLowerCase() !== OWNER_DRIVER.name.toLowerCase()) return false;
  const personalised = driver.id === OWNER_DRIVER.id && JSON.stringify(driver.avatar) !== JSON.stringify(OWNER_DRIVER.avatar);
  return !personalised;
}

/**
 * The room this page is seated in, so a reload takes the seat back (Android discards a background
 * tab while its owner shares the link in a chat app; the page then reloads with no `?room=`).
 * Kept in sessionStorage (this tab only: survives a reload or a discarded tab; a new tab does not
 * inherit it, and a duplicated tab, which does, first asks the live tabs over a BroadcastChannel and
 * leaves the seat alone when one holds it, see roomClient) and in localStorage for the installed app (one window, and a
 * relaunch from the recents list starts a new session). `at` is the last moment this page was alive
 * in the room; a reload within the relay's seat grace (ROOM_SEAT_GRACE_MS) re-joins with the token.
 */
export const ROOM_SEAT_STORAGE_KEY = 'gamerfleet.room.v1';

interface SavedSeat {
  code: string;
  at: number;
}

function standalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

function readSeat(storage: Storage | undefined): SavedSeat | null {
  try {
    const raw = storage?.getItem(ROOM_SEAT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return null;
    const { code, at } = parsed as { code?: unknown; at?: unknown };
    return typeof code === 'string' && typeof at === 'number' && Number.isFinite(at) ? { code, at } : null;
  } catch {
    return null;
  }
}

const sessionStore = (): Storage | undefined => {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};
const localStore = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** We are in room `code` right now (called on join and while seated, every few seconds). */
export function rememberSeat(code: string, now: number = Date.now()): void {
  const value = JSON.stringify({ code, at: now } satisfies SavedSeat);
  for (const storage of [sessionStore(), localStore()]) {
    try {
      storage?.setItem(ROOM_SEAT_STORAGE_KEY, value);
    } catch {
      // Private mode / full: a reload just shows the FRIENDS entry screen.
    }
  }
}

/** We left (or were removed, or the room is gone). `thisTabOnly`: another tab or device holds the seat now. */
export function forgetSeat(thisTabOnly = false): void {
  for (const storage of thisTabOnly ? [sessionStore()] : [sessionStore(), localStore()]) {
    try {
      storage?.removeItem(ROOM_SEAT_STORAGE_KEY);
    } catch {
      /* nothing saved */
    }
  }
}

/** The room to take our seat back in after a reload, when this page was in it less than `withinMs` ago. */
export function seatToRestore(withinMs: number, now: number = Date.now()): { code: string; leftMs: number } | null {
  const seat = readSeat(sessionStore()) ?? (standalone() ? readSeat(localStore()) : null);
  if (!seat) return null;
  const age = now - seat.at;
  if (age < 0 || age >= withinMs) return null;
  return { code: seat.code, leftMs: withinMs - age };
}
