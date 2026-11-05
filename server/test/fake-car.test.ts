import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BIG_JUMP_LIP_KMH,
  DEFAULT_CAR_PHYSICS,
  assessBigJump,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  mapSquadControlsToPhysics,
  sanitizeTelemetry,
  type CarPhysicsParams,
  type GameTelemetry,
} from '../../shared/protocol';
import { createFakeCar } from '../src/tools/fake-car';

/** Hazard dice never fire, so only the physics decides the outcome. */
const lucky = (): number => 0.999;

function run(physics: CarPhysicsParams, seconds: number): GameTelemetry[] {
  const car = createFakeCar(lucky);
  const frames: GameTelemetry[] = [];
  for (let t = 0; t < seconds; t += 0.1) frames.push(car.step(0.1, physics));
  return frames;
}

const readySetup = mapSquadControlsToPhysics({ frontWingAero: 25, engineTier: 5, chassisBalance: 0 });
const noseLiftSetup = mapSquadControlsToPhysics({ frontWingAero: 0, engineTier: 5, chassisBalance: 0 });

describe('fake car (sim-game)', () => {
  it('emits frames that survive the protocol sanitizer unchanged', () => {
    for (const frame of run(readySetup, 60)) assert.deepEqual(sanitizeTelemetry(frame), frame);
  });

  it('never exceeds estimateTopSpeedKmh', () => {
    for (const physics of [DEFAULT_CAR_PHYSICS, readySetup, noseLiftSetup]) {
      const top = estimateTopSpeedKmh(physics);
      const peak = Math.max(...run(physics, 90).map((f) => f.speedKmh));
      assert.ok(peak <= top + 0.1, `peak ${peak} > top ${top}`);
      assert.ok(peak > top * 0.9, `peak ${peak} should approach top ${top}`);
    }
  });

  it('spikes rear slip on launch with high torque, not with low torque', () => {
    const launchSlip = (tier: number): number => {
      const physics = mapSquadControlsToPhysics({ frontWingAero: 50, engineTier: tier, chassisBalance: 0 });
      return Math.max(...run(physics, 4).map((f) => f.rearSlip));
    };
    assert.ok(launchSlip(5) > 0.5, `tier 5 slip ${launchSlip(5)}`);
    assert.equal(launchSlip(1), 0);
  });

  it('lifts the nose above estimateFrontLiftOffKmh, never with enough wing', () => {
    const liftOff = estimateFrontLiftOffKmh(noseLiftSetup);
    assert.ok(liftOff !== null);
    const lifted = run(noseLiftSetup, 60).filter((f) => f.noseLift);
    assert.ok(lifted.length > 0, 'expected nose lift');
    for (const f of lifted) {
      assert.ok(f.speedKmh > liftOff);
      assert.equal(f.wheelsGrounded, 2);
      assert.ok(f.frontAeroN < 0, 'net front aero must be lift');
    }
    assert.equal(run(DEFAULT_CAR_PHYSICS, 60).filter((f) => f.noseLift).length, 0);
  });

  it('a READY setup clears the jump and finishes with no falls', () => {
    assert.equal(assessBigJump(readySetup).verdict, 'READY');
    const frames = run(readySetup, 90);
    const finish = frames.find((f) => f.finished);
    assert.ok(finish, 'expected a finish');
    assert.equal(finish.falls, 0);
    assert.equal(finish.checkpoint, finish.totalCheckpoints);
    assert.ok((finish.speedTrapKmh ?? 0) >= BIG_JUMP_LIP_KMH);
    assert.equal(finish.bestMs, finish.elapsedMs);
  });

  it('a TOO SLOW setup falls at the jump, then still finishes thanks to the marshal assist', () => {
    assert.equal(assessBigJump(DEFAULT_CAR_PHYSICS).verdict, 'TOO SLOW');
    const frames = run(DEFAULT_CAR_PHYSICS, 240);
    const finish = frames.find((f) => f.finished);
    assert.ok(finish, 'expected a finish');
    assert.equal(finish.falls, 3);
    assert.ok((finish.speedTrapKmh ?? Infinity) < BIG_JUMP_LIP_KMH);
    assert.ok(frames.some((f) => f.wheelsGrounded === 0), 'falling frames have no wheels down');
  });

  it('starts a fresh run after the finish, keeping bestMs', () => {
    const frames = run(readySetup, 120);
    const firstFinish = frames.findIndex((f) => f.finished);
    const restart = frames.findIndex((f, i) => i > firstFinish && !f.finished);
    assert.ok(firstFinish >= 0 && restart > firstFinish);
    const after = frames[restart];
    assert.ok(after);
    assert.equal(after.checkpoint, 0);
    assert.equal(after.elapsedMs, 0);
    assert.equal(after.bestMs, frames[firstFinish]?.bestMs);
  });
});
