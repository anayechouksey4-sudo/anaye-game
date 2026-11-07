/**
 * `window.__SKID__` — read-mostly diagnostics for the skid marks (ring-buffer state, what the
 * next draw submits, the mark clock) plus `setEnabled(on)`, the same switch as SETTINGS · SKID
 * MARKS, so a headless check can A/B the same frame with and without marks. Installed by the
 * mounted SkidMarks.
 */
export interface SkidDebugStats {
  /** The SKID MARKS setting. */
  enabled: boolean;
  /** Quads the ring holds at most. */
  capacity: number;
  /** Quads in the live window (not yet retired). */
  live: number;
  /** Quads written since the marks were last cleared. */
  written: number;
  head: number;
  tail: number;
  /** The mesh will be drawn next frame (≥ 1 live quad). */
  visible: boolean;
  /** Triangles the next draw submits (the live window, or the whole ring while it wraps). */
  triangles: number;
  /** Mark clock, s (advances only while the game is not paused). */
  now: number;
  /** Age of the newest quad, s (null when empty). */
  newestAgeS: number | null;
  /** Map the marks belong to. */
  trackId: string | null;
  /** Seconds a mark lives. */
  fadeS: number;
  /** Per wheel: a strip is being laid right now. */
  laying: boolean[];
}

export interface SkidDebugHandle {
  stats(): SkidDebugStats | null;
  /** Same as the SETTINGS toggle (persists). */
  setEnabled(on: boolean): void;
  /** Forget every mark (what a map switch does). */
  clear(): void;
}

declare global {
  interface Window {
    __SKID__?: SkidDebugHandle;
  }
}

/** Providers filled by the mounted SkidMarks. */
export const skidDebug: { stats: (() => SkidDebugStats) | null; clear: (() => void) | null } = { stats: null, clear: null };
