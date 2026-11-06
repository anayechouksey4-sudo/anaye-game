/**
 * Number-plate text rules (node only, no DOM):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/plates.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLYPH_CHARS, GLYPH_COLS, GLYPH_ROWS, glyphRows, textCells } from '../src/car/plates/plateFont';
import { PLATE_MAX_LENGTH, isNormalizedPlate, normalizePlate, randomPlate } from '../src/car/plates/plateText';

test('normalizePlate: the owner plate is kept exactly, upper-casing and separators are forgiving', () => {
  assert.equal(normalizePlate('UK 07 DW 2400'), 'UK 07 DW 2400');
  assert.equal(normalizePlate('uk 07 dw 2400'), 'UK 07 DW 2400');
  assert.equal(normalizePlate('UK-07-DW-2400'), 'UK 07 DW 2400');
  assert.equal(normalizePlate('UK_07.DW/2400'), 'UK 07 DW 2400');
  assert.equal(normalizePlate('  UK   07  DW 2400  '), 'UK 07 DW 2400');
  assert.equal(normalizePlate('UK 07 DW 2400').length, 13);
});

test('normalizePlate: anything but A–Z 0–9 and spaces is dropped, empty means default', () => {
  assert.equal(normalizePlate('NÉON ★ 001!'), 'NON 001');
  assert.equal(normalizePlate('<script>'), 'SCRIPT');
  assert.equal(normalizePlate('😀😀'), '');
  assert.equal(normalizePlate('   '), '');
  assert.equal(normalizePlate(''), '');
  assert.equal(normalizePlate(undefined), '');
  assert.equal(normalizePlate(null), '');
  assert.equal(normalizePlate(42), '');
});

test('normalizePlate: at most 14 characters, cut on the right, never ending in a space', () => {
  assert.equal(PLATE_MAX_LENGTH, 14);
  assert.equal(normalizePlate('ABCDEFGHIJKLMNOPQRS'), 'ABCDEFGHIJKLMN');
  assert.equal(normalizePlate('ABCDEFGHIJKLM NOP'), 'ABCDEFGHIJKLM');
  assert.equal(normalizePlate('A B C D E F G H I J'), 'A B C D E F G');
  for (const text of ['UK 07 DW 2400', 'ABCDEFGHIJKLMN', 'A', '']) assert.ok(isNormalizedPlate(text), text);
  assert.ok(!isNormalizedPlate('uk 07'));
  assert.ok(!isNormalizedPlate('UK  07'));
  assert.ok(!isNormalizedPlate(' UK'));
});

test('normalizePlate is idempotent on every outcome', () => {
  for (const raw of ['uk 07 dw 2400', 'ABCDEFGHIJKLM NOP', '  a--b  ', 'x'.repeat(40), '1 2 3 4 5 6 7 8 9 0 1 2']) {
    const once = normalizePlate(raw);
    assert.equal(normalizePlate(once), once, raw);
    assert.ok(once.length <= PLATE_MAX_LENGTH);
  }
});

test('randomPlate: LL DD LLL, always already normalized, reproducible from a seed', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const p = randomPlate(seed);
    assert.match(p, /^[A-Z]{2} \d{2} [A-Z]{3}$/, p);
    assert.equal(normalizePlate(p), p);
    assert.equal(randomPlate(seed), p);
  }
  assert.notEqual(randomPlate(1), randomPlate(2));
  assert.match(randomPlate(), /^[A-Z]{2} \d{2} [A-Z]{3}$/);
});

test('the pixel font covers every character normalizePlate can emit, 5×7 each', () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  assert.equal(GLYPH_CHARS.length, alphabet.length);
  for (const ch of alphabet) {
    assert.ok(GLYPH_CHARS.includes(ch), ch);
    const rows = glyphRows(ch);
    assert.equal(rows.length, GLYPH_ROWS, ch);
    for (const row of rows) assert.ok(row >= 0 && row < 1 << GLYPH_COLS, `${ch} row ${row}`);
    if (ch !== ' ') assert.ok(rows.some((r) => r !== 0), `${ch} is blank`);
  }
  assert.equal(textCells('UK 07 DW 2400'), 13 * 6 - 1);
  assert.equal(textCells(''), 0);
  assert.deepEqual(glyphRows('?'), glyphRows(' '));
});
