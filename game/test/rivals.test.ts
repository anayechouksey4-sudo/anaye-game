/**
 * Rivals, routes and standings (node only):
 *   dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/rivals.test.ts
 *
 * - routes: every timed race (5 classic maps from their plans, 4 island races from the generated
 *   world) has a finite polyline, gate stations at the layout's gates and the known heights
 * - speed plan: every race × every car as the player's car × every medal slot: the planned rival
 *   finishes at the target within 0.5 %, never above its class top speed, accel ≤ 6 and braking
 *   ≤ 10 m/s²; a class that cannot make a target is skipped (the buggy against a 46 s chaos gold)
 * - standings: ranking, gaps, P n/N, the results position line for faster / between / slower,
 *   route projection clamped to the gate window, progress monotonic
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { CAR_CLASS_IDS } from '../../shared/protocol';
import { DEFAULT_DRIVERS } from '../src/drivers/avatar';
import { classicRoute, deckTopAt } from '../src/rivals/classicRoute';
import { islandRoute } from '../src/rivals/islandRoute';
import { classTopSpeedMps, planRivals, rivalPlate } from '../src/rivals/rivals';
import { gatePassedAt, layoutRoute, sampleRoute, stationOnRoute, type RaceRoute } from '../src/rivals/route';
import { A_ACC, A_BRAKE, planLimits, planSpeeds, stationAtTime } from '../src/rivals/speedPlan';
import {
  positionLine,
  publishStandings,
  registerParticipant,
  resetStandingsForTests,
  rewindProgress,
  routeProgressOf,
  setFinished,
  setProgress,
  setRaceClock,
  setStandingsRoute,
  standingsSnapshot,
} from '../src/rivals/standings';
import { medalsFor } from '../src/state/records';
import { generateTrack } from '../src/track/chaos/plan';
import { RECIPES } from '../src/track/maps';
import { TEST_TRACK_LAYOUT } from '../src/track/test/TestTrack';
import { generateWorld } from '../src/track/world/gen/generateWorld';

const plans = Object.fromEntries(Object.entries(RECIPES).map(([id, r]) => [id, generateTrack(r, r.seed)]));
const world = generateWorld(7177);
const routes: Record<string, RaceRoute> = {};
for (const [id, plan] of Object.entries(plans)) routes[id] = classicRoute(plan);
for (const ev of world.events) if (ev.mode === 'race') routes[ev.id] = islandRoute(ev);
routes.test = layoutRoute(TEST_TRACK_LAYOUT);
const RACES = Object.keys(routes);

test('routes: ten timed races, finite points, gates on the layout gates, known heights', () => {
  assert.equal(RACES.length, 10);
  assert.equal(routes.test!.lengthM, 1800);
  assert.deepEqual(routes.test!.gateS, [0, 600, 1200, 1800]);
  for (const [id, plan] of Object.entries(plans)) {
    const r = routes[id]!;
    for (let i = 0; i < r.points.length; i++) assert.ok(Number.isFinite(r.points[i]), `${id} point ${i} finite`);
    assert.equal(r.gateS.length, plan.layout.checkpoints.length + 1, `${id} gate count`);
    // Classic courses run along +Z: the station at a gate ≥ its z offset and within the lateral slack.
    for (let k = 1; k < plan.layout.checkpoints.length; k++) {
      const z = plan.layout.checkpoints[k]!.position[2];
      const g = r.gateS[k]!;
      assert.ok(g >= z - 0.01 && g <= z + 12, `${id} gate ${k} station ${g} vs z ${z}`);
    }
    assert.ok(Math.abs(r.lengthM - r.gateS[r.gateS.length - 1]!) < 1e-6);
    // The route's first point sits on the spawn and its height is the spawn deck.
    assert.ok(Math.abs(r.points[1]! - plan.layout.spawn.position[1]) < 1e-6, `${id} spawn height`);
  }
  // Known deck heights (MAP 1 §7): chaos run-out −11.728, isles leap landing −24.759, strip flat 0.
  const chaos = plans.chaos!;
  assert.ok(Math.abs(deckTopAt(chaos.decks, 16, 1739.5)! - -11.728) < 0.01);
  assert.ok(Math.abs(deckTopAt(plans.isles!.decks, 0, 1620)! - -24.759) < 0.01);
  assert.equal(deckTopAt(plans.strip!.decks, 0, 500), 0);
  assert.equal(deckTopAt(chaos.decks, 0, 1580), null, 'nothing under the big-jump gap');
  // The chaos route flies over the leap (height above the lip, landing on the run-out).
  const out = { x: 0, y: 0, z: 0, yaw: 0 };
  sampleRoute(routes.chaos!, 1580, out);
  assert.ok(out.y > 3 && out.y < 12, `arc over the leap: ${out.y}`);
  sampleRoute(routes.chaos!, routes.chaos!.lengthM - 1, out);
  assert.ok(Math.abs(out.y - -11.728) < 0.05, `run-out height ${out.y}`);
  // The collapsible tile field (z 284–332) is the road there: no arc over it.
  for (const z of [290, 300, 310, 320, 330]) {
    sampleRoute(routes.chaos!, z + 0.2, out);
    assert.ok(Math.abs(out.y) < 0.02, `tile field height at ${z}: ${out.y}`);
  }
  assert.deepEqual(routes.chaos!.flights.map(([a, b]) => [Math.round(routes.chaos!.cum[a]!), Math.round(routes.chaos!.cum[b]!)]), [[617, 625], [1534, 1630]], 'only the hop and the leap are flights');
  // Island: gates at the event's route indices, lengthM at the finish, run-out after it.
  for (const ev of world.events) {
    if (ev.mode !== 'race') continue;
    const r = routes[ev.id]!;
    assert.equal(r.gateS.length, ev.gates.length + 1);
    assert.ok(r.cum.length > ev.route.length / 3);
    assert.ok(Math.abs(r.lengthM - ev.lengthM) < 3, `${ev.id} length ${r.lengthM} vs ${ev.lengthM}`);
  }
});

test('speed plan: every race × every player car × every medal slot hits the target within 0.5 % inside the limits', () => {
  const others = DEFAULT_DRIVERS.slice(1);
  let planned = 0;
  let skipped = 0;
  for (const id of RACES) {
    for (const player of CAR_CLASS_IDS) {
      const medals = medalsFor(id, player);
      if (!medals) {
        skipped++;
        continue;
      }
      const rivals = planRivals({ route: routes[id]!, trackId: id, playerCarId: player, others, serial: 3, count: 3 });
      assert.equal(rivals.length, 3, `${id}/${player} three rivals`);
      assert.equal(new Set(rivals.map((r) => r.carId)).size, 3, 'distinct classes');
      assert.ok(rivals.every((r) => r.carId !== player), 'never the player class');
      assert.equal(new Set(rivals.map((r) => r.name)).size, 3, 'distinct drivers');
      assert.ok(rivals.every((r) => r.name !== DEFAULT_DRIVERS[0]!.name), 'never the active driver');
      for (const r of rivals) {
        planned++;
        const target = r.targetMs / 1000;
        const total = r.plan.totalS + r.reactionS;
        assert.ok(r.plan.feasible, `${id}/${player}/${r.medal} feasible with ${r.carId}`);
        assert.ok(Math.abs(total - target) <= target * 0.005, `${id}/${player}/${r.medal}: ${total.toFixed(2)} vs ${target}`);
        const lim = planLimits(r.plan);
        assert.ok(lim.maxV <= classTopSpeedMps(r.carId) + 1e-3, `${id} ${r.carId} v ${lim.maxV}`);
        assert.ok(lim.maxAcc <= A_ACC + 0.01, `${id} accel ${lim.maxAcc}`);
        assert.ok(lim.maxBrake <= A_BRAKE + 0.01, `${id} brake ${lim.maxBrake}`);
        assert.ok(r.reactionS >= 0.15 && r.reactionS <= 0.35);
        // Motion: the station is monotonic in time and reaches the finish exactly at the plan's end.
        let prev = -1;
        for (let t = 0; t <= r.plan.totalS; t += 0.25) {
          const s = stationAtTime(r.plan, t);
          assert.ok(s >= prev - 1e-6, 'station monotonic');
          prev = s;
        }
        assert.ok(Math.abs(stationAtTime(r.plan, r.plan.totalS) - routes[id]!.lengthM) < 0.05, 'finish at the line');
      }
    }
  }
  assert.ok(planned >= 200, `planned ${planned}`);
  // A class whose top speed cannot make the target is never picked for it: the buggy against chaos gold.
  const chaosGold = medalsFor('chaos', 'hypercar')!.gold / 1000;
  assert.ok(!planSpeeds(routes.chaos!, classTopSpeedMps('buggy'), chaosGold - 0.25).feasible);
  assert.ok(planSpeeds(routes.chaos!, classTopSpeedMps('formula'), chaosGold - 0.25).feasible);
  // Line-ups rotate run by run.
  const a = planRivals({ route: routes.ribbon!, trackId: 'ribbon', playerCarId: 'hypercar', others, serial: 1, count: 3 });
  const b = planRivals({ route: routes.ribbon!, trackId: 'ribbon', playerCarId: 'hypercar', others, serial: 2, count: 3 });
  assert.notDeepEqual(a.map((r) => r.name), b.map((r) => r.name));
  // One rival = the gold pace.
  const one = planRivals({ route: routes.ribbon!, trackId: 'ribbon', playerCarId: 'kart', others, serial: 0, count: 1 });
  assert.equal(one.length, 1);
  assert.equal(one[0]!.medal, 'gold');
  // No medals → nobody spawns.
  assert.deepEqual(planRivals({ route: routes.chaos!, trackId: 'chaos', playerCarId: 'buggy', others, serial: 0, count: 3 }), []);
  assert.equal(rivalPlate('Pixel Rae', 1), 'PIXEL RAE 22');
  assert.equal(rivalPlate('Mx. Glitch', 2), 'MX GLITCH 33');
});

test('standings: ranking, gaps, P n/N and the results line (faster / between / slower)', () => {
  resetStandingsForTests();
  const route = routes.ribbon!;
  setStandingsRoute(route);
  const offs = [
    registerParticipant({ id: 'player', name: 'Anaye', carId: 'hypercar', kind: 'player' }),
    registerParticipant({ id: 'r0', name: 'Volt', carId: 'formula', kind: 'rival' }),
    registerParticipant({ id: 'r1', name: 'Pixel Rae', carId: 'muscle', kind: 'rival' }),
    registerParticipant({ id: 'r2', name: 'Tarmac Tej', carId: 'kart', kind: 'rival' }),
    registerParticipant({ id: 'g', name: 'YOU · BEST', carId: 'hypercar', kind: 'ghost' }),
  ];
  setRaceClock(0);
  setProgress('player', 100);
  setProgress('r0', 150, 41000);
  setProgress('r1', 120, 47000);
  setProgress('r2', 80, 55000);
  setProgress('g', 400);
  publishStandings(true);
  let snap = standingsSnapshot();
  assert.equal(snap.total, 4, 'the ghost is not ranked');
  assert.deepEqual(
    snap.order.map((r) => r.id),
    ['r0', 'r1', 'player', 'r2'],
  );
  assert.equal(snap.playerPosition, 3);
  assert.equal(snap.order[0]!.gapS, null);
  assert.ok(snap.order[1]!.gapS! > 0);
  // Between: nearest rival ahead by metres → seconds estimate.
  let line = positionLine()!;
  assert.equal(line.position, 3);
  assert.match(line.text, /^P3 · [\d.]+ S BEHIND PIXEL RAE$/);
  // Progress never goes backwards through setProgress; rewind does.
  setProgress('player', 90);
  assert.equal(standingsSnapshot().order.find((r) => r.id === 'player')!.progressM, 100);
  rewindProgress('player', 50);
  publishStandings(true);
  assert.equal(standingsSnapshot().order.find((r) => r.id === 'player')!.progressM, 50);
  // Player faster than everyone: finished first.
  setRaceClock(40000);
  setProgress('player', route.lengthM);
  setFinished('player', 40000);
  snap = standingsSnapshot();
  assert.equal(snap.playerPosition, 1);
  line = positionLine()!;
  assert.match(line.text, /^P1 · AHEAD OF VOLT BY 1\.0 S$/);
  // Slower than everyone: rivals finish before the player does.
  setFinished('r0', 41000);
  setFinished('r1', 47000);
  setFinished('r2', 55000);
  resetStandingsForTests();
  setStandingsRoute(route);
  registerParticipant({ id: 'player', name: 'Anaye', carId: 'hypercar', kind: 'player' });
  registerParticipant({ id: 'r0', name: 'Volt', carId: 'formula', kind: 'rival' });
  registerParticipant({ id: 'r1', name: 'Pixel Rae', carId: 'muscle', kind: 'rival' });
  registerParticipant({ id: 'r2', name: 'Tarmac Tej', carId: 'kart', kind: 'rival' });
  setFinished('r0', 41000);
  setFinished('r1', 47000);
  setFinished('r2', 55000);
  setRaceClock(59100);
  setFinished('player', 59100);
  snap = standingsSnapshot();
  assert.equal(snap.playerPosition, 4);
  assert.deepEqual(snap.order.map((r) => r.id), ['r0', 'r1', 'r2', 'player']);
  assert.equal(positionLine()!.text, 'P4 · 4.1 S BEHIND TARMAC TEJ');
  // A human present: the line names the nearest human even when a rival is nearer.
  registerParticipant({ id: 'h', name: 'Friend', carId: 'coupe', kind: 'remote' });
  setFinished('h', 30000);
  assert.equal(positionLine()!.text, 'P5 · 29.1 S BEHIND FRIEND');
  // Route projection: clamped to the gate window and insensitive to lateral error.
  const p = new Vector3(2, 0, 300);
  const s1 = routeProgressOf(p, 1);
  assert.ok(s1 > 290 && s1 < 320, `station ${s1}`);
  assert.equal(routeProgressOf(new Vector3(0, 0, 10), 1), route.gateS[1], 'behind the last gate clamps to it');
  assert.equal(routeProgressOf(new Vector3(0, 0, 700), 1), route.gateS[2], 'past the next gate clamps to it');
  assert.equal(stationOnRoute(route, 0, -30, 0), 0);
  assert.equal(gatePassedAt(route, route.gateS[2]! + 1), 2);
  offs.forEach((off) => off());
  resetStandingsForTests();
});

test('ghost tape: 10 Hz samples round-trip through the 14-byte delta code within 1 cm, ≤ 64 KB', async () => {
  const { GhostRecorder, decodeTape, encodeTape, sampleTape, GHOST_MAX_SAMPLES } = await import('../src/rivals/ghost');
  const rec = new GhostRecorder();
  // A 90 s run at up to 60 m/s with a yawing car.
  let x = -620;
  let z = 335;
  for (let k = 0; k < 900; k++) {
    const v = Math.min(60, k * 0.1);
    const yaw = Math.sin(k * 0.01) * 1.2;
    x += Math.sin(yaw) * v * 0.1;
    z += Math.cos(yaw) * v * 0.1;
    rec.push(x, 6 + Math.sin(k * 0.05) * 2, z, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  }
  const tape = rec.tape('tessera-neon', 'hypercar', 56390);
  const bytes = encodeTape(tape);
  assert.equal(bytes.byteLength, 20 + 900 * 14);
  const back = decodeTape(bytes, 'tessera-neon', 'hypercar')!;
  assert.ok(back);
  assert.equal(back.n, 900);
  assert.equal(back.finishMs, 56390);
  for (let k = 0; k < 900; k++) {
    for (let a = 0; a < 3; a++) assert.ok(Math.abs(back.pos[k * 3 + a]! - tape.pos[k * 3 + a]!) <= 0.0051, `pos ${k}`);
    for (let a = 0; a < 4; a++) assert.ok(Math.abs(back.quat[k * 4 + a]! - tape.quat[k * 4 + a]!) <= 1e-4, `quat ${k}`);
  }
  const out = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  sampleTape(back, 45.05, out);
  assert.ok(Math.abs(out.x - (back.pos[450 * 3]! + back.pos[451 * 3]!) / 2) < 0.01, 'midpoint interpolation');
  assert.ok(Math.abs(Math.hypot(out.qx, out.qy, out.qz, out.qw) - 1) < 1e-6);
  assert.ok(20 + GHOST_MAX_SAMPLES * 14 <= 65536, 'tape cap under 64 KB');
  assert.equal(decodeTape(bytes.subarray(0, 100), 't', 'c'), null, 'truncated tape rejected');
});

test('rival assets: half-resolution bodies keep three rivals under 30 k triangles with plates', async () => {
  const { getRivalAssets } = await import('../src/rivals/rivalAssets');
  const tris: Record<string, number> = {};
  for (const id of CAR_CLASS_IDS) tris[id] = getRivalAssets(id, null).triangles + 12; // + the plate box
  const sorted = Object.values(tris).sort((a, b) => b - a);
  const heaviestThree = sorted[0]! + sorted[1]! + sorted[2]!;
  console.log('rival triangles per class (body + wing + 4 wheels + plate):', JSON.stringify(tris), 'heaviest three:', heaviestThree);
  assert.ok(heaviestThree <= 30000, `heaviest three rivals ${heaviestThree} triangles`);
  // A livery (ride + driver) builds too and is cached by key.
  const look = { ride: { ...(await import('../src/ride/config')).DEFAULT_RIDE, base: 'coupe' as const, paint: '#00F0FF' }, driver: DEFAULT_DRIVERS[1]!.avatar };
  const a = getRivalAssets('coupe', look);
  assert.equal(getRivalAssets('coupe', look), a, 'cached');
  assert.notEqual(a.lookKey, getRivalAssets('coupe', null).lookKey);
});
