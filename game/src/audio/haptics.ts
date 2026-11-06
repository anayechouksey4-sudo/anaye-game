/**
 * navigator.vibrate feedback for phones, rate-limited so it can never buzz continuously:
 *   - a global minimum gap between two vibrations,
 *   - a per-kind cooldown (landings and hits can arrive every frame on rough ground),
 *   - a vibration budget: at most BUDGET_MS of motor-on time in any rolling BUDGET_WINDOW_MS.
 * Only fires when settings.haptics is on, the API exists, the page is visible and the user has
 * interacted with it (Chrome ignores, and warns about, vibrate before the first tap).
 */
import { selectionState } from '../state/selection';

export type HapticKind = 'tick' | 'checkpoint' | 'finish' | 'best' | 'fall' | 'land' | 'hit' | 'go' | 'splash' | 'region' | 'prompt';

/** Patterns, ms (on, off, on…). Landings / hits are scaled by intensity in `buzz`. */
export const HAPTIC_PATTERNS: Readonly<Record<HapticKind, readonly number[]>> = {
  /** Start-light 3 · 2 · 1. */
  tick: [12],
  /** GO. */
  go: [40],
  checkpoint: [24],
  /** Double buzz. */
  finish: [45, 80, 45],
  /** Double buzz and a long one: personal best. */
  best: [45, 80, 45, 80, 110],
  fall: [220],
  land: [30],
  hit: [40],
  /** Open worlds: driving into deep water (a water respawn uses `fall`). */
  splash: [60],
  /** Open worlds: first entry into a region (region card). */
  region: [15],
  /** Open worlds: an event start prompt appeared. */
  prompt: [10],
};

const COOLDOWN_MS: Readonly<Record<HapticKind, number>> = {
  tick: 300,
  go: 300,
  checkpoint: 250,
  finish: 1000,
  best: 1000,
  fall: 800,
  land: 450,
  hit: 300,
  splash: 800,
  region: 1500,
  prompt: 1500,
};

const MIN_GAP_MS = 90;
const BUDGET_WINDOW_MS = 2000;
const BUDGET_MS = 450;
/** Ring of recent vibrations (start time, motor-on ms) for the budget. */
const RING = 16;

export interface HapticsStats {
  supported: boolean;
  fired: number;
  suppressed: number;
  lastKind: HapticKind | null;
  lastPattern: readonly number[] | null;
  lastAt: number;
}

export class Haptics {
  readonly stats: HapticsStats = { supported: false, fired: 0, suppressed: 0, lastKind: null, lastPattern: null, lastAt: 0 };
  private readonly lastByKind = new Map<HapticKind, number>();
  private readonly ringAt = new Float64Array(RING);
  private readonly ringMs = new Float64Array(RING);
  private ringHead = 0;
  private lastAt = -1e9;
  /** Scaled single-pulse patterns for land / hit, reused (no allocation per buzz). */
  private readonly scaled: number[] = [0];

  constructor() {
    this.ringAt.fill(-1e9);
    this.stats.supported = this.available();
  }

  private available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  private activated(): boolean {
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    return activation ? activation.hasBeenActive : true;
  }

  private allowed(): boolean {
    if (!selectionState().settings.haptics || !this.available()) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    return this.activated();
  }

  /** Vibrate for `kind`; `intensity` 0…1 scales land / hit pulses. Returns whether it fired. */
  buzz(kind: HapticKind, intensity = 1): boolean {
    if (!this.allowed()) return false;
    const now = performance.now();
    let pattern = HAPTIC_PATTERNS[kind];
    if (kind === 'land' || kind === 'hit') {
      const k = Math.max(0, Math.min(1, intensity));
      this.scaled[0] = Math.round(pattern[0]! * (0.6 + 0.9 * k));
      pattern = this.scaled;
    }
    let onMs = 0;
    for (let i = 0; i < pattern.length; i += 2) onMs += pattern[i]!;

    const lastOfKind = this.lastByKind.get(kind) ?? -1e9;
    let recent = 0;
    for (let i = 0; i < RING; i++) if (now - this.ringAt[i]! < BUDGET_WINDOW_MS) recent += this.ringMs[i]!;
    const important = kind === 'finish' || kind === 'best' || kind === 'fall';
    if (now - lastOfKind < COOLDOWN_MS[kind] || (!important && now - this.lastAt < MIN_GAP_MS) || recent + onMs > BUDGET_MS + (important ? 250 : 0)) {
      this.stats.suppressed += 1;
      return false;
    }
    let ok = false;
    try {
      ok = navigator.vibrate(pattern as number[]);
    } catch {
      ok = false;
    }
    if (!ok) {
      this.stats.suppressed += 1;
      return false;
    }
    this.lastAt = now;
    this.lastByKind.set(kind, now);
    this.ringAt[this.ringHead] = now;
    this.ringMs[this.ringHead] = onMs;
    this.ringHead = (this.ringHead + 1) % RING;
    this.stats.fired += 1;
    this.stats.lastKind = kind;
    this.stats.lastPattern = pattern === this.scaled ? [this.scaled[0]!] : pattern;
    this.stats.lastAt = now;
    return true;
  }

  /** Stop any running vibration (menu opened, tab hidden, haptics switched off). */
  cancel(): void {
    if (!this.available() || !this.activated()) return;
    try {
      navigator.vibrate(0);
    } catch {
      // ignore
    }
  }
}

type HapticCueListener = (kind: HapticKind) => void;
const cueListeners = new Set<HapticCueListener>();

/**
 * One-shot buzz requested from outside the audio system (HUD: region card, event prompt). Goes
 * through the AudioSystem's Haptics instance, so the same settings switch, cooldowns and vibration
 * budget apply. No listener (audio not mounted) = nothing happens.
 */
export function emitHapticCue(kind: HapticKind): void {
  for (const listener of cueListeners) listener(kind);
}

/** Subscribe to HUD haptic cues (AudioSystem); returns the unsubscribe function. */
export function onHapticCue(listener: HapticCueListener): () => void {
  cueListeners.add(listener);
  return () => {
    cueListeners.delete(listener);
  };
}
