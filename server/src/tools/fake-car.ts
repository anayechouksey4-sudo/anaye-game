/**
 * A cheap 1-D stand-in for the real racer, used by sim-game so the dashboard can be
 * exercised without a browser. It integrates the same longitudinal model the protocol
 * documents (rear-axle drive force, drag·v², rolling resistance, v² aero), so its
 * numbers agree with the dashboard's previews:
 *   - speed never exceeds estimateTopSpeedKmh,
 *   - the nose lifts above estimateFrontLiftOffKmh,
 *   - the big jump needs BIG_JUMP_LIP_KMH at the lip with the nose down.
 * Hazards (collapsing tiles, pendulums) are dice rolls, not geometry.
 */
import {
  BIG_JUMP_LIP_KMH,
  GRAVITY,
  REAR_DOWNFORCE,
  ROLLING_RESISTANCE,
  balanceToFrontWeightFraction,
  clamp,
  driveForceN,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  frontAeroForceN,
  type CarPhysicsParams,
  type GameTelemetry,
} from '../../../shared/protocol';

export const FAKE_TRACK = {
  lengthM: 1600,
  /** Start line, after the tiles, after the pendulums, after the jump, finish. */
  checkpointsM: [0, 300, 500, 1400, 1600],
  tiles: { fromM: 150, toM: 300 },
  brakeZone: { fromM: 290, toM: 350, targetKmh: 140 },
  pendulums: { fromM: 350, toM: 500 },
  jump: { lipM: 1300, gapM: 95 },
} as const;

const SUBSTEP_S = 0.01;
const GRID_S = 1.5;
const FALL_S = 1.2;
const FINISH_HOLD_S = 3;
const PENDULUM_HIT_CHANCE = 0.08;
const TILE_FALL_CHANCE = 0.04;
/** After this many consecutive failed jumps the car is respawned past the gap, so runs always finish. */
const MARSHAL_ASSIST_AFTER = 3;

export type FakeCarPhase = 'grid' | 'driving' | 'airborne' | 'falling' | 'finished';

export interface FakeCar {
  /** Advance by `dtSec` with the physics currently applied and return a telemetry frame. */
  step(dtSec: number, physics: CarPhysicsParams): GameTelemetry;
  readonly phase: FakeCarPhase;
}

/** Low gears multiply wheel torque at low speed, which is what breaks traction on launch. */
function launchMultiplier(speedMs: number): number {
  return 1 + 1.5 * Math.max(0, 1 - speedMs / 25);
}

function approach(value: number, target: number, maxDelta: number): number {
  return value < target ? Math.min(target, value + maxDelta) : Math.max(target, value - maxDelta);
}

function crossed(prev: number, next: number, mark: number): boolean {
  return prev < mark && next >= mark;
}

