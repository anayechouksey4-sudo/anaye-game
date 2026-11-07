/**
 * Career store reducers, persistence and every trophy rule (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/career.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addSample,
  betterMedal,
  CAREER_VERSION,
  emptyCareer,
  finishPosition,
  medalCounts,
  recordAir,
  recordFall,
  recordFinish,
  recordFriendsRace,
  recordKey,
  recordRestart,
  sanitizeCareer,
  tracksWithMedal,
  unlockTrophies,
  visitRegion,
  type Career,
  type CareerMedal,
} from '../src/career/store';
import {
  ALL_CAR_IDS,
  BIG_AIR_M,
  CLASSIC_MAP_IDS,
  evaluateTrophies,
  GHOST_MARGIN_MS,
  HANG_TIME_S,
  ISLAND_RACE_IDS,
  LONG_HAUL_KM,
  NIGHT_SHIFT_S,
  ODOMETER_KM,
  REGIONS_FOR_WAYFARER,
  SPEED_MARK_KMH,
  TROPHIES,
  trophyById,
  unlockedCount,
} from '../src/career/trophies';
import { clearTrophyToasts, enqueueTrophyToast, useTrophyToast } from '../src/career/toastStore';

const T0 = 1_700_000_000_000;

const finish = (c: Career, trackId: string, carId: string, ms: number, extra: Partial<Parameters<typeof recordFinish>[1]> = {}): Career =>
  recordFinish(c, { trackId, carId, ms, falls: 0, medal: null, position: null, ...extra });

test('empty career: nothing counted, no trophy passes', () => {
  const c = emptyCareer(T0);
  assert.equal(c.v, CAREER_VERSION);
  assert.equal(c.totals.racesFinished, 0);
  assert.deepEqual(medalCounts(c), { gold: 0, silver: 0, bronze: 0 });
  for (const t of TROPHIES) assert.equal(t.check(c), false, `${t.id} must not pass on an empty career`);
  assert.deepEqual(evaluateTrophies(c), []);
  assert.equal(unlockedCount(c), 0);
});

test('trophy catalog: 24 unique ids, names, hints and glyphs', () => {
  assert.equal(TROPHIES.length, 24);
  const ids = new Set(TROPHIES.map((t) => t.id));
  assert.equal(ids.size, TROPHIES.length);
  for (const t of TROPHIES) {
    assert.match(t.id, /^[a-z0-9-]+$/);
    assert.ok(t.name.length >= 3 && t.name === t.name.toUpperCase(), t.id);
    assert.ok(t.hint.length > 8 && !t.hint.includes('\n'), t.id);
    assert.ok(t.glyph.startsWith('M') && t.glyph.length > 10, t.id);
    assert.equal(trophyById(t.id), t);
  }
  assert.deepEqual([...CLASSIC_MAP_IDS], ['chaos', 'ribbon', 'isles', 'cryo', 'strip']);
  assert.equal(ISLAND_RACE_IDS.length, 4);
  assert.equal(ALL_CAR_IDS.length, 9);
});

test('recordFinish: best time, medal, position, runs, falls, clean runs; input untouched', () => {
  const c0 = emptyCareer(T0);
  const c1 = finish(c0, 'strip', 'hypercar', 25_000, { falls: 1, medal: 'silver', position: 2 });
  assert.notEqual(c1, c0);
  assert.equal(c0.totals.racesFinished, 0, 'pure: the input is not mutated');
  const r1 = c1.records[recordKey('strip', 'hypercar')]!;
  assert.deepEqual(r1, { bestMs: 25_000, medal: 'silver', bestPosition: 2, runs: 1, falls: 1, cleanRuns: 0 });
  assert.equal(c1.totals.racesFinished, 1);
  assert.equal(c1.totals.podiums, 1);
  assert.equal(c1.totals.wins, 0);
  assert.deepEqual(c1.carsFinished, ['hypercar']);
  // A slower, cleaner run: best time and medal keep, runs and clean runs grow, position improves.
  const c2 = finish(c1, 'strip', 'hypercar', 26_000, { falls: 0, medal: 'bronze', position: 1 });
  const r2 = c2.records[recordKey('strip', 'hypercar')]!;
  assert.deepEqual(r2, { bestMs: 25_000, medal: 'silver', bestPosition: 1, runs: 2, falls: 1, cleanRuns: 1 });
  assert.equal(c2.totals.wins, 1);
  assert.equal(c2.totals.podiums, 2);
  // A faster run: new best, gold, and the improvement is remembered (ghost margin).
  const c3 = finish(c2, 'strip', 'hypercar', 22_500, { medal: 'gold', position: null });
  const r3 = c3.records[recordKey('strip', 'hypercar')]!;
  assert.equal(r3.bestMs, 22_500);
  assert.equal(r3.medal, 'gold');
  assert.equal(r3.bestPosition, 1, 'a solo run keeps the best position');
  assert.equal(c3.totals.bestImprovementMs, 2_500);
  assert.equal(c3.totals.podiums, 2, 'solo runs are not podiums');
  // Tilt finishes and junk times.
  assert.equal(finish(c3, 'strip', 'hypercar', 30_000, { steering: 'tilt' }).totals.tiltFinishes, 1);
  assert.equal(finish(c3, 'strip', 'hypercar', 0), c3);
  assert.equal(finish(c3, 'strip', 'hypercar', Number.NaN), c3);
  assert.deepEqual(medalCounts(c3), { gold: 1, silver: 0, bronze: 0 });
});

test('falls, restarts, samples, air, regions, friends races', () => {
  let c = emptyCareer(T0);
  c = recordFall(recordFall(c));
  c = recordRestart(c);
  assert.equal(c.totals.falls, 2);
  assert.equal(c.totals.restarts, 1);
  c = addSample(c, { trackId: 'chaos', carId: 'rally', distanceM: 1500, seconds: 30, topSpeedKmh: 180.26 });
  c = addSample(c, { trackId: 'strip', carId: 'kart', distanceM: 500, seconds: 10, topSpeedKmh: 120 });
  assert.equal(c.totals.distanceM, 2000);
  assert.deepEqual(c.totals.distanceByMap, { chaos: 1500, strip: 500 });
  assert.equal(c.totals.timePlayedS, 40);
  assert.equal(c.totals.topSpeedKmh, 180.3);
  assert.equal(c.totals.topSpeedMap, 'chaos');
  assert.equal(c.totals.topSpeedCar, 'rally');
  const same = addSample(c, { trackId: null, carId: null, distanceM: 0, seconds: 0, topSpeedKmh: 10 });
  assert.equal(same, c, 'an empty sample is a no-op (same reference)');
  assert.equal(addSample(c, { trackId: 'x', carId: 'y', distanceM: -5, seconds: -1, topSpeedKmh: -3 }), c, 'negative samples are ignored');
  c = recordAir(c, 1.234, 22.26);
  c = recordAir(c, 0.5, 30);
  assert.equal(c.totals.longestAirS, 1.23);
  assert.equal(c.totals.longestLeapM, 30);
  assert.equal(recordAir(c, 1, 10), c);
  c = visitRegion(c, 'CINNABAR REACH');
  c = visitRegion(c, ' CINNABAR REACH ');
  c = visitRegion(c, '');
  c = visitRegion(c, 'TIN SPUR');
  assert.deepEqual(c.regions, ['CINNABAR REACH', 'TIN SPUR']);
  c = recordFriendsRace(c, { played: false, won: false, players: 0, hosted: true });
  c = recordFriendsRace(c, { played: true, won: true, players: 2, hosted: false });
  c = recordFriendsRace(c, { played: true, won: true, players: 3, hosted: false });
  c = recordFriendsRace(c, { played: true, won: false, players: 4, hosted: false });
  assert.equal(c.totals.friendsHosted, 1);
  assert.equal(c.totals.friendsPlayed, 3);
  assert.equal(c.totals.friendsWon, 2);
  assert.equal(c.totals.friendsWonWith3, 1);
});

test('betterMedal and tracksWithMedal', () => {
  assert.equal(betterMedal(null, null), null);
  assert.equal(betterMedal('bronze', null), 'bronze');
  assert.equal(betterMedal('silver', 'gold'), 'gold');
  assert.equal(betterMedal('gold', 'bronze'), 'gold');
  let c = emptyCareer(T0);
  c = finish(c, 'chaos', 'rally', 50_000, { medal: 'gold' });
  c = finish(c, 'ribbon', 'rally', 45_000, { medal: 'silver' });
  c = finish(c, 'chaos', 'kart', 60_000, { medal: 'gold' });
  assert.deepEqual([...tracksWithMedal(c, 'gold')].sort(), ['chaos']);
  assert.deepEqual([...tracksWithMedal(c, 'silver')].sort(), ['chaos', 'ribbon']);
  assert.deepEqual([...tracksWithMedal(c, 'gold', 'kart')], ['chaos']);
  assert.deepEqual([...tracksWithMedal(c, 'gold', 'buggy')], []);
});

test('unlockTrophies stamps once and keeps the first time', () => {
  const c0 = emptyCareer(T0);
  const c1 = unlockTrophies(c0, ['first-lights'], T0 + 10);
  const c2 = unlockTrophies(c1, ['first-lights', 'gold-rush'], T0 + 20);
  assert.equal(c1.trophies['first-lights'], T0 + 10);
  assert.equal(c2.trophies['first-lights'], T0 + 10);
  assert.equal(c2.trophies['gold-rush'], T0 + 20);
  assert.equal(unlockTrophies(c2, ['gold-rush'], T0 + 30), c2);
  assert.equal(unlockedCount(c2), 2);
});

test('sanitizeCareer: round trip, junk, wrong version', () => {
  let c = emptyCareer(T0);
  c = finish(c, 'chaos', 'hypercar', 47_000, { medal: 'silver', position: 3, falls: 2 });
  c = addSample(c, { trackId: 'chaos', carId: 'hypercar', distanceM: 1234.5, seconds: 60, topSpeedKmh: 210 });
  c = visitRegion(c, 'PRISM CITY');
  c = unlockTrophies(c, ['first-lights'], T0 + 1);
  const back = sanitizeCareer(JSON.parse(JSON.stringify(c)), T0 + 99);
  assert.deepEqual(back, c);
  assert.deepEqual(sanitizeCareer(null, T0), emptyCareer(T0));
  assert.deepEqual(sanitizeCareer('nope', T0), emptyCareer(T0));
  assert.deepEqual(sanitizeCareer({ v: 2, records: {} }, T0), emptyCareer(T0));
  const junk = sanitizeCareer(
    {
      v: 1,
      createdAt: 'x',
      records: { 'chaos|kart': { bestMs: -4, medal: 'platinum', runs: 'a', falls: 2.6 }, nokey: { bestMs: 10 }, 'strip|buggy': 5 },
      totals: { racesFinished: -3, distanceM: '12', topSpeedKmh: 99.5, topSpeedMap: 4, distanceByMap: { chaos: 'x', strip: 40 } },
      regions: ['A', 'A', 7, ''],
      carsFinished: 'kart',
      trophies: { 'first-lights': 'soon', 'gold-rush': 5 },
    },
    T0,
  );
  assert.equal(junk.createdAt, T0);
  assert.deepEqual(Object.keys(junk.records), ['chaos|kart']);
  assert.deepEqual(junk.records['chaos|kart'], { bestMs: null, medal: null, bestPosition: null, runs: 0, falls: 3, cleanRuns: 0 });
  assert.equal(junk.totals.racesFinished, 0);
  assert.equal(junk.totals.distanceM, 0);
  assert.equal(junk.totals.topSpeedKmh, 99.5);
  assert.equal(junk.totals.topSpeedMap, null);
  assert.deepEqual(junk.totals.distanceByMap, { strip: 40 });
  assert.deepEqual(junk.regions, ['A']);
  assert.deepEqual(junk.carsFinished, []);
  assert.deepEqual(junk.trophies, { 'gold-rush': 5 });
});

// ── Every trophy rule: a career built with the reducers that passes it, and the nearest miss that does not ──

type Case = { id: string; pass: () => Career; miss: () => Career };
const base = () => emptyCareer(T0);
const nFinishes = (n: number, c = base()) => {
  for (let i = 0; i < n; i++) c = finish(c, 'strip', 'hypercar', 25_000 + i);
  return c;
};
const goldOnAll = (ids: readonly string[], car: string, c = base()) => {
  for (const id of ids) c = finish(c, id, car, 40_000, { medal: 'gold' });
  return c;
};
const nWins = (n: number, c = base()) => {
  for (let i = 0; i < n; i++) c = finish(c, 'chaos', 'rally', 50_000, { position: 1 });
  return c;
};
const medalEveryCar = (medal: CareerMedal, cars: readonly string[], c = base()) => {
  for (const car of cars) c = finish(c, 'ribbon', car, 42_000, { medal });
  return c;
};
const km = (n: number, c = base()) => addSample(c, { trackId: 'tessera', carId: 'buggy', distanceM: n * 1000, seconds: 1, topSpeedKmh: 0 });
const played = (s: number, c = base()) => addSample(c, { trackId: null, carId: null, distanceM: 0, seconds: s, topSpeedKmh: 0 });
const regions = (n: number, c = base()) => {
  for (let i = 0; i < n; i++) c = visitRegion(c, `REGION ${i}`);
  return c;
};

const CASES: Case[] = [
  { id: 'first-lights', pass: () => nFinishes(1), miss: () => recordRestart(recordFall(base())) },
  { id: 'ten-up', pass: () => nFinishes(10), miss: () => nFinishes(9) },
  { id: 'bronze-age', pass: () => finish(base(), 'cryo', 'drift', 70_000, { medal: 'bronze' }), miss: () => finish(base(), 'cryo', 'drift', 70_000) },
  { id: 'silver-lining', pass: () => finish(base(), 'cryo', 'drift', 60_000, { medal: 'silver' }), miss: () => finish(base(), 'cryo', 'drift', 70_000, { medal: 'bronze' }) },
  { id: 'gold-rush', pass: () => finish(base(), 'cryo', 'drift', 55_000, { medal: 'gold' }), miss: () => finish(base(), 'cryo', 'drift', 60_000, { medal: 'silver' }) },
  {
    id: 'full-set',
    pass: () => goldOnAll(CLASSIC_MAP_IDS, 'muscle'),
    // Four golds with one car and the fifth with another: not a set.
    miss: () => finish(goldOnAll(CLASSIC_MAP_IDS.slice(0, 4), 'muscle'), CLASSIC_MAP_IDS[4]!, 'kart', 30_000, { medal: 'gold' }),
  },
  { id: 'islander', pass: () => goldOnAll(ISLAND_RACE_IDS, 'coupe'), miss: () => finish(goldOnAll(ISLAND_RACE_IDS.slice(0, 3), 'coupe'), ISLAND_RACE_IDS[3]!, 'coupe', 60_000, { medal: 'silver' }) },
  { id: 'nine-lives', pass: () => medalEveryCar('bronze', ALL_CAR_IDS), miss: () => medalEveryCar('gold', ALL_CAR_IDS.slice(1)) },
  { id: 'clean-sheet', pass: () => finish(base(), 'chaos', 'hypercar', 50_000, { falls: 0 }), miss: () => finish(finish(base(), 'chaos', 'hypercar', 50_000, { falls: 1 }), 'ribbon', 'hypercar', 40_000, { falls: 0 }) },
  { id: 'front-row', pass: () => nWins(1), miss: () => finish(base(), 'chaos', 'rally', 50_000, { position: 2 }) },
  {
    id: 'podium-regular',
    pass: () => {
      let c = base();
      for (const p of [1, 2, 3, 3, 2]) c = finish(c, 'isles', 'formula', 50_000, { position: p });
      return c;
    },
    miss: () => {
      let c = base();
      for (const p of [1, 2, 3, 3, 4]) c = finish(c, 'isles', 'formula', 50_000, { position: p });
      return c;
    },
  },
  { id: 'grid-king', pass: () => nWins(10), miss: () => finish(nWins(9), 'chaos', 'rally', 50_000, { position: 2 }) },
  { id: 'room-service', pass: () => recordFriendsRace(base(), { played: false, won: false, players: 0, hosted: true }), miss: () => recordFriendsRace(base(), { played: true, won: true, players: 3, hosted: false }) },
  { id: 'pack-leader', pass: () => recordFriendsRace(base(), { played: true, won: true, players: 3, hosted: false }), miss: () => recordFriendsRace(base(), { played: true, won: true, players: 2, hosted: false }) },
  { id: 'tilted', pass: () => finish(base(), 'strip', 'kart', 26_000, { steering: 'tilt' }), miss: () => finish(base(), 'strip', 'kart', 26_000, { steering: 'touch' }) },
  { id: 'night-shift', pass: () => played(NIGHT_SHIFT_S), miss: () => played(NIGHT_SHIFT_S - 1) },
  { id: 'odometer', pass: () => km(ODOMETER_KM), miss: () => km(ODOMETER_KM - 0.001) },
  { id: 'long-haul', pass: () => km(LONG_HAUL_KM), miss: () => km(LONG_HAUL_KM - 0.001) },
  { id: 'big-air', pass: () => recordAir(base(), 1, BIG_AIR_M), miss: () => recordAir(base(), 1, BIG_AIR_M - 0.1) },
  { id: 'hang-time', pass: () => recordAir(base(), HANG_TIME_S, 5), miss: () => recordAir(base(), HANG_TIME_S - 0.01, 5) },
  { id: 'ghostbuster', pass: () => finish(finish(base(), 'strip', 'electric', 30_000), 'strip', 'electric', 30_000 - GHOST_MARGIN_MS), miss: () => finish(finish(base(), 'strip', 'electric', 30_000), 'strip', 'electric', 30_000 - GHOST_MARGIN_MS + 1) },
  { id: 'wayfarer', pass: () => regions(REGIONS_FOR_WAYFARER), miss: () => regions(REGIONS_FOR_WAYFARER - 1) },
  { id: 'speed-mark', pass: () => addSample(base(), { trackId: 'strip', carId: 'hypercar', distanceM: 0, seconds: 0, topSpeedKmh: SPEED_MARK_KMH }), miss: () => addSample(base(), { trackId: 'strip', carId: 'hypercar', distanceM: 0, seconds: 0, topSpeedKmh: SPEED_MARK_KMH - 0.2 }) },
  {
    id: 'garage-tour',
    pass: () => medalEveryCar('bronze', ALL_CAR_IDS.slice(0, 5)),
    miss: () => finish(medalEveryCar('bronze', ALL_CAR_IDS.slice(0, 4)), 'strip', ALL_CAR_IDS[0]!, 25_000),
  },
];

test('every trophy has a pass and a miss case', () => {
  assert.deepEqual(CASES.map((k) => k.id).sort(), TROPHIES.map((t) => t.id).sort());
});

for (const k of CASES) {
  test(`trophy ${k.id}: rule passes on its career and misses on the nearest miss`, () => {
    const t = trophyById(k.id)!;
    const pass = k.pass();
    const miss = k.miss();
    assert.equal(t.check(pass), true, `${k.id} should pass`);
    assert.equal(t.check(miss), false, `${k.id} should miss`);
    assert.ok(evaluateTrophies(pass).includes(k.id));
    assert.ok(!evaluateTrophies(miss).includes(k.id));
    // Once stamped it is not offered again.
    assert.ok(!evaluateTrophies(unlockTrophies(pass, [k.id], T0)).includes(k.id));
  });
}

test('toast queue: one at a time, the rest wait', () => {
  clearTrophyToasts();
  enqueueTrophyToast('first-lights');
  enqueueTrophyToast('gold-rush');
  enqueueTrophyToast('big-air');
  const s = useTrophyToast.getState();
  assert.equal(s.current?.trophyId, 'first-lights');
  assert.deepEqual(
    s.queue.map((q) => q.trophyId),
    ['gold-rush', 'big-air'],
  );
  clearTrophyToasts();
  assert.equal(useTrophyToast.getState().current, null);
  assert.deepEqual(useTrophyToast.getState().queue, []);
});

test('finishPosition: ranks from the participants at the finish instant', () => {
  const row = (kind: 'player' | 'rival' | 'remote' | 'ghost', finishMs: number | null) => ({ kind, finished: finishMs !== null, finishMs });
  assert.equal(finishPosition([row('player', null)], 24_000), null, 'alone: nothing to place');
  assert.equal(finishPosition([row('player', null), row('ghost', 20_000)], 24_000), null, 'the ghost is never ranked');
  assert.deepEqual(finishPosition([row('player', null), row('rival', null), row('rival', null), row('rival', null)], 24_300), { position: 1, total: 4 });
  assert.deepEqual(finishPosition([row('player', 30_000), row('rival', 24_500), row('rival', 27_000), row('rival', null)], 30_000), { position: 3, total: 4 });
  assert.deepEqual(finishPosition([row('player', null), row('remote', 24_000), row('rival', 24_000), row('ghost', 1)], 24_000), { position: 3, total: 3 }, 'ties count as ahead');
});
