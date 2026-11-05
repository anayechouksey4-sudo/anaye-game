import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Run `callback` on requestAnimationFrame (optionally throttled). Fast-changing HUD numbers
 * write straight into DOM refs from here, so React never re-renders at 60 Hz.
 */
export function useRafLoop(callback: (now: number) => void, intervalMs = 0): void {
  const cb = useRef(callback);
  useLayoutEffect(() => {
    cb.current = callback;
  });
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < intervalMs) return;
      last = now;
      cb.current(now);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [intervalMs]);
}

/** Write text only when it changed (avoids layout work every frame). */
export function setText(el: HTMLElement | null, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/** Set a 0…1 bar fill via a CSS custom property. */
export function setFill(el: HTMLElement | null, fraction: number): void {
  if (!el) return;
  const v = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
  if (el.style.getPropertyValue('--fill') !== v) el.style.setProperty('--fill', v);
}

export function toggleClass(el: HTMLElement | null, name: string, on: boolean): void {
  if (el && el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

/** m:ss.mmm */
export function formatRaceTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '-:--.---';
  const total = Math.max(0, Math.round(ms));
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

/** Signed force in kN with one decimal, e.g. "+3.4" / "−1.2". */
export function formatKiloNewton(n: number): string {
  const kn = n / 1000;
  const sign = kn > 0.05 ? '+' : kn < -0.05 ? '−' : ' ';
  return `${sign}${Math.abs(kn).toFixed(1)}`;
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}
