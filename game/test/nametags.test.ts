/**
 * Name-tag layout (rivals/nameTags.ts, node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/nametags.test.ts
 *
 * - pills that would cover each other stack upward (≤ 3 rows, ≤ 48 px); a fourth, or one that would
 *   need more than 48 px, hides (the farther one goes)
 * - a pill outside the layer's box or on a thumb control is not drawn
 * - two cars within 2 m fade the farther pill
 * - side-by-side pills keep their order from one frame to the next
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FADE_NEAR_M,
  MAX_PUSH_PX,
  MAX_ROWS,
  clearTagBounds,
  layoutTags,
  registerTag,
  setTagBounds,
  setTagExclusions,
  setTagProjection,
  setTagSize,
  tagList,
  unregisterTag,
  updateTag,
} from '../src/rivals/nameTags';

const W = 800;
const H = 400;
const PILL_W = 80;
const PILL_H = 18;

function fresh(n: number, texts = ['TARMAC TEJ', 'VOLT', 'PIXEL RAE', 'MX. GLITCH', 'NOVA']): number[] {
  for (const t of tagList()) if (t.active) unregisterTag(t.id);
  clearTagBounds();
  setTagExclusions([]);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = registerTag(texts[i]!, '#fff');
    setTagSize(id, PILL_W, PILL_H);
    updateTag(id, i * 10, 0, 0); // 10 m apart in the world by default (no fading)
    ids.push(id);
  }
  return ids;
}

const box = (id: number) => {
  const t = tagList()[id]!;
  return { l: t.sx - (t.w * t.scale) / 2, r: t.sx + (t.w * t.scale) / 2, top: t.y - t.h * t.scale, bottom: t.y };
};
const overlap = (a: number, b: number) => {
  const p = box(a), q = box(b);
  return Math.min(p.r, q.r) - Math.max(p.l, q.l) > 0 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 0;
};

test('three pills on one anchor stack upward without overlapping; a fourth hides', () => {
  const ids = fresh(4);
  for (const id of ids) setTagProjection(id, 400, 200, 0.99);
  layoutTags(W, H);
  const shown = ids.filter((id) => tagList()[id]!.shown);
  assert.equal(shown.length, MAX_ROWS, `${MAX_ROWS} rows, got ${shown.length}`);
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) assert.ok(!overlap(shown[i]!, shown[j]!), `pills ${i} and ${j} overlap`);
  const rows = shown.map((id) => tagList()[id]!.row).sort();
  assert.deepEqual(rows, [0, 1, 2]);
  const bottoms = shown.map((id) => tagList()[id]!.y);
  assert.ok(Math.max(...bottoms) - Math.min(...bottoms) <= MAX_PUSH_PX, 'the stack stays within the push limit');
});

test('a pill that cannot be stacked within the limits hides, and it is the farther one', () => {
  const ids = fresh(2);
  setTagSize(ids[0]!, PILL_W, 50); // tall pills: stacking one over the other needs 52 px > MAX_PUSH_PX
  setTagSize(ids[1]!, PILL_W, 50);
  setTagProjection(ids[0]!, 400, 200, 0.995); // farther (same anchor: placed first by rank)
  setTagProjection(ids[1]!, 400, 200, 0.99); // nearer
  layoutTags(W, H);
  const a = tagList()[ids[0]!]!, b = tagList()[ids[1]!]!;
  assert.equal(a.shown || b.shown, true, 'one pill stays');
  assert.equal(a.shown && b.shown, false, 'the other hides');
  assert.equal(b.shown, true, 'the nearer car keeps its name');
});

test('pills outside the layer box or on a thumb control are not drawn', () => {
  const ids = fresh(3);
  setTagBounds(0, 60, W, H - 60 - 20); // under a 60 px bar, above a 20 px margin
  setTagExclusions([{ left: 0, top: 300, right: 200, bottom: H }]); // a steer pad at the bottom left
  setTagProjection(ids[0]!, 400, 70, 0.99); // top edge inside the bar band (pill top at 52 < 60)
  setTagProjection(ids[1]!, 100, 350, 0.99); // on the steer pad
  setTagProjection(ids[2]!, 400, 250, 0.99); // in the open
  layoutTags(W, H);
  assert.equal(tagList()[ids[0]!]!.shown, false, 'under the bar');
  assert.equal(tagList()[ids[1]!]!.shown, false, 'on the steer pad');
  assert.equal(tagList()[ids[2]!]!.shown, true, 'in the open');
});

test('cars within 2 m fade the farther pill; apart they do not', () => {
  const ids = fresh(2);
  setTagProjection(ids[0]!, 300, 200, 0.99);
  setTagProjection(ids[1]!, 500, 200, 0.995);
  updateTag(ids[0]!, 0, 0, 0);
  updateTag(ids[1]!, FADE_NEAR_M / 2, 0, 0);
  layoutTags(W, H);
  assert.equal(tagList()[ids[0]!]!.opacity, 1, 'the nearer pill stays opaque');
  const far = tagList()[ids[1]!]!.opacity;
  assert.ok(far < 1 && far > 0.3, `the farther pill fades (${far})`);
  updateTag(ids[1]!, FADE_NEAR_M * 2, 0, 0);
  layoutTags(W, H);
  assert.equal(tagList()[ids[1]!]!.opacity, 1);
});

test('side-by-side pills keep last frame\'s order when their anchors jitter', () => {
  const ids = fresh(2);
  setTagProjection(ids[0]!, 400, 200, 0.99);
  setTagProjection(ids[1]!, 420, 203, 0.99);
  layoutTags(W, H);
  const rowA = tagList()[ids[0]!]!.row, rowB = tagList()[ids[1]!]!.row;
  assert.notEqual(rowA, rowB);
  // Next frame: the anchors swap by a few pixels; the rows must not swap.
  setTagProjection(ids[0]!, 400, 203, 0.99);
  setTagProjection(ids[1]!, 420, 200, 0.99);
  layoutTags(W, H);
  assert.equal(tagList()[ids[0]!]!.row, rowA);
  assert.equal(tagList()[ids[1]!]!.row, rowB);
  assert.ok(!overlap(ids[0]!, ids[1]!));
});
