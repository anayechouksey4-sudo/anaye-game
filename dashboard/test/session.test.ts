import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BIG_JUMP_LIP_KMH,
  CAR_CLASSES,
  CAR_CLASS_IDS,
  DEFAULT_SQUAD_CONTROLS,
  assessBigJump,
  clampSquadControls,
  estimateTopSpeedKmh,
  mapSquadControlsToPhysics,
  requiredJumpKmh,
} from '../../shared/protocol';
import { BIG_JUMP_MAPS, describeCar, describeMap, labelFromId } from '../src/squad/garage';
import { JUMP_PRESETS, PRESETS, presetsFor } from '../src/squad/presets';
import { DEFAULT_SESSION, mergeSession, previewSetup, sessionEqual, sessionInfoOf, type PlaySession } from '../src/squad/session';

const JUMP = { frontWingAero: 20, engineTier: 5, chassisBalance: -20 };

describe('play session', () => {
  it('defaults to the hypercar on the chaos map with its 183 km/h lip', () => {
    assert.deepEqual({ ...DEFAULT_SESSION }, { carId: 'hypercar', trackId: 'chaos', bigJumpKmh: BIG_JUMP_LIP_KMH, source: 'default' });
  });

  it('takes the fields a game:state carries and keeps the rest while a map loads', () => {
    const rally = mergeSession(DEFAULT_SESSION, { carId: 'rally', trackId: 'isles', bigJumpKmh: 163 }, 'game');
    assert.deepEqual(rally, { carId: 'rally', trackId: 'isles', bigJumpKmh: 163, source: 'game' });
    // The game sends only the car until the next map registers: don't flash back to chaos / 183.
    const loading = mergeSession(rally, { carId: 'muscle' }, 'game');
    assert.deepEqual(loading, { carId: 'muscle', trackId: 'isles', bigJumpKmh: 163, source: 'game' });
    // A map without a big jump reports null, which must survive the merge (it is not "missing").
    const strip = mergeSession(loading, { carId: 'muscle', trackId: 'strip', bigJumpKmh: null }, 'game');
    assert.equal(strip.bigJumpKmh, null);
    assert.equal(mergeSession(strip, { carId: 'formula' }, 'game').bigJumpKmh, null);
  });

  it('treats a game:state with no session fields as a pre-garage game: hypercar, 183 km/h, map unknown', () => {
    const before: PlaySession = { carId: 'buggy', trackId: 'strip', bigJumpKmh: null, source: 'game' };
    assert.deepEqual(mergeSession(before, {}, 'game'), { carId: 'hypercar', trackId: null, bigJumpKmh: BIG_JUMP_LIP_KMH, source: 'game' });
  });

  it('pulls only the session fields out of a parsed game:state', () => {
    const message = { carId: 'rally', trackId: undefined, bigJumpKmh: null, physics: {} } as const;
    assert.deepEqual(sessionInfoOf(message), { carId: 'rally', bigJumpKmh: null });
    assert.ok(sessionEqual(DEFAULT_SESSION, { ...DEFAULT_SESSION }));
    assert.ok(!sessionEqual(DEFAULT_SESSION, { ...DEFAULT_SESSION, source: 'snapshot' }));
  });
});

describe('setup preview', () => {
  it('matches the pre-garage numbers for the hypercar on the chaos map', () => {
    const preview = previewSetup(JUMP, DEFAULT_SESSION);
    assert.deepEqual(preview.physics, mapSquadControlsToPhysics(JUMP));
    assert.deepEqual(preview.jump, assessBigJump(mapSquadControlsToPhysics(JUMP)));
    assert.equal(preview.jump?.verdict, 'READY');
  });

  it("maps the sliders with the session's car and scales the map's lip speed for it", () => {
    const preview = previewSetup(JUMP, { carId: 'rally', bigJumpKmh: 163 });
    assert.equal(preview.car, CAR_CLASSES.rally);
    assert.deepEqual(preview.physics, mapSquadControlsToPhysics(JUMP, 'rally'));
    assert.notDeepEqual(preview.physics, mapSquadControlsToPhysics(JUMP));
    assert.equal(preview.jump?.requiredKmh, requiredJumpKmh(163, 'rally'));
    assert.ok(Math.abs(preview.jump!.requiredKmh - 163 * CAR_CLASSES.rally.jumpSpeedScale) < 1e-9);
    // The same tune clears Cloudbreak Isles' 163 km/h leap but not the chaos track's 183.
    assert.equal(preview.jump?.verdict, 'READY');
    assert.equal(previewSetup(JUMP, { carId: 'rally', bigJumpKmh: 183 }).jump?.verdict, 'TOO SLOW');
  });

  it('gives no verdict on a map without a big jump, but still estimates the speeds', () => {
    const preview = previewSetup(DEFAULT_SQUAD_CONTROLS, { carId: 'formula', bigJumpKmh: null });
    assert.equal(preview.jump, null);
    const physics = mapSquadControlsToPhysics(DEFAULT_SQUAD_CONTROLS, 'formula');
    assert.equal(preview.topSpeedKmh, estimateTopSpeedKmh(physics, 'formula'));
  });

  it('previews an unknown car id as the hypercar', () => {
    const preview = previewSetup(JUMP, { carId: 'hover-tank', bigJumpKmh: 183 });
    assert.equal(preview.car, CAR_CLASSES.hypercar);
    const look = describeCar('hover-tank');
    assert.equal(look.known, false);
    assert.equal(look.name, 'HOVER TANK');
    assert.equal(look.carClass, CAR_CLASSES.hypercar);
  });
});

