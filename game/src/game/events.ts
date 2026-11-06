/**
 * Tiny typed event bus for discrete game moments that non-React code (hazards, the car
 * controller, the camera) must react to. Fast-changing state lives in `car/runtime.ts`,
 * persistent state in the zustand store — this is only for "something just happened".
 */

/** 'water' | 'bounds' | 'stuck' | 'travel' are only ever emitted by open worlds. */
export type RespawnReason = 'fall' | 'manual' | 'flipped' | 'debug' | 'water' | 'bounds' | 'stuck' | 'travel';

export interface GameEventMap {
  /** Full run reset: back to checkpoint 0, timer cleared. Hazards should reset completely. */
  restart: { trackId: string | null };
  /** Car is being put back at `checkpoint` (index into TrackLayout.checkpoints). */
  respawn: { checkpoint: number; reason: RespawnReason };
  /** The car body was moved discontinuously (respawn/restart/teleport) — cameras should snap. */
  teleported: { position: [number, number, number]; yaw: number };
  /** Car crossed checkpoint `index` (1…n-1) or the finish (index = totalCheckpoints). */
  checkpoint: { index: number; elapsedMs: number };
  finish: { elapsedMs: number; bestMs: number | null; isBest: boolean };
  /**
   * Start lights at the beginning of a run (first load, restart, map or car change; never on a
   * respawn): 3, 2, 1, then 0 = GO, one step every COUNTDOWN_STEP_S of simulated time
   * (game/countdown.ts). Throttle does nothing and the timer waits until GO.
   */
  countdown: { step: 3 | 2 | 1 | 0 };
}

export type GameEventType = keyof GameEventMap;
type Handler<K extends GameEventType> = (payload: GameEventMap[K]) => void;

const handlers: { [K in GameEventType]?: Set<Handler<K>> } = {};

/** Subscribe; returns the unsubscribe function (use it as an effect cleanup). */
export function onGameEvent<K extends GameEventType>(type: K, handler: Handler<K>): () => void {
  let set = handlers[type] as Set<Handler<K>> | undefined;
  if (!set) {
    set = new Set();
    (handlers as Record<K, Set<Handler<K>>>)[type] = set;
  }
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}

export function emitGameEvent<K extends GameEventType>(type: K, payload: GameEventMap[K]): void {
  const set = handlers[type] as Set<Handler<K>> | undefined;
  if (!set) return;
  // Copy so handlers may unsubscribe while being notified.
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[events] ${type} handler failed`, err);
    }
  }
}
