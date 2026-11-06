/**
 * `window.__AUDIO__` — live, read-only view of the sound and haptics system for tests and the
 * console. One object, mutated in place by the audio loop (no per-frame allocation).
 */
import type { HapticsStats } from './haptics';

export type AudioRunState = 'locked' | 'unsupported' | AudioContextState | 'interrupted';

export interface AudioDebug {
  /** 'locked' until the first tap / key creates the AudioContext, then the context's state. */
  state: AudioRunState;
  /** The context has been running at least once (the first gesture unlocked it). */
  unlocked: boolean;
  /** Sound switched off or volume 0 (master gain heading to 0). */
  muted: boolean;
  sound: boolean;
  volume: number;
  /** Master gain target (MASTER_LEVEL · volume², 0 when muted). */
  master: number;
  /** Menu duck factor target (1 = not ducked). */
  duck: number;
  menuOpen: boolean;
  hidden: boolean;
  /** Engine preset in use and the car it was chosen for. */
  preset: string;
  carId: string;
  engine: {
    rpm: number;
    /** 1…n, −1 = reverse. */
    gear: number;
    /** Firing frequency, Hz (the engine's fundamental). */
    freq: number;
    load: number;
    limiter: boolean;
    shifting: boolean;
    redline: number;
    gears: number;
    /** Top speed the gearing is fitted to, km/h. */
    topKmh: number;
    shifts: number;
  };
  /** Tyre squeal level 0…1 (before the mix gain). */
  squeal: number;
  /** Wind level 0…1. */
  wind: number;
  /** Road rumble level 0…1. */
  road: number;
  impacts: { landings: number; hits: number; lastKind: 'land' | 'hit' | null; lastIntensity: number };
  /** One-shots actually played (context running, sound on). */
  sfx: Record<'countdown' | 'go' | 'checkpoint' | 'finish' | 'fall' | 'respawn' | 'impact' | 'pop' | 'blowoff', number>;
  haptics: HapticsStats;
  /** Audio loop updates (≈ 30–60 per second while visible). */
  frames: number;
  /** Persistent nodes in the graph (excludes short-lived one-shots). */
  nodes: number;
  /** Live master gain AudioParam value (0 before the context exists). */
  readonly masterValue: number;
  /** Live duck gain AudioParam value. */
  readonly duckValue: number;
  /** Context time, s (advances only while running). */
  readonly time: number;
}

declare global {
  interface Window {
    __AUDIO__?: AudioDebug;
  }
}

export function installAudioDebug(debug: AudioDebug): () => void {
  if (typeof window === 'undefined') return () => {};
  window.__AUDIO__ = debug;
  return () => {
    if (window.__AUDIO__ === debug) delete window.__AUDIO__;
  };
}
