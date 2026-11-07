// Skid marks: ring buffer, draw range and the pure rules. Run from the repo root:
//   dashboard/node_modules/.bin/tsx --test game/test/skid.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SkidBuffer } from '../src/car/skid/skidBuffer';
import {
  MARK_ALPHA_MAX,
  MARK_FADE_S,
  MARK_SLIP_FULL,
  MARK_SLIP_START,
  fadeAt,
  markHalfWidth,
  markIntensity,
  markStyle,
  RUBBER,
  ICE_SCUFF,
} from '../src/car/skid/skidRules';
import { readSkidPrefs, DEFAULT_SKID_PREFS } from '../src/car/skid/skidStore';

function quad(b: SkidBuffer, k: number, born: number, alpha = 0.5) {
  b.writeQuad(k, 0, 0, k, 0, 1, k + 1, 0, 1, k + 1, 0, 0, 0.1, 0.1, 0.1, alpha, alpha, born);
}

test('ring buffer: live window, draw range and triangles (no wrap)', () => {
  const b = new SkidBuffer(8);
  assert.equal(b.flush(), 0);
  assert.equal(b.geometry.drawRange.count, 0);
  for (let i = 0; i < 3; i++) quad(b, i, i * 0.1);
  assert.equal(b.live, 3);
  assert.equal(b.head, 3);
  assert.equal(b.tail, 0);
  assert.equal(b.flush(), 6); // 3 quads = 6 triangles
  assert.deepEqual(b.geometry.drawRange, { start: 0, count: 18 });
  // Vertex layout: x y z r g b alpha born, 4 vertices per quad.
  assert.equal(b.data[7], 0); // born of quad 0
  assert.ok(Math.abs(b.data[8 * 4 + 7]! - 0.1) < 1e-6); // born of quad 1 (float32 round trip)
  assert.ok(Math.abs(b.data[8 * 4 * 2 + 7]! - 0.2) < 1e-6);
});

test('ring buffer: overwriting the oldest once full, then the whole ring is drawn', () => {
  const b = new SkidBuffer(4);
  for (let i = 0; i < 4; i++) quad(b, i, i);
  assert.equal(b.live, 4);
  assert.equal(b.head, 0);
  assert.equal(b.tail, 0);
  assert.equal(b.flush(), 8); // wrapped window: full buffer
  assert.deepEqual(b.geometry.drawRange, { start: 0, count: 24 });
  quad(b, 9, 9); // overwrites slot 0
  assert.equal(b.live, 4);
  assert.equal(b.head, 1);
  assert.equal(b.tail, 1);
  assert.equal(b.written, 5);
  assert.equal(b.data[0], 9); // slot 0 now holds the newest quad
  assert.equal(b.flush(), 8);
  // Never more than capacity × 2 triangles whatever is written.
  for (let i = 0; i < 100; i++) quad(b, i, 10 + i);
  assert.equal(b.flush(), 8);
  assert.ok(b.live <= b.capacity);
});

test('ring buffer: expiry retires quads older than MARK_FADE_S and shrinks the draw range', () => {
  const b = new SkidBuffer(16);
  quad(b, 0, 0);
  quad(b, 1, 1);
  quad(b, 2, 5);
  b.expire(MARK_FADE_S + 1.5); // quads born at 0 and 1 are 21.5 / 20.5 s old → gone; 5 is 16.5 s old
  assert.equal(b.live, 1);
  assert.equal(b.tail, 2);
  assert.equal(b.flush(), 2);
  assert.deepEqual(b.geometry.drawRange, { start: 12, count: 6 });
  b.expire(MARK_FADE_S + 5);
  assert.equal(b.live, 0);
  assert.equal(b.newestBorn, -Infinity);
  assert.equal(b.flush(), 0);
  // Expiry across the wrap: fill, retire the early ones, the window [tail, head) wraps → full draw.
  const c = new SkidBuffer(4);
  for (let i = 0; i < 6; i++) quad(c, i, i * 10); // slots: 4→0, 5→1 overwrite; live = 4 (born 20,30,40,50)
  c.expire(20 + MARK_FADE_S); // retires born 20 (slot 2)
  assert.equal(c.live, 3);
  assert.equal(c.tail, 3);
  assert.equal(c.head, 2);
  assert.equal(c.flush(), 8); // window wraps 3,0,1 → whole ring submitted
});

