/**
 * MY RIDE (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/ride.test.ts
 *
 * - ride share codes: 3,000 random rides round-trip (incl. an unknown base class → default, known:false);
 *   fuzzed / truncated / flipped codes never throw and are rejected
 * - sanitiser: junk fields fall back one by one; stance snaps to its safe range
 * - livery purity: applyLook never writes the input grid, is deterministic, and a stock look with no
 *   driver leaves every cell as it was; stamps stay inside the enlarged grid; every stamped material
 *   has a palette entry; every class × spoiler × exhaust builds a mesh
 * - driver window: closed cabins get helmet-coloured glass beside the seat; open cabins none
 * - rebuild cost: fill-once + applyLook + mesh per class, warm medians (logged; ≤ 50 ms asserted)
 * - profile: corrupt saves fall back; the owner keeps OWNER; drivers list is always 5
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAR_CLASS_IDS } from '../../shared/protocol';
import { M } from '../src/car/model/carMaterial';
import { CAR_MODELS } from '../src/car/model/models';
import { getVehicleSpec } from '../src/car/vehicleSpec';
import { DEFAULT_DRIVERS } from '../src/drivers/avatar';
import { BitWriter, hexToBytes, putText, sealCode, toBase64Url } from '../src/drivers/codec';
import { sanitizeName, sanitizePlate } from '../src/drivers/sanitize';
import { SEAT_CLASS_IDS, seatFor } from '../src/ride/anchors';
import { DEFAULT_RIDE, EXHAUSTS, PAINT_SWATCHES, SPOILERS, STANCE_MAX, STANCE_MIN, TRIMS, WHEEL_STYLES, clampStance, rideEqual, sanitizeRide, spoilersFor, type RideConfig } from '../src/ride/config';
import { RM, applyLook, enlargeGrid } from '../src/ride/livery';
import { decodeRide, encodeRide } from '../src/ride/shareCode';
import { sanitizeProfile } from '../src/state/profile';

let seed = 7177;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (n: number) => Math.floor(rnd() * n);
const pick = <T>(list: readonly T[]): T => list[ri(list.length)]!;
const hexr = () => '#' + [0, 0, 0].map(() => ri(256).toString(16).padStart(2, '0').toUpperCase()).join('');
const NAMES = ['My Ride', 'अनय', 'Ünïcödé Rïdé', 'a'.repeat(40), '', 'Zoë 🚗', 'Ember'];
const PLATES = ['UK 07 DW 2400', 'anaye-1', 'toolongplate123456', '', 'ÄÖ 12', '<script>'];
const randomRide = (): RideConfig => ({
  base: pick(CAR_CLASS_IDS),
  name: pick(NAMES),
  plate: pick(PLATES),
  paint: hexr(),
  paint2: hexr(),
  accent: hexr(),
  trim: pick(TRIMS),
  wheel: pick(WHEEL_STYLES),
  wheelColor: hexr(),
  spoiler: pick(SPOILERS),
  exhaust: pick(EXHAUSTS),
  stance: STANCE_MIN + ri(7) * 0.02,
});

test('ride share codes round-trip 3,000 random rides after sanitising', () => {
  const lengths: number[] = [];
  for (let n = 0; n < 3000; n++) {
    const ride = randomRide();
    const code = encodeRide(ride);
    lengths.push(code.length);
    const back = decodeRide(code);
    assert.ok(back && back.known, `decode failed for ${code}`);
    const expect = sanitizeRide(ride);
    assert.ok(rideEqual(back.ride, expect), `mismatch\n  ${JSON.stringify(back.ride)}\n  ${JSON.stringify(expect)}`);
  }
  lengths.sort((a, b) => a - b);
  console.log(`  ride code length min/median/max ${lengths[0]}/${lengths[1500]}/${lengths[2999]}`);
  assert.ok(lengths[2999]! <= 120);
});

test('a ride code naming a class this build lacks decodes to the default base with known: false', () => {
  // Hand-roll a code with base "zeppelin": encode a normal ride, then re-encode its body with the name swapped.
  const code = encodeRide({ ...DEFAULT_RIDE, base: 'rally' });
  const w = new BitWriter();
  w.put(1, 4);
  putText(w, 'zeppelin', 16);
  w.put(1, 3);
  w.put(2, 3);
  w.put(1, 3);
  w.put(3, 3);
  w.put(2, 4);
  for (const h of ['#112233', '#445566', '#778899', '#AABBCC']) w.putBytes(hexToBytes(h));
  putText(w, 'ZEP 1', 14);
  putText(w, 'Airship', 56);
  const foreign = sealCode('RIDE1', w.finish());
  const back = decodeRide(foreign);
  assert.ok(back);
  assert.equal(back.known, false);
  assert.equal(back.baseId, 'zeppelin');
  assert.equal(back.ride.base, DEFAULT_RIDE.base);
  assert.equal(back.ride.name, 'Airship');
  assert.equal(back.ride.plate, 'ZEP 1');
  assert.ok(decodeRide(code)?.known);
});

test('corrupted, truncated and random ride codes never throw and are rejected', () => {
  const sample = encodeRide({ ...DEFAULT_RIDE, name: 'Ember', plate: 'UK 07 DW 2400', spoiler: 'gt', exhaust: 'quad' });
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let accepted = 0;
  let total = 0;
  for (let n = 0; n < 6000; n++) {
    let s: string;
    const kind = ri(4);
    if (kind === 0) s = Array.from({ length: ri(90) }, () => String.fromCharCode(32 + ri(95))).join('');
    else if (kind === 1) s = sample.slice(0, ri(sample.length));
    else if (kind === 2) {
      const i = 6 + ri(sample.length - 6);
      s = sample.slice(0, i) + alphabet[ri(64)] + sample.slice(i + 1);
    } else s = 'RIDE1-' + toBase64Url(Uint8Array.from({ length: ri(60) }, () => ri(256)));
    total++;
    const r = decodeRide(s);
    if (r && s !== sample) {
      accepted++;
      encodeRide(r.ride);
    }
  }
  assert.ok(accepted < total * 0.02, `too many corrupted codes accepted: ${accepted}/${total}`);
  assert.equal(decodeRide(sample.slice(0, -1) + (sample.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(decodeRide('DRV1-AAAAAAAA'), null);
  assert.equal(decodeRide(undefined), null);
});

test('sanitizeRide falls back field by field; stance snaps into its safe range', () => {
  const r = sanitizeRide({ base: 'tank', name: 'x'.repeat(30), plate: 'uk 07 dw 2400', paint: 'red', trim: 'rainbow', wheel: 'disc', spoiler: 'gt', exhaust: 9, stance: 0.5 });
  assert.equal(r.base, DEFAULT_RIDE.base);
  assert.equal(r.name.length, 14);
  assert.equal(r.plate, 'UK 07 DW 2400');
  assert.equal(r.paint, DEFAULT_RIDE.paint);
  assert.equal(r.trim, DEFAULT_RIDE.trim);
  assert.equal(r.wheel, 'disc');
  assert.equal(r.spoiler, 'gt');
  assert.equal(r.exhaust, DEFAULT_RIDE.exhaust);
  assert.equal(r.stance, STANCE_MAX);
  assert.equal(clampStance(-1), STANCE_MIN);
  assert.equal(clampStance(0.031), 0.04);
  assert.equal(clampStance(Number.NaN), 0);
  assert.equal(sanitizeRide(null).name, 'My Ride');
  assert.deepEqual(spoilersFor('formula'), ['stock']);
  assert.ok(PAINT_SWATCHES.every((h) => /^#[0-9A-F]{6}$/.test(h)));
});

const specs = CAR_CLASS_IDS.map((id) => ({ id, spec: getVehicleSpec(id), def: CAR_MODELS[id] }));
const baseGrids = new Map(specs.map(({ id, spec, def }) => [id, def.buildBody(spec)] as const));

test('applyLook is pure: the input grid is untouched, outputs are deterministic, a stock look changes no cell', () => {
  for (const { id, spec, def } of specs) {
    const grid = baseGrids.get(id)!;
    const before = Uint8Array.from(grid.cells);
    const ride: RideConfig = { ...DEFAULT_RIDE, base: id, spoiler: spoilersFor(id)[spoilersFor(id).length - 1]!, exhaust: 'quad', trim: 'accent', wheel: 'turbofan' };
    const a = applyLook(grid, spec, def, { ride, driver: DEFAULT_DRIVERS[0]!.avatar });
    const b = applyLook(grid, spec, def, { ride, driver: DEFAULT_DRIVERS[0]!.avatar });
    assert.deepEqual(grid.cells, before, `${id}: input grid was written`);
    assert.notEqual(a.grid, grid);
    assert.deepEqual(a.grid.cells, b.grid.cells, `${id}: not deterministic`);
    assert.deepEqual(a.grid.n, b.grid.n);
    assert.deepEqual(a.materials, b.materials);
    assert.deepEqual(a.outlets, b.outlets);
    const stock = applyLook(grid, spec, def, { ride: null, driver: null });
    assert.deepEqual(stock.grid.cells, before, `${id}: a stock look changed cells`);
    assert.deepEqual(stock.grid.n, grid.n);
    assert.equal(stock.changed, 0);
    assert.deepEqual(stock.outlets, def.exhaust.slice());
    // Every cell's material has a palette entry (VoxelGrid.build would throw otherwise).
    a.grid.forEachFilled((_i, _j, _k, m) => assert.ok(a.materials[m], `${id}: material ${m} missing`));
    assert.ok(a.changed > 0, `${id}: nothing stamped`);
  }
});

test('enlargeGrid keeps every cell at the same world position', () => {
  const grid = baseGrids.get('hypercar')!;
  const big = enlargeGrid(grid, 5, 3);
  assert.deepEqual(big.n, [grid.n[0], grid.n[1] + 5, grid.n[2] + 3]);
  assert.equal(big.countFilled(), grid.countFilled());
  assert.ok(Math.abs(big.cz(3) - grid.cz(0)) < 1e-9);
  assert.ok(Math.abs(big.cy(0) - grid.cy(0)) < 1e-9);
  let same = true;
  grid.forEachFilled((i, j, k, m) => {
    if (big.get(i, j, k + 3) !== m) same = false;
  });
  assert.ok(same);
});

test('every class × spoiler × exhaust option meshes; stamped tips give one outlet plane; exhaust "none" gives no outlet', () => {
  for (const { id, spec, def } of specs) {
    const grid = baseGrids.get(id)!;
    for (const spoiler of spoilersFor(id))
      for (const exhaust of EXHAUSTS) {
        const ride: RideConfig = { ...DEFAULT_RIDE, base: id, spoiler, exhaust };
        const look = applyLook(grid, spec, def, { ride, driver: null });
        const built = look.grid.build(look.materials, 1);
        assert.ok(built.stats.triangles > 1000, `${id}/${spoiler}/${exhaust}`);
        built.geometry.dispose();
        const tips = { stock: def.exhaust.length, none: 0, single: 1, twin: 2, quad: 4 }[exhaust];
        if (SEAT_CLASS_IDS.includes(id)) assert.equal(look.outlets.length, tips, `${id}/${exhaust}: outlets ${look.outlets.length}`);
        else assert.ok(look.outlets.length <= tips && (tips === 0 || look.outlets.length > 0), `${id}/${exhaust}: outlets ${look.outlets.length}`);
        if (look.outlets.length > 1) assert.ok(look.outlets.every((o) => o[2] === look.outlets[0]![2]), 'one z plane');
        if (spoiler !== 'stock') {
          // The spoiler adds voxels (on the rear deck, above the stock cells there).
          assert.ok(look.grid.countFilled() > grid.countFilled() + 8, `${id}/${spoiler}: nothing stamped`);
        }
      }
  }
});

test('driver window: closed cabins get helmet-coloured glass beside the seat, open cabins stay as they are', () => {
  for (const { id, spec, def } of specs) {
    const grid = baseGrids.get(id)!;
    const look = applyLook(grid, spec, def, { ride: null, driver: DEFAULT_DRIVERS[3]!.avatar });
    let helmet = 0;
    let face = 0;
    look.grid.forEachFilled((_i, _j, _k, m) => {
      if (m === RM.driverHelmet) helmet++;
      if (m === RM.driverFace) face++;
    });
    const seat = seatFor(id);
    if (!SEAT_CLASS_IDS.includes(id)) {
      // A class added after this module (no authored anchor): the window is derived from its glass, if any.
      console.log(`  ${id}: no authored seat; derived window ${helmet} helmet + ${face} face voxels`);
      continue;
    }
    if (seat.open) assert.equal(helmet + face, 0, `${id}: open cabin painted`);
    else {
      assert.ok(helmet >= 4, `${id}: only ${helmet} helmet voxels`);
      assert.ok(face >= 2, `${id}: only ${face} face voxels`);
      assert.ok(helmet + face <= 80, `${id}: window too big (${helmet + face})`);
      // Only glass was repainted.
      let bad = 0;
      look.grid.forEachFilled((i, j, k, m) => {
        if ((m === RM.driverHelmet || m === RM.driverFace) && grid.get(i, j, k) !== M.glass && grid.get(i, j, k) !== M.glassStreak) bad++;
      });
      assert.equal(bad, 0, `${id}: non-glass repainted`);
    }
    console.log(`  ${id}: driver window ${helmet} helmet + ${face} face voxels (${seat.open ? 'open cabin, bust instead' : 'closed cabin'})`);
  }
  assert.ok(SEAT_CLASS_IDS.includes('hypercar') && SEAT_CLASS_IDS.includes('buggy'));
});

test('rebuild cost per class: applyLook + mesh on a cached base grid (warm median), ≤ 50 ms', () => {
  const rows: string[] = [];
  for (const { id, spec, def } of specs) {
    const grid = baseGrids.get(id)!;
    const ride: RideConfig = { ...DEFAULT_RIDE, base: id, spoiler: spoilersFor(id)[spoilersFor(id).length - 1]!, exhaust: 'quad' };
    const times: number[] = [];
    let tris = 0;
    for (let n = 0; n < 12; n++) {
      const t0 = performance.now();
      const look = applyLook(grid, spec, def, { ride, driver: DEFAULT_DRIVERS[0]!.avatar });
      const built = look.grid.build(look.materials, 1);
      times.push(performance.now() - t0);
      tris = built.stats.triangles;
      built.geometry.dispose();
    }
    times.sort((a, b) => a - b);
    const median = times[6]!;
    rows.push(`${id}: median ${median.toFixed(1)} ms (min ${times[0]!.toFixed(1)}, max ${times[11]!.toFixed(1)}), ${tris} tris`);
    assert.ok(median <= 50, `${id}: ${median.toFixed(1)} ms`);
  }
  console.log('  ' + rows.join('\n  '));
});

test('profile sanitising: corrupt / partial saves fall back, 5 drivers always, owner tagged, ride valid', () => {
  const p = sanitizeProfile({ drivers: [{ id: 'd1', name: 'Anshu', owner: false }, 'junk', null], activeDriverId: 'd3', ride: { base: 'buggy', paint: '#123456', stance: 'x' }, rideActive: 'yes' });
  assert.equal(p.drivers.length, 5);
  assert.equal(p.drivers[0]!.name, 'Anshu');
  assert.equal(p.drivers[0]!.owner, true);
  assert.equal(p.drivers[1]!.name, 'Volt');
  assert.equal(p.activeDriverId, 'd3');
  assert.equal(p.ride.base, 'buggy');
  assert.equal(p.ride.paint, '#123456');
  assert.equal(p.ride.stance, 0);
  assert.equal(p.rideActive, false);
  const empty = sanitizeProfile({});
  assert.equal(empty.activeDriverId, 'd1');
  assert.deepEqual(empty.ride, { ...DEFAULT_RIDE });
  // Slot order is restored from ids even when the saved list is shuffled.
  const shuffled = sanitizeProfile({ drivers: [{ id: 'd5', name: 'Five' }, { id: 'd1', name: 'One' }], activeDriverId: 'nope' });
  assert.equal(shuffled.drivers[0]!.name, 'One');
  assert.equal(shuffled.drivers[4]!.name, 'Five');
  assert.equal(shuffled.activeDriverId, 'd1');
  assert.equal(sanitizeName(sanitizePlate('ok')), 'OK');
});
