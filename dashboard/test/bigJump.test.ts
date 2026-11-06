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
import {
  NO_SPEED_TRAP_WATCH,
  bestTopSpeedKmh,
  bigJumpHint,
  judgeSpeedTrap,
  landingSpeedFor,
  liftOffNearTopSpeed,
  speedTrapNote,
  watchSpeedTrap,
  type JumpAttempt,
  type SpeedTrapWatch,
} from '../src/squad/bigJump';
import { BIG_JUMP_MAPS } from '../src/squad/garage';
import { JUMP_PRESETS } from '../src/squad/presets';

const at = (car: CarClassId, setting: string, lip = 183): BigJumpAssessment => {
  const [frontWingAero, engineTier, chassisBalance] = setting.split('/').map(Number) as [number, number, number];
  return assessBigJump(mapSquadControlsToPhysics({ frontWingAero, engineTier, chassisBalance }, car), car, lip);
};
const tierOf = (setting: string): number => Number(setting.split('/')[1]);
/** The hint the card shows for this setting (it passes the setting's Engine Tier). */
const hintAt = (car: CarClassId, setting: string, lip = 183): string => bigJumpHint(at(car, setting, lip), CAR_CLASSES[car], tierOf(setting));

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
    assert.equal(at('rally', '0/4/10').verdict, 'TOO SLOW'); // top 169.6 < lift-off 173.5 (172.9 before Handling v2): never lifts
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
    assert.match(hintAt('hypercar', '20/5/-20'), /Send it/);
    const nose = hintAt('hypercar', '8/5/-40');
    assert.match(nose, /add front wing or shift Chassis Balance forward/);
    assert.doesNotMatch(nose, /Engine Tier/);
    // Clearly too slow with the nose well planted (lift-off 14.6 km/h above top speed): find speed anywhere.
    const slow = hintAt('hypercar', '15/4/0');
    assert.match(slow, /raise Engine Tier or trim the front wing/);
    assert.doesNotMatch(slow, /add front wing/);
    // Nose lift on a car that is too slow anyway: fix the nose, then find speed.
    const both = hintAt('muscle', '0/3/30');
    assert.match(both, /too slow/);
    assert.match(both, /raise Engine Tier/);
  });

  it('TOO SLOW with lift-off close to top speed says keep the wing (the sim lifts the nose there)', () => {
    // Sim (chaos jump, standstill at the checkpoint, full throttle): each of these is TOO SLOW and lifted
    // its nose or ran off the track before the lip. Trimming the wing would lower lift-off further.
    // Hypercar gaps re-pinned for its Handling v2 engine (shared/cars/hypercar.ts): past the top-gear fit
    // point the torque curve falls, so above top speed the drive unloads the nose less (3.3 → 3.8, 10.0 → 13.4);
    // its reserve is 15 km/h now, so 27/4/50 still counts as "lift-off close to top speed".
    // Rally gap re-pinned for its v2 engine and 1.14 μ tyres (shared/cars/rally.ts) the same way (2.1 → 2.51); the
    // v2 sim still lifts the nose at 5/4/30 (at 164.6, off the track before the lip).
    const lifted: [CarClassId, string, number][] = [
      ['hypercar', '12/4/0', 3.79], // nose up at 171.5 km/h, off the track
      ['rally', '5/4/30', 2.51], // nose up at 163.4 (v2: 164.6)
      ['muscle', '18/4/36', 6.5], // nose up at 163.9
      ['hypercar', '27/4/50', 13.44], // nose up at 166.6: the largest gap that lifted
      ['muscle', '20/4/40', 8.7], // nose up at 163.9
      // Formula re-pinned for its Handling v2 aero (shared/cars/formula.ts: 4.0 × wing − 1.0 body lift, rear 1.4,
      // μ 1.4, sized to the plan's 1.6 g / 2.4 g lateral row): gap 4.6 → 2.35; the v2 sim still lifts at 182.2 and
      // runs off. Its 1/4/−40 (gap 2.0 before) now has lift-off 33.7 km/h above top speed: planted list below.
      ['formula', '6/4/20', 2.35], // fell before the lip
    ];
    // Rally 17/5/50 ran off at the kink on both trees (v2: no nose-lift flag before it left the road), but its v2
    // estimate puts lift-off 12.6 km/h above top speed, past the rally's 10 km/h reserve, so the hint no longer
    // says "balance forward first". Stage C re-measures the lift windows and sets the reserve (the hypercar's went
    // 12 → 15 for the same reason); until then only the verdict and the gap are pinned here.
    {
      const j = at('rally', '17/5/50');
      assert.equal(j.verdict, 'TOO SLOW');
      assert.ok(Math.abs(j.liftOffKmh! - j.topSpeedKmh - 12.63) < 0.1, `rally 17/5/50 gap ${j.liftOffKmh! - j.topSpeedKmh}`);
    }
    for (const [car, setting, gap] of lifted) {
      const j = at(car, setting);
      assert.equal(j.verdict, 'TOO SLOW', `${car} ${setting}`);
      assert.ok(Math.abs(j.liftOffKmh! - j.topSpeedKmh - gap) < 0.1, `${car} ${setting} gap ${j.liftOffKmh! - j.topSpeedKmh}`);
      const hint = bigJumpHint(j, CAR_CLASSES[car], tierOf(setting));
      if (tierOf(setting) === 5) assert.match(hint, /^Not enough top speed, and less wing lifts the nose at this balance .*: move Chassis Balance forward first, then trim the front wing/, `${car} ${setting}`);
      else assert.match(hint, /^Not enough top speed: raise Engine Tier and keep the front wing/, `${car} ${setting}`);
      // Never "trim" on its own: at the top tier only after the balance has gone forward.
      if (tierOf(setting) === 5) assert.match(hint, /forward first, then trim/, `${car} ${setting}`);
      else assert.doesNotMatch(hint, /trim/, `${car} ${setting}`);
    }
    assert.equal(
      hintAt('hypercar', '12/4/0'),
      'Not enough top speed: raise Engine Tier and keep the front wing (lift-off 179 km/h is close to top speed 176; less wing lifts the nose). More engine lifts it too: if it turns NOSE LIFT, add wing or move the balance forward.',
    );
    assert.match(hintAt('rally', '5/4/30'), /lift-off 170 km\/h is close to top speed 168/);

    // Too slow with lift-off at or past the car's reserve: none of these lifted in the sim, and the
    // ordinary advice stands. No lift-off at all (wing out-pulls body lift): the same.
    const planted: [CarClassId, string][] = [
      ['hypercar', '6/4/-40'], // gap 14.9, lip 174.6, short
      ['muscle', '11/4/0'], // gap 14.9
      ['rally', '1/4/0'], // gap 14.5
      ['formula', '5/4/0'], // gap 20.6 (13.2 before the v2 aero); sim: short at 183.4
      ['formula', '1/4/-40'], // gap 33.7 (2.0 before the v2 aero, when it lifted at 183.6); v2 sim: no lift, clears from 188.3
      ['hypercar', '50/3/0'], // never lifts
    ];
    for (const [car, setting] of planted) {
      const j = at(car, setting);
      assert.equal(j.verdict, 'TOO SLOW', `${car} ${setting}`);
      assert.equal(bigJumpHint(j, CAR_CLASSES[car], tierOf(setting)), 'Not enough top speed: raise Engine Tier or trim the front wing (less drag).', `${car} ${setting}`);
    }
  });

  it('never tells a too-slow car with lift-off inside its reserve to trim the wing, on any car or map', () => {
    for (const car of CAR_CLASS_IDS) {
      const k = CAR_CLASSES[car];
      for (const map of BIG_JUMP_MAPS) {
        for (let tier = 1; tier <= 5; tier++) {
          for (let wing = 0; wing <= 100; wing += 2) {
            for (let balance = -50; balance <= 50; balance += 5) {
              const j = at(car, `${wing}/${tier}/${balance}`, map.bigJumpKmh!);
              if (j.verdict !== 'TOO SLOW') continue;
              const tag = `${car} ${wing}/${tier}/${balance} on ${map.id}`;
              const near = j.liftOffKmh !== null && j.liftOffKmh < j.topSpeedKmh + k.noseLiftReserveKmh;
              assert.equal(liftOffNearTopSpeed(j, k), near, tag);
              const hint = bigJumpHint(j, k, tier);
              if (near && bestTopSpeedKmh(k).kmh >= j.requiredKmh) assert.match(hint, tier === 5 ? /move Chassis Balance forward first/ : /keep the front wing/, tag);
              if (near && tier === 5) assert.doesNotMatch(hint.replace('forward first, then trim', ''), /trim/, tag);
              else if (near) assert.doesNotMatch(hint, /trim/, tag);
              else assert.doesNotMatch(hint, /keep the front wing/, tag);
            }
          }
        }
      }
    }
  });

  it('at the top Engine Tier never asks for more tier: balance forward first, then less wing (sim-checked)', () => {
    // Sim (chaos, standstill at the jump checkpoint, full throttle): rally 5/5/0 falls short at 179.8 and
    // trimming to 3/5/0 lifts the nose; 5/5/-40 clears at 184.3, 2/5/-40 at 185.0. Muscle 23/5/30 lifts at
    // 182.4; 20/5/0 clears at 182.6.
    assert.equal(
      hintAt('rally', '5/5/0'),
      // Lift-off 194 before Handling v2: past the top-gear fit point the rally's torque curve falls, so above top speed the
      // drive unloads the nose a little less (195.3 now, with the 1.14 μ tyres' grip cap in the estimate).
      'Not enough top speed, and less wing lifts the nose at this balance (lift-off 195 km/h is close to top speed 188): move Chassis Balance forward first, then trim the front wing, or tap the JUMP ATTEMPT preset.',
    );
    assert.match(hintAt('muscle', '23/5/30'), /^Not enough top speed, and less wing lifts the nose at this balance .*move Chassis Balance forward first/);
    assert.equal(at('rally', '2/5/-40').verdict, 'READY'); // its JUMP ATTEMPT preset
    assert.equal(at('muscle', '20/5/0').verdict, 'READY'); // its JUMP ATTEMPT preset

    let topTierFixes = 0;
    const fixesByCar: Partial<Record<CarClassId, number>> = {};
    for (const car of CAR_CLASS_IDS) {
      const k = CAR_CLASSES[car];
      const preset = JUMP_PRESETS[car].controls;
      for (const map of BIG_JUMP_MAPS) {
        for (let wing = 0; wing <= 100; wing++) {
          for (let balance = -50; balance <= 50; balance++) {
            const setting = `${wing}/5/${balance}`;
            const j = at(car, setting, map.bigJumpKmh!);
            const hint = bigJumpHint(j, k, 5);
            const tag = `${car} ${setting} on ${map.id}`;
            assert.doesNotMatch(hint, /raise Engine Tier/, tag);
            if (!hint.includes('JUMP ATTEMPT')) continue;
            topTierFixes++;
            fixesByCar[car] = (fixesByCar[car] ?? 0) + 1;
            // The advice holds: the car's JUMP ATTEMPT preset is READY here, at tier 5 with the balance
            // further forward and less wing than this setting.
            assert.equal(at(car, `${preset.frontWingAero}/${preset.engineTier}/${preset.chassisBalance}`, map.bigJumpKmh!).verdict, 'READY', tag);
            assert.equal(preset.engineTier, 5, tag);
            assert.ok(preset.chassisBalance <= balance && preset.frontWingAero <= wing, tag);
          }
        }
      }
    }
    // rally 335 (360 before Handling v2: its geared engine lifts the nose a little later above top speed, so the
    // window where "less wing lifts the nose" is narrower) + muscle 108 on chaos (the lift-off window, then NOSE
    // LIFT while too slow) + kart 29 on the Isles (its only reachable jump, where its JUMP
    // ATTEMPT 10/T5/−30 is READY; 37 before its single-speed v2 curve — 98 % of the top-end torque at the launch
    // floor, 104 % at 80 % of the redline — moved a few low-wing / rearward lift-off estimates past the 8 km/h
    // reserve). The four newer road cars add none: their presets sit inside wide READY windows (the coupe's v2
    // engine briefly added 22 at its old 1.5 μ; at 1.27 μ the grip cap in the lift-off estimate puts them back).
    assert.equal(fixesByCar.rally, 335, 'rally on chaos');
    assert.equal(fixesByCar.muscle, 108, 'muscle on chaos');
    assert.equal(fixesByCar.kart, 29, 'kart on the Isles');
    assert.equal(topTierFixes, 335 + 108 + 29, 'rally + muscle on chaos, kart on the Isles');
  });

  it("tells the Dune Goblin player that no setup reaches either jump, with the car's best", () => {
    const best = bestTopSpeedKmh(CAR_CLASSES.buggy);
    assert.ok(best.kmh > 130 && best.kmh < 140, `${best.kmh}`);
    for (const map of BIG_JUMP_MAPS) {
      const hint = hintAt('buggy', '0/5/0', map.bigJumpKmh!);
      assert.match(hint, /^No setup gets the Dune Goblin to \d+ km\/h: its best estimate is 133 km\/h \(Engine Tier 5, 0 % wing\)\. Pick another car/);
    }
    // Cars that can get there keep the ordinary advice.
    for (const car of ['hypercar', 'rally', 'muscle', 'formula'] as const) {
      assert.ok(bestTopSpeedKmh(CAR_CLASSES[car]).kmh > 183 * CAR_CLASSES[car].jumpSpeedScale, car);
      assert.match(hintAt(car, '50/1/0'), /^Not enough top speed/);
    }
  });
});

