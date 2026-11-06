/**
 * Run rules, evaluated after every physics step (so they also work under the debug
 * fast-forward): start lights, timer, checkpoints, finish, kill plane, speed trap, flip recovery.
 */
import { useEffect, useRef } from 'react';
import { useAfterPhysicsStep } from '@react-three/rapier';
import { PHYSICS_DT } from '../config';
import { getInputOverride } from '../car/input';
import { carRuntime } from '../car/runtime';
import { gameState } from '../state/store';
import { isInsideGate } from '../track/types';
import { cancelCountdown, isCountdownActive, tickCountdown } from './countdown';
import { onGameEvent } from './events';
import { runClock } from './runClock';

/** Store mirror of the timer is refreshed every N steps (≈10 Hz). */
const ELAPSED_SYNC_STEPS = 6;
const FLIP_UP_Y = 0.25;
const FLIP_MAX_SPEED = 3;
const FLIP_RESPAWN_S = 2.5;

export function RunController() {
  const stepCounter = useRef(0);
  const prevJumpAlong = useRef<number | null>(null);
  const flippedTime = useRef(0);
  const settleSteps = useRef(0);

  useEffect(() => {
    const reset = () => {
      prevJumpAlong.current = null;
      flippedTime.current = 0;
      // Ignore rules for a few steps while the teleported body settles.
      settleSteps.current = 3;
    };
    const offs = [onGameEvent('respawn', reset), onGameEvent('restart', reset)];
    return () => offs.forEach((off) => off());
  }, []);

  useAfterPhysicsStep(() => {
    const s = gameState();
    const layout = s.trackLayout;
    if (!layout || !carRuntime.ready) return;

    const roam = layout.mode === 'roam';
    if (runClock.running) {
      runClock.elapsedMs += PHYSICS_DT * 1000;
      if (++stepCounter.current % ELAPSED_SYNC_STEPS === 0) s.syncElapsed();
    }
    if (!roam) {
      // Start lights (game/countdown.ts). The timer starts on the GO step and counts from the next one.
      if (isCountdownActive()) {
        const scripted = getInputOverride();
        if (scripted && (scripted.throttle ?? 0) > 0.05) cancelCountdown();
        else if (tickCountdown()) s.startRun();
      }
      // Without lights (a scripted driver skipped them): the run starts on the first throttle.
      if (!isCountdownActive() && !s.run.started && !s.run.finished && carRuntime.throttle > 0.05) s.startRun();
    }

    if (settleSteps.current > 0) {
      settleSteps.current--;
      return;
    }
    const pos = carRuntime.position;

    if (pos.y < layout.killY) {
      s.respawn('fall');
      return;
    }

    if (!roam && !s.run.finished) {
      if (layout.strictOrder) {
        // Only the next checkpoint counts; the finish only once every checkpoint is reached.
        const next = layout.checkpoints[s.run.checkpoint + 1];
        if (next) {
          if (isInsideGate(pos, next)) s.reachCheckpoint(s.run.checkpoint + 1);
        } else if (isInsideGate(pos, layout.finish)) s.finishRun();
      } else {
        // Any later checkpoint counts (a jump can sail over a gate on a linear track).
        for (let i = layout.checkpoints.length - 1; i > s.run.checkpoint; i--) {
          const cp = layout.checkpoints[i];
          if (cp && isInsideGate(pos, cp)) {
            s.reachCheckpoint(i);
            break;
          }
        }
        if (isInsideGate(pos, layout.finish)) s.finishRun();
      }
    }

    const jump = layout.bigJump;
    if (jump) {
      const dx = pos.x - jump.lipPosition[0];
      const dz = pos.z - jump.lipPosition[2];
      const along = dx * Math.sin(jump.yaw) + dz * Math.cos(jump.yaw);
      const across = dx * Math.cos(jump.yaw) - dz * Math.sin(jump.yaw);
      const prev = prevJumpAlong.current;
      if (
        prev !== null &&
        prev < 0 &&
        along >= 0 &&
        Math.abs(across) <= (jump.halfWidth ?? 15) &&
        pos.y > jump.lipPosition[1] - 3
      ) {
        s.recordSpeedTrap(carRuntime.speedKmh);
      }
      prevJumpAlong.current = along;
    }

    const flipped = carRuntime.up.y < FLIP_UP_Y && carRuntime.velocity.length() < FLIP_MAX_SPEED;
    flippedTime.current = flipped ? flippedTime.current + PHYSICS_DT : 0;
    if (flippedTime.current > FLIP_RESPAWN_S) s.respawn('flipped');
  });

  return null;
}
