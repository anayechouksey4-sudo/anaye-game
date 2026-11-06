/**
 * Island generator worker: runs the pure generator off the main thread and transfers every typed
 * array back (no copies). Validation is skipped here (the Node test runs the full validator); the
 * caller compares the hash with the pinned golden value instead.
 */
import { generateWorld } from './gen/generateWorld';
import { worldTransferables } from './transfer';

export interface WorldWorkerRequest {
  seed: number;
}

export type WorldWorkerReply =
  | { ok: true; world: ReturnType<typeof generateWorld>; ms: number }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<WorldWorkerRequest>) => {
  try {
    const t0 = performance.now();
    const world = generateWorld(event.data.seed, { validate: false });
    const ms = performance.now() - t0;
    const reply: WorldWorkerReply = { ok: true, world, ms };
    self.postMessage(reply, { transfer: worldTransferables(world) });
  } catch (err) {
    const reply: WorldWorkerReply = { ok: false, error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
    self.postMessage(reply);
  }
};