describe('speed trap: judged against the lip speed that lands', () => {
  const isles = { trackId: 'isles', bigJumpKmh: 163 } as const;
  const chaos = { trackId: 'chaos', bigJumpKmh: 183 } as const;

  const guess = (trapKmh: number): Pick<JumpAttempt, 'trapKmh' | 'outcome'> => ({ trapKmh, outcome: 'pending' });

  it('Cloudbreak Isles: the hypercar lands from 160.5 (the sign and the estimate say 163)', () => {
    const landing = landingSpeedFor({ carId: 'hypercar', ...isles })!;
    assert.deepEqual(landing, { kmh: 160.5, source: 'car' });
    // While the outcome is unknown the card guesses from the landing speed, in neutral colours.
    const likely = judgeSpeedTrap(guess(161), landing);
    assert.equal(likely.label, 'LIKELY CLEARS +0.5');
    assert.equal(likely.settled, false);
    assert.equal(judgeSpeedTrap(guess(158), landing).label, 'LIKELY SHORT −2.5');
    // Landed at 162 (sim: 80–85 % wing lands at 160.6–162.4) used to read "SHORT −1" against the 163 sign.
    assert.equal(judgeSpeedTrap(guess(162), landing).label, 'LIKELY CLEARS +1.5');
    // Sim: 160.0 fell at 87 % wing.
    assert.equal(judgeSpeedTrap(guess(160), landing).verdict, 'LIKELY SHORT');
    assert.equal(speedTrapNote(landing, 163, 'hypercar'), 'lands from 160.5 km/h · measured for this car · lip sign 163');
  });

  it('settles on what happened: CLEARED after a finish, SHORT after a fall, whatever the margin', () => {
    // Razorwing on the Isles landed at 161.6 (reviewer run, 23 / 4 / 0), 2.9 under its 164.5.
    const formulaIsles = landingSpeedFor({ carId: 'formula', ...isles })!;
    const landed = judgeSpeedTrap({ trapKmh: 161.6, outcome: 'cleared' }, formulaIsles);
    assert.deepEqual(landed, {
      verdict: 'CLEARED',
      settled: true,
      marginKmh: landed.marginKmh,
      label: 'CLEARED −2.9',
      status: 'Landed: the run finished, 2.9 km/h under the measured landing speed (164.5). Little to spare.',
    });
    assert.ok(Math.abs(landed.marginKmh + 2.9) < 1e-9);
    // Bruiser V8 on chaos: 183 at the lip is 1.0 over its 182, and it fell anyway.
    const muscleChaos = landingSpeedFor({ carId: 'muscle', ...chaos })!;
    const fell = judgeSpeedTrap({ trapKmh: 183, outcome: 'short' }, muscleChaos);
    assert.equal(fell.label, 'SHORT +1.0');
    assert.equal(fell.status, 'Fell after this lip reading, though it was over the measured landing speed (182.0).');
    assert.equal(judgeSpeedTrap({ trapKmh: 180, outcome: 'short' }, muscleChaos).status, 'Fell after this lip reading.');
    assert.equal(judgeSpeedTrap({ trapKmh: 184, outcome: 'cleared' }, muscleChaos).status, 'Landed: the run finished.');
    assert.equal(judgeSpeedTrap(guess(183), muscleChaos).status, 'No finish or fall seen yet: a guess from the landing speed.');
  });

  it('uses per-car measurements where they exist', () => {
    assert.deepEqual(landingSpeedFor({ carId: 'rally', ...chaos }), { kmh: 184, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'muscle', ...chaos }), { kmh: 182, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'formula', ...chaos }), { kmh: 188.5, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'muscle', ...isles }), { kmh: 156.5, source: 'car' });
    assert.deepEqual(landingSpeedFor({ carId: 'hypercar', ...chaos }), { kmh: 183.5, source: 'car' });
    assert.equal(speedTrapNote({ kmh: 183, source: 'car' }, 183, 'hypercar'), 'lands from 183.0 km/h (the lip sign) · measured for this car');
    // Sim, chaos jump: the hypercar fell at 183.4 (35 % wing) and the Glitch Rally at 183.5; every run from 184 landed.
    assert.equal(judgeSpeedTrap(guess(183.4), landingSpeedFor({ carId: 'hypercar', ...chaos })!).label, 'LIKELY SHORT −0.1');
    const rally = landingSpeedFor({ carId: 'rally', ...chaos })!;
    assert.equal(judgeSpeedTrap(guess(183.5), rally).label, 'LIKELY SHORT −0.5');
    assert.equal(judgeSpeedTrap(guess(184.3), rally).label, 'LIKELY CLEARS +0.3');
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

describe('speed trap outcome: watchSpeedTrap follows the telemetry stream', () => {
  /** elapsedMs defaults to 50 000 once finished (the game freezes it at the finish) and 30 000 before. */
  type Frame = [speedTrapKmh: number | null, falls: number, finished: boolean, elapsedMs?: number];
  /** Feed frames in order from `start`; returns every attempt seen and the final watch. */
  const feed = (frames: Frame[], start: SpeedTrapWatch = NO_SPEED_TRAP_WATCH) => {
    let w = start;
    const seen: (JumpAttempt | null)[] = [];
    for (const [speedTrapKmh, falls, finished, elapsedMs = finished ? 50_000 : 30_000] of frames) {
      w = watchSpeedTrap(w, { speedTrapKmh, falls, finished, elapsedMs });
      seen.push(w.attempt);
    }
    return { w, seen, last: w.attempt };
  };
  const outcomes = (seen: (JumpAttempt | null)[]) => seen.map((a) => (a === null ? null : `${a.trapKmh}:${a.outcome}`));

  it('a reading below the landing speed followed by the finish is CLEARED (formula, Isles, 161.6 vs 164.5)', () => {
    const run = feed([
      [null, 0, false],
      [161.6, 0, false], // over the lip: in the air
      [161.6, 0, false],
      [161.6, 0, true], // finish line, 36 m into the run-out
    ]);
    assert.deepEqual(outcomes(run.seen), [null, '161.6:pending', '161.6:pending', '161.6:cleared']);
    const landing = landingSpeedFor({ carId: 'formula', trackId: 'isles', bigJumpKmh: 163 })!;
    assert.equal(judgeSpeedTrap(run.seen[1]!, landing).label, 'LIKELY SHORT −2.9');
    assert.equal(judgeSpeedTrap(run.last!, landing).label, 'CLEARED −2.9');
  });

  it('a reading above the landing speed followed by a fall is SHORT (muscle, chaos, 183 vs 182)', () => {
    const run = feed([
      [null, 0, false],
      [183, 0, false],
      [183, 1, false], // dropped into the void under the landing
      [183, 1, false], // respawned at the run-up checkpoint: the reading stays
    ]);
    assert.deepEqual(outcomes(run.seen), [null, '183:pending', '183:short', '183:short']);
    const landing = landingSpeedFor({ carId: 'muscle', trackId: 'chaos', bigJumpKmh: 183 })!;
    assert.equal(judgeSpeedTrap(run.seen[1]!, landing).label, 'LIKELY CLEARS +1.0');
    assert.equal(judgeSpeedTrap(run.last!, landing).label, 'SHORT +1.0');
  });

  it('a restart (or a car / map change) clears it, and the next jump starts fresh', () => {
    const run = feed([
      [183, 0, false],
      [183, 1, false],
      [null, 0, false], // restart: fresh run, the game clears speedTrapKmh
      [null, 0, false],
      [184.2, 0, false],
    ]);
    assert.deepEqual(outcomes(run.seen), ['183:pending', '183:short', null, null, '184.2:pending']);
    // A restart whose null frames we never saw (link down): the fall count went backwards.
    const missed = feed([
      [183, 2, false],
      [183, 3, false],
      [183, 0, false],
    ]);
    assert.deepEqual(outcomes(missed.seen), ['183:pending', '183:short', '183:pending']);
  });

  it('a second attempt after a fall gets its own verdict', () => {
    const run = feed([
      [181, 0, false],
      [181, 1, false], // short
      [181, 2, false], // the retry lifted its nose on the run-up and fell before the lip: still the old reading
      [186.4, 2, false], // second crossing
      [186.4, 2, true],
    ]);
    assert.deepEqual(outcomes(run.seen), ['181:pending', '181:short', '181:short', '186.4:pending', '186.4:cleared']);
    // Retry at exactly the same lip speed: the reading doesn't change, but the finish proves it landed.
    const same = feed([
      [183.5, 0, false],
      [183.5, 1, false],
      [183.5, 1, false],
      [183.5, 1, true],
    ]);
    assert.deepEqual(outcomes(same.seen), ['183.5:pending', '183.5:short', '183.5:short', '183.5:cleared']);
  });

  it('a dashboard that joins mid-run judges only what it can prove', () => {
    // Joins after the finish: the finish line is only reachable over the jump, so the reading landed.
    assert.equal(feed([[188.1, 0, true]]).last!.outcome, 'cleared');
    // Joins with the car in the air, or after a fall it never saw: unknown until the finish or a fall.
    assert.deepEqual(outcomes(feed([[183, 1, false], [183, 1, true]]).seen), ['183:pending', '183:cleared']);
    assert.deepEqual(outcomes(feed([[183, 1, false], [183, 2, false]]).seen), ['183:pending', '183:short']);
    // Frames missed across the whole jump: before it no reading, after it finished.
    assert.equal(feed([[null, 0, false], [184, 0, true]]).last!.outcome, 'cleared');
    // Frames missed across a fall AND a new crossing: can't tell which came first, so it stays a guess.
    assert.deepEqual(outcomes(feed([[181, 0, false], [184, 1, false]]).seen), ['181:pending', '184:pending']);
  });

  it('a crossing after the finish can only go SHORT or stay a guess', () => {
    // Flipped against the end wall after finishing, respawned at the run-up, jumped again for fun.
    const run = feed([
      [185, 0, false],
      [185, 0, true],
      [187, 0, true],
      [187, 0, true],
      [190, 0, true],
      [190, 1, true],
    ]);
    assert.deepEqual(outcomes(run.seen), ['185:pending', '185:cleared', '187:pending', '187:pending', '190:pending', '190:short']);
  });

  it('a dashboard that missed a restart sees the next finish by its new finish time', () => {
    // Run 1 finished (CLEARED); the link drops; the game restarts, crosses at 184.0 and finishes in 46.6 s;
    // the relay's next frame is that finish. Same finished flag, different finish time: a new finish.
    const run = feed([
      [186.2, 0, false, 40_000],
      [186.2, 0, true, 48_000],
      [186.2, 0, true, 48_000],
      [184, 0, true, 46_600],
      [184, 0, true, 46_600],
    ]);
    assert.deepEqual(outcomes(run.seen), ['186.2:pending', '186.2:cleared', '186.2:cleared', '184:cleared', '184:cleared']);
    // The same flag and time is the same finish: a crossing after it is still only a guess.
    const after = feed([
      [185, 0, false, 40_000],
      [185, 0, true, 47_000],
      [171.3, 0, true, 47_000],
    ]);
    assert.deepEqual(outcomes(after.seen), ['185:pending', '185:cleared', '171.3:pending']);
  });

  it('a dashboard that joins after the finish lets a later fall overrule its CLEARED', () => {
    // Joins while a jump made after the finish (RESPAWN keeps finished = true) is in the air; it falls.
    assert.deepEqual(outcomes(feed([[171.3, 0, true], [171.3, 0, true], [171.3, 1, true]]).seen), ['171.3:cleared', '171.3:cleared', '171.3:short']);
    // A finish this dashboard saw happen stays CLEARED whatever comes after it without a new crossing.
    assert.deepEqual(outcomes(feed([[186, 0, false], [186, 0, true], [186, 1, true]]).seen), ['186:pending', '186:cleared', '186:cleared']);
    // A new finish it saw after joining is not "on join" any more.
    const later = feed([[171.3, 0, true], [null, 0, false], [184, 0, false], [184, 0, true, 46_000], [184, 1, true, 46_000]]);
    assert.deepEqual(outcomes(later.seen), ['171.3:cleared', null, '184:pending', '184:cleared', '184:cleared']);
  });

  it('keeps the same attempt object while nothing changes (no re-render at 10 Hz)', () => {
    const a = watchSpeedTrap(NO_SPEED_TRAP_WATCH, { speedTrapKmh: 183, falls: 0, finished: false, elapsedMs: 40_000 });
    const b = watchSpeedTrap(a, { speedTrapKmh: 183, falls: 0, finished: false, elapsedMs: 40_100 });
    assert.equal(b.attempt, a.attempt);
    const c = watchSpeedTrap(b, { speedTrapKmh: 183, falls: 0, finished: true, elapsedMs: 41_000 });
    const d = watchSpeedTrap(c, { speedTrapKmh: 183, falls: 1, finished: true, elapsedMs: 41_000 });
    assert.notEqual(c.attempt, b.attempt);
    assert.equal(d.attempt, c.attempt);
  });
});
