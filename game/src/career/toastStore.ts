/**
 * The TROPHY toast queue: one toast at a time, TOAST_MS each, the rest wait. Shown by
 * career/TrophyToast.tsx; fed by career/tracking.ts on every unlock.
 */
import { create } from 'zustand';

export const TOAST_MS = 3000;

export interface ToastItem {
  trophyId: string;
  /** Serial, so the same trophy could in theory show twice (it cannot unlock twice). */
  serial: number;
}

interface ToastState {
  current: ToastItem | null;
  queue: ToastItem[];
}

export const useTrophyToast = create<ToastState>()(() => ({ current: null, queue: [] }));

let serial = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function showNext(): void {
  const { queue } = useTrophyToast.getState();
  const next = queue[0] ?? null;
  useTrophyToast.setState({ current: next, queue: next ? queue.slice(1) : queue });
  if (!next) {
    timer = null;
    return;
  }
  timer = setTimeout(showNext, TOAST_MS);
}

export function enqueueTrophyToast(trophyId: string): void {
  const item: ToastItem = { trophyId, serial: ++serial };
  const s = useTrophyToast.getState();
  if (s.current === null && timer === null) {
    useTrophyToast.setState({ current: item });
    timer = setTimeout(showNext, TOAST_MS);
    return;
  }
  useTrophyToast.setState({ queue: [...s.queue, item] });
}

/** Tests / reset: drop everything. */
export function clearTrophyToasts(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  useTrophyToast.setState({ current: null, queue: [] });
}
