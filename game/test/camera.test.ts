/**
 * SETTINGS · CAMERA survives a reload (state/store.ts): the mode is read from localStorage when the
 * store is created and written by setCameraMode / cycleCamera (the C key).
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/camera.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

const KEY = 'gamerfleet.camera.v1';
const memory = new Map<string, string>([[KEY, 'orbit']]);
const localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, String(v)),
  removeItem: (k: string) => void memory.delete(k),
};
// A stored choice from an earlier visit, in place before the store module loads.
(globalThis as unknown as { window: unknown }).window = { localStorage, location: { search: '', hash: '', href: 'http://localhost/', hostname: 'localhost', protocol: 'http:', port: '', origin: 'http://localhost' } };

test('the stored camera mode is the starting one, and every change is stored', async () => {
  const { gameState } = await import('../src/state/store');
  assert.equal(gameState().ui.cameraMode, 'orbit');
  gameState().setCameraMode('hood');
  assert.equal(gameState().ui.cameraMode, 'hood');
  assert.equal(memory.get(KEY), 'hood');
  gameState().cycleCamera();
  assert.equal(gameState().ui.cameraMode, 'chase');
  assert.equal(memory.get(KEY), 'chase');
});