export function createFakeCar(random: () => number = Math.random): FakeCar {
  const totalCheckpoints = FAKE_TRACK.checkpointsM.length - 1;
  let phase: FakeCarPhase = 'grid';
  let phaseTime = 0;
  let distance = 0;
  let speed = 0;
  let throttle = 0;
  let brake = 0;
  let rearSlip = 0;
  let elapsedMs = 0;
  let falls = 0;
  let checkpoint = 0;
  let bestMs: number | null = null;
  let speedTrapKmh: number | null = null;
  let jumpFailStreak = 0;
  let airborneLeft = 0;
  let respawnAtM = 0;

  const startRun = (): void => {
    phase = 'grid';
    phaseTime = 0;
    distance = 0;
    speed = 0;
    throttle = 0;
    brake = 0;
    rearSlip = 0;
    elapsedMs = 0;
    falls = 0;
    checkpoint = 0;
    jumpFailStreak = 0;
  };

  const fall = (respawnM: number): void => {
    phase = 'falling';
    phaseTime = 0;
    falls += 1;
    respawnAtM = respawnM;
  };

  const lastCheckpointM = (): number => FAKE_TRACK.checkpointsM[checkpoint] ?? 0;

  const drive = (h: number, p: CarPhysicsParams): void => {
    const kmh = speed * 3.6;
    const { brakeZone } = FAKE_TRACK;
    const inBrakeZone = distance >= brakeZone.fromM && distance < brakeZone.toM;
    const braking = inBrakeZone && kmh > brakeZone.targetKmh;
    throttle = approach(throttle, braking ? 0 : inBrakeZone ? 0.5 : 1, 6 * h);
    brake = approach(brake, braking ? 1 : 0, 8 * h);

    const weight = p.mass * GRAVITY;
    const rearAero = REAR_DOWNFORCE * speed * speed;
    const grip = p.traction * (weight * (1 - balanceToFrontWeightFraction(p.balance)) + rearAero);
    const demand = driveForceN(p) * throttle * launchMultiplier(speed);
    const slipTarget = demand > 0 ? clamp((demand / grip - 1) * 0.5, 0, 1) : 0;
    // Smoke flashes up instantly and fades over ~half a second.
    rearSlip = slipTarget > rearSlip ? slipTarget : approach(rearSlip, slipTarget, 2 * h);

    const totalLoad = weight + Math.max(0, frontAeroForceN(p, speed)) + rearAero;
    const brakeForce = speed > 0 ? brake * p.traction * totalLoad * 0.9 : 0;
    const resist = speed > 0 ? p.drag * speed * speed + ROLLING_RESISTANCE * weight : 0;
    const accel = (Math.min(demand, grip) - brakeForce - resist) / p.mass;
    speed = Math.min(Math.max(0, speed + accel * h), estimateTopSpeedKmh(p) / 3.6);

    const prev = distance;
    distance += speed * h;

    for (let i = checkpoint + 1; i <= totalCheckpoints; i++) {
      if (distance >= (FAKE_TRACK.checkpointsM[i] ?? Infinity)) checkpoint = i;
    }

    if (crossed(prev, distance, FAKE_TRACK.tiles.fromM)) {
      // Tiles drop 1 s after contact; a crawling car is still on them when they go.
      const risk = TILE_FALL_CHANCE + (speed < 8 ? 0.9 : 0);
      if (random() < risk) return fall(lastCheckpointM());
    }
    if (crossed(prev, distance, FAKE_TRACK.pendulums.fromM) && random() < PENDULUM_HIT_CHANCE) {
      return fall(lastCheckpointM());
    }
    if (crossed(prev, distance, FAKE_TRACK.jump.lipM)) {
      const lipKmh = speed * 3.6;
      speedTrapKmh = Math.round(lipKmh * 10) / 10;
      const liftOff = estimateFrontLiftOffKmh(p);
      const noseUp = liftOff !== null && lipKmh > liftOff;
      if (lipKmh >= BIG_JUMP_LIP_KMH && !noseUp) {
        jumpFailStreak = 0;
        phase = 'airborne';
        airborneLeft = FAKE_TRACK.jump.gapM / Math.max(speed, 1);
        return;
      }
      jumpFailStreak += 1;
      const assisted = jumpFailStreak >= MARSHAL_ASSIST_AFTER;
      if (assisted) jumpFailStreak = 0;
      return fall(assisted ? FAKE_TRACK.jump.lipM + FAKE_TRACK.jump.gapM : lastCheckpointM());
    }
    if (distance >= FAKE_TRACK.lengthM) {
      checkpoint = totalCheckpoints;
      phase = 'finished';
      phaseTime = 0;
      bestMs = bestMs === null ? elapsedMs : Math.min(bestMs, elapsedMs);
    }
  };

  const substep = (h: number, p: CarPhysicsParams): void => {
    switch (phase) {
      case 'grid':
        phaseTime += h;
        if (phaseTime >= GRID_S) {
          phase = 'driving';
          phaseTime = 0;
        }
        return;
      case 'driving':
        elapsedMs += h * 1000;
        drive(h, p);
        return;
      case 'airborne':
        elapsedMs += h * 1000;
        speed = Math.max(0, speed - ((p.drag * speed * speed) / p.mass) * h);
        distance += speed * h;
        rearSlip = approach(rearSlip, 0, 2 * h);
        airborneLeft -= h;
        if (airborneLeft <= 0) phase = 'driving';
        return;
      case 'falling':
        elapsedMs += h * 1000;
        phaseTime += h;
        throttle = approach(throttle, 0, 6 * h);
        rearSlip = approach(rearSlip, 0, 2 * h);
        if (phaseTime >= FALL_S) {
          phase = 'driving';
          distance = respawnAtM;
          speed = 0;
          throttle = 0;
          brake = 0;
        }
        return;
      case 'finished':
        phaseTime += h;
        throttle = approach(throttle, 0, 6 * h);
        brake = approach(brake, 0.6, 6 * h);
        speed = Math.max(0, speed - 8 * h);
        rearSlip = approach(rearSlip, 0, 2 * h);
        if (phaseTime >= FINISH_HOLD_S) startRun();
        return;
    }
  };

  return {
    get phase() {
      return phase;
    },
    step(dtSec, p) {
      let remaining = Math.max(0, dtSec);
      while (remaining > 1e-9) {
        const h = Math.min(SUBSTEP_S, remaining);
        substep(h, p);
        remaining -= h;
      }
      // Decide nose lift from the reported (rounded) speed so every frame is self-consistent.
      const speedKmh = Math.round(speed * 36) / 10;
      const liftOff = estimateFrontLiftOffKmh(p);
      const grounded = phase === 'grid' || phase === 'driving' || phase === 'finished';
      const noseLift = grounded && liftOff !== null && speedKmh > liftOff;
      return {
        speedKmh,
        wheelsGrounded: !grounded ? 0 : noseLift ? 2 : 4,
        checkpoint,
        totalCheckpoints,
        elapsedMs: Math.round(elapsedMs),
        falls,
        finished: phase === 'finished',
        bestMs: bestMs === null ? null : Math.round(bestMs),
        throttle: Math.round(throttle * 100) / 100,
        brake: Math.round(brake * 100) / 100,
        frontAeroN: Math.round(frontAeroForceN(p, speed)),
        rearAeroN: Math.round(REAR_DOWNFORCE * speed * speed),
        noseLift,
        rearSlip: Math.round(rearSlip * 100) / 100,
        speedTrapKmh,
      };
    },
  };
}
