import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAR_CLASSES,
  CAR_CLASS_IDS,
  assessBigJump,
  mapSquadControlsToPhysics,
  type BigJumpAssessment,
  type CarClassId,
} from '../../shared/protocol';
import { bestTopSpeedKmh, bigJumpHint, judgeSpeedTrap, landingSpeedFor, speedTrapNote } from '../src/squad/bigJump';
import { BIG_JUMP_MAPS } from '../src/squad/garage';

const at = (car: CarClassId, setting: string, lip = 183): BigJumpAssessment => {
  const [frontWingAero, engineTier, chassisBalance] = setting.split('/').map(Number) as [number, number, number];
  return assessBigJump(mapSquadControlsToPhysics({ frontWingAero, engineTier, chassisBalance }, car), car, lip);
};

describe('big-jump verdict rule (assessBigJump)', () => {
  it('pins the hypercar on the chaos jump', () => {
    // Tops out at 175.5, lift-off 178.8: it never reaches lift-off, so it is too slow, not nose-lift
    // (the pre-fix rule said NOSE LIFT, whose "add front wing" advice made it slower still).
    const slow = at('hypercar', '12/4/0');
    assert.equal(slow.verdict, 'TOO SLOW');
    assert.ok(slow.liftOffKmh! > slow.topSpeedKmh && slow.topSpeedKmh < slow.requiredKmh);
    // Fast enough, lift-off 1.2 km/h above top speed: inside the 12 km/h reserve. READY before the
    // garage; the sim lifts the nose at 192.3 km/h and runs off at the kink.
    assert.equal(at('hypercar', '8/5/-40').verdict, 'NOSE LIFT');
    assert.equal(at('hypercar', '20/5/-20').verdict, 'READY');
    // Too slow AND it reaches lift-off (121 < top 127): the nose does come up first.
    const slowNose = at('hypercar', '0/2/40');
    assert.equal(slowNose.verdict, 'NOSE LIFT');
    assert.ok(slowNose.liftOffKmh! < slowNose.topSpeedKmh && slowNose.topSpeedKmh < slowNose.requiredKmh);
  });

  it('pins one case per verdict for the other cars (sim-checked settings)', () => {
    assert.equal(at('rally', '0/5/0').verdict, 'NOSE LIFT'); // sim: nose up at 174.8, off the track
    assert.equal(at('muscle', '20/5/0').verdict, 'READY'); // sim: lip 182.6, clears
    assert.equal(at('formula', '22/5/-40').verdict, 'TOO SLOW'); // sim: lip 185.4, short
    assert.equal(at('buggy', '0/5/0').verdict, 'TOO SLOW'); // sim: lip 128.7, short
    assert.equal(at('rally', '0/4/10').verdict, 'TOO SLOW'); // top 169.6 < lift-off 172.9: never lifts
    assert.equal(at('muscle', '0/3/30').verdict, 'NOSE LIFT'); // lift-off 147.6 < top 150.9 < 185.6
    assert.equal(at('formula', '0/3/-20', 163).verdict, 'TOO SLOW'); // Isles: top 166.1 < lift-off 169.4
  });

  it('never calls NOSE LIFT for a too-slow car that tops out below its lift-off speed, on any car or map', () => {
    for (const car of CAR_CLASS_IDS) {
      for (const map of BIG_JUMP_MAPS) {
        for (let tier = 1; tier <= 5; tier++) {
          for (let wing = 0; wing <= 100; wing += 2) {
            for (let balance = -50; balance <= 50; balance += 5) {
              const j = at(car, `${wing}/${tier}/${balance}`, map.bigJumpKmh!);
              const tag = `${car} ${wing}/${tier}/${balance} on ${map.id}`;
              const tooSlow = j.topSpeedKmh < j.requiredKmh;
              const lifts = j.liftOffKmh !== null && j.liftOffKmh < j.topSpeedKmh + (tooSlow ? 0 : CAR_CLASSES[car].noseLiftReserveKmh);
              assert.equal(j.verdict, lifts ? 'NOSE LIFT' : tooSlow ? 'TOO SLOW' : 'READY', tag);
            }
          }
        }
      }
    }
  });
});

describe('big-jump hints match their verdict', () => {
  it('READY says go, NOSE LIFT says keep the nose down, TOO SLOW says find speed', () => {
    assert.match(bigJumpHint(at('hypercar', '20/5/-20'), CAR_CLASSES.hypercar), /Send it/);
    const nose = bigJumpHint(at('hypercar', '8/5/-40'), CAR_CLASSES.hypercar);
    assert.match(nose, /add front wing or shift Chassis Balance forward/);
    assert.doesNotMatch(nose, /Engine Tier/);
    const slow = bigJumpHint(at('hypercar', '12/4/0'), CAR_CLASSES.hypercar);
    assert.match(slow, /raise Engine Tier or trim the front wing/);
    assert.doesNotMatch(slow, /add front wing/);
    // Nose lift on a car that is too slow anyway: fix the nose, then find speed.
    const both = bigJumpHint(at('muscle', '0/3/30'), CAR_CLASSES.muscle);
    assert.match(both, /too slow/);
    assert.match(both, /raise Engine Tier/);
  });

  it("tells the Dune Goblin player that no setup reaches either jump, with the car's best", () => {
    const best = bestTopSpeedKmh(CAR_CLASSES.buggy);
    assert.ok(best.kmh > 130 && best.kmh < 140, `${best.kmh}`);
    for (const map of BIG_JUMP_MAPS) {
      const hint = bigJumpHint(at('buggy', '0/5/0', map.bigJumpKmh!), CAR_CLASSES.buggy);
      assert.match(hint, /^No setup gets the Dune Goblin to \d+ km\/h: its best estimate is 133 km\/h \(Engine Tier 5, 0 % wing\)\. Pick another car/);
    }
    // Cars that can get there keep the ordinary advice.
    for (const car of ['hypercar', 'rally', 'muscle', 'formula'] as const) {
      assert.ok(bestTopSpeedKmh(CAR_CLASSES[car]).kmh > 183 * CAR_CLASSES[car].jumpSpeedScale, car);
      assert.match(bigJumpHint(at(car, '50/1/0'), CAR_CLASSES[car]), /^Not enough top speed/);
    }
  });
});

