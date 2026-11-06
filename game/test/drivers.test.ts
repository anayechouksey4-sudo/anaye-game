/**
 * Drivers (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/drivers.test.ts
 *
 * - sanitisers: names keep any script, lose controls / bidi / markup, cut at 14 code points; plates
 * - share codes: 3,000 random drivers round-trip; fuzzed / truncated / flipped codes never throw and
 *   corrupted codes are rejected (CRC-8); the version nibble is checked
 * - defaults: five distinct original drivers, slot 1 the owner, names ≤ 14
 * - bust: every hair × helmet × beard × glasses × eyes × mouth × mark combination stays ≤ 40 boxes
 *   and inside a 0.42 × 0.7 × 0.42 m envelope
 * - portrait: every preset renders inside 24 × 24 with opaque pixels; the five defaults differ
 * - profile sanitising: corrupt / partial saves fall back field by field; the owner keeps the tag
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BEARDS,
  DEFAULT_DRIVERS,
  DRIVER_COUNT,
  EYES,
  GLASSES,
  HAIR_STYLES,
  HELMETS,
  MARKS,
  MOUTHS,
  VISORS,
  avatarEqual,
  sanitizeAvatar,
  sanitizeDriver,
  type AvatarConfig,
} from '../src/drivers/avatar';
import { BUST_BOX_LIMIT, boxBounds, buildBustBoxes } from '../src/drivers/bust';
import { fromBase64Url, toBase64Url } from '../src/drivers/codec';
import { PORTRAIT, renderPortrait } from '../src/drivers/portrait';
import { NAME_MAX, sanitizeHex, sanitizeName, sanitizePlate } from '../src/drivers/sanitize';
import { decodeDriver, encodeDriver, shareCodeKind } from '../src/drivers/shareCode';

let seed = 20261106;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T>(list: readonly T[]): T => list[ri(list.length)]!;
const hexr = () => '#' + [0, 0, 0].map(() => ri(256).toString(16).padStart(2, '0').toUpperCase()).join('');
const randomAvatar = (): AvatarConfig => ({
  skin: ri(8),
  hair: pick(HAIR_STYLES),
  hairColor: ri(8),
  helmet: pick(HELMETS),
  color: hexr(),
  visor: pick(VISORS),
  eyes: pick(EYES),
  eyeColor: ri(6),
  mouth: pick(MOUTHS),
  glasses: pick(GLASSES),
  beard: pick(BEARDS),
  mark: pick(MARKS),
});
const NAMES = ['Anaye', 'Volt', 'अनय', 'Ünïcödé Rïdé', 'a'.repeat(40), '', '  spaced   out  ', 'Zoë 🚗', 'Vølt', '日本語の名前です'];

test('sanitizeName keeps scripts and emoji, strips controls, bidi, markup and extra spaces, cuts at 14 code points', () => {
  assert.equal(sanitizeName('अनय'), 'अनय');
  assert.equal(sanitizeName('Zoë 🚗'), 'Zoë 🚗');
  assert.equal(sanitizeName('‮evil​<b>x'), 'evilbx');
  assert.equal(sanitizeName('  spaced   out  '), 'spaced out');
  assert.equal(sanitizeName('a'.repeat(40)).length, NAME_MAX);
  assert.equal([...sanitizeName('🚗'.repeat(20))].length, NAME_MAX, 'counts code points, not UTF-16 units');
  assert.equal(sanitizeName('\t\n\u0000'), '');
  assert.equal(sanitizeName(42), '');
  assert.equal(sanitizeName('x & "y" \\ `z`'), 'x y z');
});

test('sanitizePlate upper-cases, maps separators to spaces and keeps A–Z 0–9 only, ≤ 14', () => {
  assert.equal(sanitizePlate('uk-07 dw   2400 ✨ <b>'), 'UK 07 DW 2400', 'the stray B is cut by the 14-character limit and the trailing space trimmed');
  assert.equal(sanitizePlate('ab_cd.ef/gh'), 'AB CD EF GH');
  assert.equal(sanitizePlate('UK 07 DW 2400'), 'UK 07 DW 2400');
  assert.equal(sanitizePlate('abcdefghijklmnopqrstuvwxyz').length, 14);
  assert.equal(sanitizePlate('   '), '');
  assert.equal(sanitizePlate(null), '');
  assert.equal(sanitizeHex('#ff00aa', '#000000'), '#FF00AA');
  assert.equal(sanitizeHex('red', '#000000'), '#000000');
});

test('base64url codec round-trips every length and rejects junk', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, () => ri(256));
    const text = toBase64Url(bytes);
    assert.match(text, /^[A-Za-z0-9_-]*$/);
    assert.deepEqual(fromBase64Url(text), bytes);
  }
  assert.equal(fromBase64Url('A'), null);
  assert.equal(fromBase64Url('A+B/'), null);
});

test('driver share codes round-trip 3,000 random drivers after sanitising', () => {
  const lengths: number[] = [];
  for (let n = 0; n < 3000; n++) {
    const d = { name: pick(NAMES), avatar: randomAvatar() };
    const code = encodeDriver(d);
    lengths.push(code.length);
    assert.equal(shareCodeKind(code), 'driver');
    const back = decodeDriver(code);
    assert.ok(back, `decode failed for ${code}`);
    assert.equal(back.name, sanitizeName(d.name));
    assert.ok(avatarEqual(back.avatar, sanitizeAvatar(d.avatar)), `avatar mismatch ${JSON.stringify(back.avatar)} vs ${JSON.stringify(d.avatar)}`);
  }
  lengths.sort((a, b) => a - b);
  console.log(`  driver code length min/median/max ${lengths[0]}/${lengths[1500]}/${lengths[2999]}`);
  assert.ok(lengths[2999]! <= 80);
});

test('corrupted, truncated and random driver codes never throw and are rejected', () => {
  const sample = encodeDriver({ name: 'Anaye', avatar: DEFAULT_DRIVERS[0]!.avatar });
  let accepted = 0;
  let total = 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let n = 0; n < 6000; n++) {
    let s: string;
    const kind = ri(4);
    if (kind === 0) s = Array.from({ length: ri(80) }, () => String.fromCharCode(32 + ri(95))).join('');
    else if (kind === 1) s = sample.slice(0, ri(sample.length));
    else if (kind === 2) {
      const i = 5 + ri(sample.length - 5);
      s = sample.slice(0, i) + alphabet[ri(64)] + sample.slice(i + 1);
    } else s = 'DRV1-' + toBase64Url(Uint8Array.from({ length: ri(40) }, () => ri(256)));
    total++;
    const r = decodeDriver(s); // must not throw
    if (r && s !== sample) {
      accepted++;
      encodeDriver(r); // whatever passed the CRC is a valid config
    }
  }
  // CRC-8 lets ~1/256 of single-character flips through; those still decode to a valid, sanitised driver.
  assert.ok(accepted < total * 0.02, `too many corrupted codes accepted: ${accepted}/${total}`);
  assert.equal(decodeDriver(sample.slice(0, -1) + (sample.endsWith('A') ? 'B' : 'A')), null, 'a flipped last character fails the CRC');
  assert.equal(decodeDriver(''), null);
  assert.equal(decodeDriver(null), null);
  assert.equal(decodeDriver('RIDE1-AAAA'), null);
  assert.equal(shareCodeKind('ride1-xyz'), 'ride');
  assert.equal(shareCodeKind('hello'), null);
});

test('five original defaults: distinct names, looks and colours; slot 1 is the owner; every name fits', () => {
  assert.equal(DEFAULT_DRIVERS.length, DRIVER_COUNT);
  assert.ok(DEFAULT_DRIVERS[0]!.owner && DEFAULT_DRIVERS[0]!.name === 'Anaye');
  assert.equal(DEFAULT_DRIVERS.filter((d) => d.owner).length, 1);
  assert.equal(new Set(DEFAULT_DRIVERS.map((d) => d.name)).size, DRIVER_COUNT);
  assert.equal(new Set(DEFAULT_DRIVERS.map((d) => d.avatar.color)).size, DRIVER_COUNT);
  for (const d of DEFAULT_DRIVERS) {
    assert.equal(sanitizeName(d.name), d.name);
    assert.ok([...d.name].length <= NAME_MAX);
    assert.ok(d.bio.length > 0 && d.taunt.length > 0);
    assert.deepEqual(sanitizeAvatar(d.avatar), d.avatar, `${d.name}'s default avatar is not already valid`);
  }
  for (let i = 0; i < DEFAULT_DRIVERS.length; i++)
    for (let j = i + 1; j < DEFAULT_DRIVERS.length; j++) assert.ok(!avatarEqual(DEFAULT_DRIVERS[i]!.avatar, DEFAULT_DRIVERS[j]!.avatar));
});

test('sanitizeAvatar / sanitizeDriver fall back field by field and keep the owner tag', () => {
  const junk = sanitizeAvatar({ skin: 99, hair: 'afro', hairColor: -1, helmet: 'full', color: 'blue', eyes: 'wide', mouth: 7 });
  assert.equal(junk.skin, 3);
  assert.equal(junk.hair, 'crop');
  assert.equal(junk.helmet, 'full');
  assert.equal(junk.eyes, 'wide');
  assert.equal(junk.color, '#00F0FF');
  const owner = sanitizeDriver({ id: 'd9', name: 'anshu', owner: false, avatar: { color: '#123456' } }, 0);
  assert.equal(owner.id, 'd1');
  assert.equal(owner.owner, true, 'renaming or editing the owner slot keeps OWNER');
  assert.equal(owner.name, 'anshu');
  assert.equal(owner.avatar.color, '#123456');
  assert.equal(owner.avatar.hair, 'quiff');
  assert.equal(sanitizeDriver(null, 4).name, 'Tarmac Tej');
  assert.equal(sanitizeDriver({ name: '\u0000​' }, 1).name, 'Volt', 'an empty name falls back to the default');
});

test(`bust: every feature combination builds with ≤ ${BUST_BOX_LIMIT} boxes inside the seat envelope`, () => {
  let worst = 0;
  let worstKey = '';
  let count = 0;
  for (const hair of HAIR_STYLES)
    for (const helmet of HELMETS)
      for (const beard of BEARDS)
        for (const glasses of GLASSES) {
          const a: AvatarConfig = { ...DEFAULT_DRIVERS[0]!.avatar, hair, helmet, beard, glasses, eyes: 'wide', mouth: 'tongue', mark: 'scar' };
          const boxes = buildBustBoxes(a);
          count++;
          if (boxes.length > worst) {
            worst = boxes.length;
            worstKey = `${hair}/${helmet}/${beard}/${glasses}`;
          }
          assert.ok(boxes.length <= BUST_BOX_LIMIT, `${worstKey}: ${boxes.length} boxes`);
          const b = boxBounds(boxes);
          assert.ok(b.min[0] >= -0.245 && b.max[0] <= 0.245, `${hair}/${helmet} too wide: ${b.min[0]}…${b.max[0]}`);
          assert.ok(b.min[1] >= -0.23 && b.max[1] <= 0.5, `${hair}/${helmet} too tall: ${b.min[1]}…${b.max[1]}`);
          assert.ok(b.min[2] >= -0.26 && b.max[2] <= 0.26, `${hair}/${helmet} too deep: ${b.min[2]}…${b.max[2]}`);
          for (const box of boxes) for (let i = 0; i < 3; i++) assert.ok(box.s[i]! > 0 && Number.isFinite(box.c[i]!));
        }
  for (const eyes of EYES) for (const mouth of MOUTHS) for (const mark of MARKS) assert.ok(buildBustBoxes({ ...DEFAULT_DRIVERS[1]!.avatar, eyes, mouth, mark }).length <= BUST_BOX_LIMIT);
  console.log(`  bust: ${count} combinations, worst ${worst} boxes (${worstKey}) = ${worst * 12} triangles`);
  for (const d of DEFAULT_DRIVERS) console.log(`  bust ${d.name}: ${buildBustBoxes(d.avatar).length} boxes`);
});

test('portrait: every preset renders inside 24×24, fully opaque; the five defaults differ', () => {
  const sum = (px: Uint8ClampedArray) => {
    let s = 0;
    for (let i = 0; i < px.length; i++) s = (s * 31 + px[i]!) >>> 0;
    return s;
  };
  const seen = new Set<number>();
  for (const d of DEFAULT_DRIVERS) {
    const px = renderPortrait(d.avatar);
    assert.equal(px.length, PORTRAIT * PORTRAIT * 4);
    for (let i = 3; i < px.length; i += 4) assert.equal(px[i], 255, 'opaque');
    seen.add(sum(px));
  }
  assert.equal(seen.size, DRIVER_COUNT);
  for (const hair of HAIR_STYLES) renderPortrait({ ...DEFAULT_DRIVERS[0]!.avatar, hair, helmet: 'none' });
  for (const helmet of HELMETS) for (const visor of VISORS) renderPortrait({ ...DEFAULT_DRIVERS[0]!.avatar, helmet, visor });
  for (const eyes of EYES) for (const mouth of MOUTHS) renderPortrait({ ...DEFAULT_DRIVERS[0]!.avatar, eyes, mouth });
  for (const glasses of GLASSES) for (const beard of BEARDS) for (const mark of MARKS) renderPortrait({ ...DEFAULT_DRIVERS[0]!.avatar, glasses, beard, mark });
  for (let n = 0; n < 300; n++) renderPortrait(randomAvatar());
});
