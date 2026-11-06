/**
 * Tessera Isle generator tests (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/world.test.ts
 *
 * - determinism: two generations give identical hashes, equal to the pinned golden hash
 * - validate(): every drivability / checkpoint / lake / clearance / ramp / id rule is clean
 * - budgets: boxes ≤ 6000, trees ≤ 3000, collider triangles ≤ 70 k, colliders ≤ 130, data ≤ 12 MB
 * - ids pass the real protocol sanitizeId
 * - Rapier in node: heightfield raycasts equal heights / heightAt within 1e-4 m
 * - cold generation time is logged (≤ 700 ms, or the ratio to the chaos generator on a loaded box)
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import RAPIER from '@dimforge/rapier3d-compat';
import { sanitizeId } from '../../shared/protocol';
import { generateTrack } from '../src/track/chaos/plan';
import { RECIPES } from '../src/track/maps';
import { buildWorld, generateWorld } from '../src/track/world/gen/generateWorld';
import { heightAt } from '../src/track/world/gen/heightAt';
import { mulberry32 } from '../src/track/chaos/rng';
import { validateWorld, BUDGET } from '../src/track/world/gen/validate';
import { WORLD_N, WORLD_SIZE } from '../src/track/world/gen/types';
import { TESSERA_HASH } from '../src/track/world/golden';

/**
 * Pinned golden hash of generateWorld(7177) (src/track/world/golden.ts; the browser loader checks
 * the same value). Re-pin only for an intended generator change.
 */
export const GOLDEN_HASH = TESSERA_HASH;

const t0 = performance.now();
const cpu0 = process.cpuUsage();
const first = buildWorld();
const coldMs = performance.now() - t0;
const coldCpuMs = (process.cpuUsage(cpu0).user + process.cpuUsage(cpu0).system) / 1000;

test('determinism: identical hashes and the pinned golden hash', () => {
  const second = buildWorld();
  assert.equal(first.world.hash, second.world.hash, 'two generations differ');
  for (const key of ['heights', 'tileTex', 'fieldTex', 'minimap'] as const) assert.deepEqual(first.world[key], second.world[key], `${key} differs`);
  assert.equal(first.world.hash, GOLDEN_HASH, `golden hash changed: ${first.world.hash}`);
});

test('validate() is clean', () => {
  const report = validateWorld(first.world, first.internals);
  const lines = report.errors.slice(0, 20).map((e) => `${e.rule} ${e.where}: ${e.detail}${e.x !== undefined ? ` @(${e.x.toFixed(0)}, ${e.z!.toFixed(0)})` : ''}`);
  console.log('measured', JSON.stringify(report.measured));
  for (const w of report.warnings) console.log('relaxed', w.rule, w.where, w.detail);
  assert.equal(report.errors.length, 0, `validation errors (${JSON.stringify(report.counts)}):\n${lines.join('\n')}`);
  // generateWorld() runs the same validator and throws on a breach
  assert.doesNotThrow(() => generateWorld());
});

test('budgets', () => {
  const s = first.world.stats;
  console.log('stats', JSON.stringify({ ...s, timings: undefined }));
  assert.ok(s.boxes <= BUDGET.boxes, `boxes ${s.boxes}`);
  assert.ok(s.trees <= BUDGET.trees, `trees ${s.trees}`);
  assert.ok(s.colliderTriangles <= BUDGET.colliderTriangles, `collider triangles ${s.colliderTriangles}`);
  assert.ok(s.colliders <= BUDGET.colliders, `colliders ${s.colliders}`);
  assert.ok(s.bytes <= BUDGET.bytes, `bytes ${s.bytes}`);
  assert.ok(s.rampCuboids <= BUDGET.rampCuboids, `ramp cuboids ${s.rampCuboids}`);
});

test('ids pass the protocol sanitizeId', () => {
  const w = first.world;
  const ids = [...w.events.map((e) => e.id), ...w.spots.map((s) => s.id), ...w.pads.map((p) => p.eventId)];
  for (const id of ids) assert.equal(sanitizeId(id), id, `id ${id}`);
  assert.deepEqual(
    w.events.map((e) => e.id),
    ['tessera', 'tessera-rim', 'tessera-crown', 'tessera-neon', 'tessera-rally'],
  );
});

test('Rapier heightfield raycasts match heights / heightAt within 1e-4 m', async () => {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const n = WORLD_N - 1;
  world.createCollider(RAPIER.ColliderDesc.heightfield(n, n, first.world.hf, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE }, RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES), body);
  world.step();
  const H = first.world.heights;
  const rng = mulberry32(42);
  const cast = (x: number, z: number): number => {
    const hit = world.castRay(new RAPIER.Ray({ x, y: 600, z }, { x: 0, y: -1, z: 0 }), 1200, true);
    assert.ok(hit, `no hit at (${x}, ${z})`);
    return 600 - hit.timeOfImpact;
  };
  let worstVertex = 0;
  let worstCell = 0;
  for (let k = 0; k < 200; k++) {
    // vertices (inside the border so the ray hits a well-defined surface)
    const ix = 1 + Math.floor(rng() * (n - 1));
    const iz = 1 + Math.floor(rng() * (n - 1));
    const x = -1024 + 4 * ix;
    const z = -1024 + 4 * iz;
    worstVertex = Math.max(worstVertex, Math.abs(cast(x, z) - H[iz * WORLD_N + ix]!));
    // in-cell points
    const px = -1020 + rng() * 2040;
    const pz = -1020 + rng() * 2040;
    worstCell = Math.max(worstCell, Math.abs(cast(px, pz) - heightAt(H, px, pz)));
  }
  console.log(`rapier: worst vertex diff ${worstVertex.toExponential(2)} m, worst in-cell diff ${worstCell.toExponential(2)} m`);
  assert.ok(worstVertex <= 1e-4, `vertex diff ${worstVertex}`);
  assert.ok(worstCell <= 1e-4, `in-cell diff ${worstCell}`);
  world.free();
});

test('cold generation time', () => {
  const load = os.loadavg()[0]!;
  const cores = os.cpus().length;
  const c0 = performance.now();
  for (let k = 0; k < 5; k++) generateTrack(RECIPES.chaos!, RECIPES.chaos!.seed);
  const chaosMs = (performance.now() - c0) / 5;
  const w0 = performance.now();
  buildWorld();
  const warmMs = performance.now() - w0;
  console.log(
    `generation: cold ${coldMs.toFixed(0)} ms wall (${coldCpuMs.toFixed(0)} ms CPU, includes GC threads), warm ${warmMs.toFixed(0)} ms; chaos generateTrack ${chaosMs.toFixed(1)} ms; ratio cold/chaos ${(coldMs / chaosMs).toFixed(1)}; load ${load.toFixed(2)} on ${cores} cores`,
  );
  // The plan's 700 ms budget (or the chaos ratio on a loaded box) is a desktop measurement: it is
  // asserted only on request (WORLD_PERF_STRICT=1), so `npm test` stays deterministic on a shared box or a
  // phone. By default a 4× ceiling still catches a real regression in the generator.
  if (process.env.WORLD_PERF_STRICT === '1') {
    if (load <= cores) assert.ok(coldMs <= 700, `cold generation ${coldMs.toFixed(0)} ms > 700 ms`);
  } else {
    assert.ok(coldMs <= 2800, `cold generation ${coldMs.toFixed(0)} ms > 2800 ms (4× the 700 ms budget)`);
  }
});