test('ring buffer: clear forgets everything and keeps the memory', () => {
  const b = new SkidBuffer(4);
  const data = b.data;
  for (let i = 0; i < 3; i++) quad(b, i, i);
  b.clear();
  assert.equal(b.live, 0);
  assert.equal(b.written, 0);
  assert.equal(b.head, 0);
  assert.equal(b.flush(), 0);
  assert.equal(b.data, data);
  assert.equal(b.geometry.index!.count, 4 * 6);
});

test('ring buffer: flush uploads one update range covering only what was written', () => {
  const b = new SkidBuffer(8);
  const buffer = (b.geometry.getAttribute('position') as { data: { updateRanges: { start: number; count: number }[] } }).data;
  quad(b, 1, 0);
  quad(b, 2, 0);
  b.flush();
  assert.equal(buffer.updateRanges.length, 1);
  assert.deepEqual(buffer.updateRanges[0], { start: 0, count: 2 * 4 * 8 });
  buffer.updateRanges.length = 0; // what the renderer does after uploading
  b.flush();
  assert.equal(buffer.updateRanges.length, 0); // nothing new → no upload
  quad(b, 3, 0);
  b.flush();
  assert.deepEqual(buffer.updateRanges[0], { start: 2 * 32, count: 32 });
  // Not consumed yet (a frame without a draw): the next flush widens the pending range instead of losing it.
  quad(b, 4, 0);
  b.flush();
  assert.equal(buffer.updateRanges.length, 1);
  assert.deepEqual(buffer.updateRanges[0], { start: 2 * 32, count: 64 });
});

test('rules: intensity from slip, handbrake on the rears, nothing airborne', () => {
  assert.equal(markIntensity(false, 1, 1, true, 20), 0);
  assert.equal(markIntensity(true, MARK_SLIP_START, 0, true, 10), 0);
  assert.equal(markIntensity(true, MARK_SLIP_FULL, 0, false, 10), 1);
  const mid = markIntensity(true, (MARK_SLIP_START + MARK_SLIP_FULL) / 2, 0, true, 10);
  assert.ok(mid > 0.45 && mid < 0.55);
  // A locked rear under the handbrake marks before slip01 saturates; a front does not.
  assert.ok(markIntensity(true, 0, 1, true, 8) >= 0.5);
  assert.equal(markIntensity(true, 0, 1, false, 8), 0);
  assert.equal(markIntensity(true, 0, 1, true, 1), 0); // below HANDBRAKE_MARK_SPEED
  assert.equal(markIntensity(true, 1, 1, true, 8), 1);
  // Gentle cornering (slip01 ≈ 0.05) leaves nothing.
  assert.equal(markIntensity(true, 0.05, 0, true, 30), 0);
});

test('rules: style per surface and the ice map', () => {
  assert.equal(markStyle(null, 1), RUBBER);
  assert.equal(markStyle(null, 0.55), ICE_SCUFF);
  assert.equal(markStyle('asphalt', 0.55), RUBBER); // the island decides per wheel, not per map
  assert.equal(markStyle('snow', 1), ICE_SCUFF);
  assert.equal(markStyle('salt', 1), ICE_SCUFF);
  assert.ok(markStyle('dirt', 1).alpha < 1 && markStyle('sand', 1).r > RUBBER.r);
  assert.ok(ICE_SCUFF.alpha * MARK_ALPHA_MAX < 0.3);
});

test('rules: strip width and fade', () => {
  assert.equal(markHalfWidth(0.3, 1), 0.15); // rolling straight: full tyre width
  assert.ok(Math.abs(markHalfWidth(0.3, 0) - 0.09) < 1e-9); // sideways: the patch length (0.6 × width)
  assert.equal(markHalfWidth(0.3, -1), 0.15); // reversing is the same width
  assert.equal(fadeAt(0), 1);
  assert.equal(fadeAt(MARK_FADE_S / 2), 1);
  assert.ok(Math.abs(fadeAt(MARK_FADE_S * 0.75) - 0.5) < 1e-9);
  assert.equal(fadeAt(MARK_FADE_S), 0);
  assert.equal(fadeAt(MARK_FADE_S + 10), 0);
});

test('store: saved prefs are validated field by field', () => {
  assert.deepEqual(readSkidPrefs(null), DEFAULT_SKID_PREFS);
  assert.deepEqual(readSkidPrefs({ marks: false }), { marks: false });
  assert.deepEqual(readSkidPrefs({ marks: 'no' }), { marks: true });
  assert.deepEqual(readSkidPrefs('junk'), { marks: true });
});
