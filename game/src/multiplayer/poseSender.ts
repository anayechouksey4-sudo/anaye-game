/**
 * Sends our car's pose at ROOM_POSE_INTERVAL_MS (~15 Hz) while in a room: position, quaternion,
 * speed, steer, the last gate passed and the route progress (rivals/standings' projection, the
 * same number the standings rank us by). Paused while the tab is hidden (a hidden page's timers
 * are throttled anyway and the car is auto-paused), resumed with a fresh sample on return.
 */
import { ROOM_POSE_INTERVAL_MS, type OutgoingMessage } from '@shared/protocol';
import { carRuntime } from '../car/runtime';
import { gameState } from '../state/store';

export interface PoseSenderOptions {
  send: (message: OutgoingMessage) => boolean;
  /** Relay clock, ms. */
  now: () => number;
  /** Metres along the race route for the player (0 when unknown). */
  progress: () => number;
  intervalMs?: number;
}

export interface PoseSender {
  start(): void;
  stop(): void;
  readonly running: boolean;
  readonly stats: { sent: number; bytes: number; skippedHidden: number };
}

export function createPoseSender(options: PoseSenderOptions): PoseSender {
  const intervalMs = options.intervalMs ?? ROOM_POSE_INTERVAL_MS;
  const stats = { sent: 0, bytes: 0, skippedHidden: 0 };
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      stats.skippedHidden += 1;
      return;
    }
    if (!carRuntime.ready) return;
    const p = carRuntime.position;
    const q = carRuntime.quaternion;
    const message: OutgoingMessage = {
      type: 'room:pose',
      t: Math.round(options.now()),
      p: [round2(p.x), round2(p.y), round2(p.z)],
      q: [round4(q.x), round4(q.y), round4(q.z), round4(q.w)],
      s: Math.round(carRuntime.speedKmh * 10) / 10,
      st: Math.round(carRuntime.steer * 100) / 100,
      g: gameState().run.checkpoint,
      pm: Math.round(options.progress() * 10) / 10,
    };
    if (options.send(message)) {
      stats.sent += 1;
      stats.bytes += JSON.stringify(message).length + 24; // + envelope (v, seq, sentAt)
    }
  };

  return {
    start() {
      if (timer) return;
      timer = setInterval(tick, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    get running() {
      return timer !== null;
    },
    stats,
  };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;