describe('garage display data', () => {
  it('names every car class and labels its drivetrain', () => {
    for (const id of CAR_CLASS_IDS) {
      const look = describeCar(id);
      assert.equal(look.name, CAR_CLASSES[id].name);
      assert.match(look.accent, /^#[0-9a-f]{6}$/i);
    }
    assert.equal(describeCar('hypercar').drive, 'RWD');
    assert.equal(describeCar('rally').drive, 'AWD 45:55');
    assert.equal(describeCar('buggy').drive, 'AWD 40:60');
  });

  it('names known maps, labels unknown ones and lists the big-jump maps', () => {
    assert.equal(describeMap('cryo').name, 'Cryo Drift');
    assert.equal(describeMap('cryo').surfaceGrip, 0.55);
    assert.equal(describeMap('volcano_run').name, 'VOLCANO RUN');
    assert.equal(describeMap('volcano_run').known, false);
    assert.equal(describeMap(null).known, false);
    assert.equal(labelFromId('a.b-c_d'), 'A B C D');
    assert.deepEqual(BIG_JUMP_MAPS.map((m) => [m.id, m.bigJumpKmh]), [
      ['chaos', 183],
      ['isles', 163],
    ]);
  });
});

describe('per-car presets', () => {
  it('are valid slider positions, and only JUMP ATTEMPT changes between cars', () => {
    for (const id of CAR_CLASS_IDS) {
      const presets = presetsFor(id);
      assert.deepEqual(presets.map((p) => p.id), ['balanced', 'downforce', 'top-speed', 'jump']);
      for (const preset of presets) assert.deepEqual(clampSquadControls(preset.controls), preset.controls, `${id} ${preset.id}`);
      assert.deepEqual(presets.slice(0, 3), PRESETS.slice(0, 3));
    }
    assert.deepEqual(presetsFor('hover-tank'), PRESETS);
    assert.deepEqual(JUMP_PRESETS.hypercar.controls, JUMP);
  });

  it("JUMP ATTEMPT is READY for every car that can make the jump, on both big-jump maps", () => {
    for (const id of CAR_CLASS_IDS) {
      if (id === 'buggy') continue;
      for (const map of BIG_JUMP_MAPS) {
        const preview = previewSetup(JUMP_PRESETS[id].controls, { carId: id, bigJumpKmh: map.bigJumpKmh });
        assert.equal(preview.jump?.verdict, 'READY', `${id} on ${map.id}`);
      }
    }
  });

  it("the buggy can't reach lip speed with any setup, so its JUMP ATTEMPT is its fastest one", () => {
    let best = 0;
    for (let tier = 1; tier <= 5; tier++) {
      for (let wing = 0; wing <= 100; wing += 5) {
        for (let balance = -50; balance <= 50; balance += 10) {
          const preview = previewSetup({ frontWingAero: wing, engineTier: tier, chassisBalance: balance }, { carId: 'buggy', bigJumpKmh: 163 });
          assert.notEqual(preview.jump?.verdict, 'READY');
          best = Math.max(best, preview.topSpeedKmh);
        }
      }
    }
    const preset = previewSetup(JUMP_PRESETS.buggy.controls, { carId: 'buggy', bigJumpKmh: 163 });
    assert.equal(preset.jump?.verdict, 'TOO SLOW');
    assert.ok(Math.abs(preset.topSpeedKmh - best) < 0.5, `${preset.topSpeedKmh} vs best ${best}`);
  });

  it('the hypercar keeps its classic verdicts on the chaos map', () => {
    const verdictOf = (id: string) => previewSetup(PRESETS.find((p) => p.id === id)!.controls, DEFAULT_SESSION).jump?.verdict;
    assert.equal(verdictOf('balanced'), 'TOO SLOW');
    assert.equal(verdictOf('downforce'), 'TOO SLOW');
    assert.equal(verdictOf('top-speed'), 'NOSE LIFT');
    assert.equal(verdictOf('jump'), 'READY');
  });
});
