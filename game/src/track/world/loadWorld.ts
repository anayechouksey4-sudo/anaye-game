/**
 * Island data loader: generates Tessera Isle once per page in a module Worker (main-thread fallback
 * when Worker is missing or fails) and caches the result, so leaving and re-entering the island, or
 * switching between its entries, never regenerates. `?worldgen=main` forces the fallback (tests).
 */
import { getQueryParam } from '../../config';
import type { WorldData } from './gen/types';
import { TESSERA_HASH, TESSERA_SEED } from './golden';
import type { WorldWorkerReply } from './world.worker';

export interface LoadedWorld {
  data: WorldData;
  where: 'worker' | 'main';
  /** Generator time inside the worker / on the main thread, ms. */
  genMs: number;
  /** Request → data in hand (worker start-up and transfer included), ms. */
  wallMs: number;
  hashOk: boolean;
}

let cache: Promise<LoadedWorld> | null = null;
let loaded: LoadedWorld | null = null;
let startedAt = 0;
/** Number of generations started on this page (A3: switching entries must not add any). */
let generations = 0;

export const cachedWorld = (): LoadedWorld | null => loaded;
export const worldGenerations = (): number => generations;

/** Estimated generation progress 0…1 (time based; the generator reports no steps). */
export function loadProgress(): number {
  if (loaded) return 1;
  if (!cache) return 0;
  const t = performance.now() - startedAt;
  return Math.min(0.97, 1 - Math.exp(-t / 1100));
}

export function loadWorld(): Promise<LoadedWorld> {
  if (cache) return cache;
  startedAt = performance.now();
  generations++;
  cache = generate().then(
    (result) => {
      loaded = result;
      if (!result.hashOk) console.warn(`[world] Tessera Isle hash ${result.data.hash} differs from the pinned ${TESSERA_HASH}`);
      return result;
    },
    (err: unknown) => {
      cache = null;
      throw err;
    },
  );
  return cache;
}

async function generate(): Promise<LoadedWorld> {
  if (getQueryParam('worldgen') !== 'main' && typeof Worker !== 'undefined') {
    try {
      return await viaWorker();
    } catch (err) {
      console.warn('[world] worker generation failed; generating on the main thread', err);
    }
  }
  return viaMain();
}

function viaWorker(): Promise<LoadedWorld> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module', name: 'tessera-gen' });
    worker.onmessage = (event: MessageEvent<WorldWorkerReply>) => {
      worker.terminate();
      const reply = event.data;
      if (!reply.ok) {
        reject(new Error(reply.error));
        return;
      }
      resolve({ data: reply.world, where: 'worker', genMs: reply.ms, wallMs: performance.now() - t0, hashOk: reply.world.hash === TESSERA_HASH });
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      reject(new Error(event.message || 'world worker failed to start'));
    };
    worker.postMessage({ seed: TESSERA_SEED });
  });
}

async function viaMain(): Promise<LoadedWorld> {
  const t0 = performance.now();
  const { generateWorld } = await import('./gen/generateWorld');
  const g0 = performance.now();
  const data = generateWorld(TESSERA_SEED, { validate: false });
  const t1 = performance.now();
  return { data, where: 'main', genMs: t1 - g0, wallMs: t1 - t0, hashOk: data.hash === TESSERA_HASH };
}