describe('speed trap: judged against the lip speed that lands', () => {
  const isles = { trackId: 'isles', bigJumpKmh: 163 } as const;
  const chaos = { trackId: 'chaos', bigJumpKmh: 183 } as const;

  it('Cloudbreak Isles: the hypercar lands from 160.5 (the sign and the estimate say 163)', () => {
    const landing = landingSpeedFor({ carId: 'hypercar', ...isles })!;
    assert.deepEqual(landing, { kmh: 160.5, source: 'car' });
    assert.deepEqual(judgeSpeedTrap(161, landing), { cleared: true, marginKmh: 0.5, label: 'CLEARED +0.5' });
    assert.deepEqual(judgeSpeedTrap(158, landing), { cleared: false, marginKmh: -2.5, label: 'SHORT −2.5' });
    // Landed at 162 (sim: 80–85 % wing lands at 160.6–162.4) used to read "SHORT −1" against the 163 sign.
    assert.equal(judgeSpeedTrap(162, landing).label, 'CLEARED +1.5');
    // Sim: 160.0 fell at 87 % wing.
    assert.equal(judgeSpeedTrap(160, landing).cleared, false);
    assert.equal(speedTrapNote(landing, 163, 'hypercar'), 'lands from 160.5 km/h · measured for this car · lip sign 163');
  });

  it('uses per-car measurements where they exist', () => {
    assert.deepEqual(landingSpeedFor({ carId: 'rally', ...chaos }), { kmh: 184, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'muscle', ...chaos }), { kmh: 182, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'formula', ...chaos }), { kmh: 188.5, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'muscle', ...isles }), { kmh: 156.5, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'hypercar', ...chaos }), { kmh: 183.5, source: 'car' });
    assert.equal(speedTrapNote({ kmh: 183, source: 'car' }, 183, 'hypercar'), 'lands from 183.0 km/h (the lip sign) · measured for this car');
    // Sim, chaos jump: the hypercar fell at 183.4 (35 % wing) and the Glitch Rally at 183.5; every run from 184 landed.
    assert.equal(judgeSpeedTrap(183.4, landingSpeedFor({ carId: 'hypercar', ...chaos })!).label, 'SHORT −0.1');
    const rally = landingSpeedFor({ carId: 'rally', ...chaos })!;
    assert.equal(judgeSpeedTrap(183.5, rally).label, 'SHORT −0.5');
    assert.equal(judgeSpeedTrap(184.3, rally).label, 'CLEARED +0.3');
  });

  it("falls back to the hypercar's number (and says so) for a car nobody measured, or the sign for maps it doesn't know", () => {
    const buggy = landingSpeedFor({ carId: 'buggy', ...isles })!;
    assert.deepEqual(buggy, { kmh: 160.5, source: 'hypercar' });
    assert.match(speedTrapNote(buggy, 163, 'buggy'), /with the Neon Hypercar · this car may need a few km\/h more or less/);
    assert.deepEqual(landingSpeedFor({ carId: 'hover-tank', ...isles }), { kmh: 160.5, source: 'hypercar' });
    // A map this build doesn't know, or a game whose lip differs from our copy: only the lip is trusted.
    assert.deepEqual(landingSpeedFor({ carId: 'rally', trackId: 'volcano', bigJumpKmh: 170 }), { kmh: 170, source: 'sign' });
    assert.deepEqual(landingSpeedFor({ carId: 'rally', trackId: 'isles', bigJumpKmh: 165 }), { kmh: 165, source: 'sign' });
    assert.deepEqual(landingSpeedFor({ carId: 'hypercar', trackId: null, bigJumpKmh: 183 }), { kmh: 183, source: 'sign' });
    assert.equal(landingSpeedFor({ carId: 'hypercar', trackId: 'strip', bigJumpKmh: null }), null);
  });

  it('every landing speed is a real, plausible number for a car that exists', () => {
    for (const map of BIG_JUMP_MAPS) {
      assert.ok(map.landKmh! > 0.95 * map.bigJumpKmh! && map.landKmh! < 1.05 * map.bigJumpKmh!, map.id);
      for (const [car, kmh] of Object.entries(map.landKmhByCar ?? {})) {
        assert.ok((CAR_CLASS_IDS as readonly string[]).includes(car), `${map.id} ${car}`);
        assert.ok(kmh > 0.9 * map.bigJumpKmh! && kmh < 1.1 * map.bigJumpKmh!, `${map.id} ${car} ${kmh}`);
      }
    }
  });
});
