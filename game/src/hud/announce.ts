/**
 * The owner's announcement (server:announce from the relay; AnnounceBanner.tsx draws it).
 *
 * - shown once per id: the relay re-sends the active one after every welcome, so a reconnect does not
 *   bring back a banner the player closed (closed ids are kept in localStorage, the last few only);
 * - hidden at the relay's `until`: the time left is `until - serverNow` from the same frame, so the
 *   device clock does not matter; capped at the longest announcement the relay allows;
 * - `text: ''` hides the banner at once (the owner cleared it);
 * - the text is plain text: React renders it as a text node, never as markup.
 */
import { create } from 'zustand';
import { ANNOUNCE_MAX_MINUTES, sanitizeAnnounceText, type AnnounceMessage } from '@shared/protocol';

export interface Announcement {
  id: string;
  text: string;
  /** performance.now() when it goes away on its own. */
  endsAt: number;
}

interface AnnounceState {
  current: Announcement | null;
}

export const useAnnounce = create<AnnounceState>()(() => ({ current: null }));

/** localStorage: ids of announcements this device closed (newest last, at most CLOSED_KEEP). */
export const ANNOUNCE_CLOSED_KEY = 'gamerfleet.announce.closed.v1';
const CLOSED_KEEP = 8;
/** Longest an announcement can stay up, plus a little slack for the relay's rounding. */
const MAX_SHOW_MS = ANNOUNCE_MAX_MINUTES * 60_000 + 5_000;

let timer: ReturnType<typeof setTimeout> | null = null;
let closedIds: string[] | null = null;

const monotonic = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function closed(): string[] {
  if (closedIds) return closedIds;
  closedIds = [];
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(ANNOUNCE_CLOSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) closedIds = parsed.filter((v): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(v)).slice(-CLOSED_KEEP);
  } catch {
    /* unreadable: start empty */
  }
  return closedIds;
}

function rememberClosed(id: string): void {
  const list = closed().filter((v) => v !== id);
  list.push(id);
  closedIds = list.slice(-CLOSED_KEEP);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(ANNOUNCE_CLOSED_KEY, JSON.stringify(closedIds));
  } catch {
    /* private mode: closed for this visit */
  }
}

function clearTimer(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function hide(): void {
  clearTimer();
  if (useAnnounce.getState().current) useAnnounce.setState({ current: null });
}

/** A server:announce frame arrived (`now` = performance.now()). */
export function receiveAnnounce(message: Pick<AnnounceMessage, 'id' | 'text' | 'until' | 'serverNow'>, now: number = monotonic()): void {
  const text = sanitizeAnnounceText(message.text);
  const left = message.until - message.serverNow;
  if (text === null || text === '' || !(left > 0)) {
    // Cleared by the owner (or already over): hide now.
    if (text === '' || useAnnounce.getState().current?.id === message.id) hide();
    return;
  }
  if (closed().includes(message.id)) return;
  const showMs = Math.min(left, MAX_SHOW_MS);
  const current = useAnnounce.getState().current;
  const endsAt = now + showMs;
  if (!current || current.id !== message.id || current.text !== text || Math.abs(current.endsAt - endsAt) > 1000) {
    useAnnounce.setState({ current: { id: message.id, text, endsAt } });
  }
  clearTimer();
  timer = setTimeout(() => {
    timer = null;
    tickAnnounce();
  }, showMs);
  (timer as { unref?: () => void }).unref?.();
}

/** Hide the banner once its time is up (the timer calls this; tests call it with their own clock). */
export function tickAnnounce(now: number = monotonic()): void {
  const current = useAnnounce.getState().current;
  if (current && now >= current.endsAt - 5) hide();
}

/** ✕: close it on this device (it does not come back for this id). */
export function dismissAnnounce(): void {
  const current = useAnnounce.getState().current;
  if (current) rememberClosed(current.id);
  hide();
}

/** Tests: a fresh page. */
export function resetAnnounceForTests(): void {
  clearTimer();
  closedIds = null;
  useAnnounce.setState({ current: null });
}
