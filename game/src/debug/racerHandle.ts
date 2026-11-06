/**
 * `window.__RACER__` — a stable scripting/debug surface used by automated tests and handy in
 * the browser console. Documented in game/README.md; keep it backwards compatible.
 */
import { useEffect } from 'react';
import { useRapier } from '@react-three/rapier';
import {
  assessBigJump,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  sanitizePhysicsPatch,
  sanitizeSquadControls,
  type BigJumpAssessment,
  type CarPhysicsParams,
  type SquadControls,
} from '@shared/protocol';
import { PHYSICS_DT } from '../config';
import { carDebug, type CarDebugInfo } from '../car/carDebug';
import { setInputOverride, type DriverInput } from '../car/input';
import { carRuntime } from '../car/runtime';
import { runClock } from '../game/runClock';
import { gameSessionInfo, getActiveLink } from '../net/squadLink';
import { buildTelemetry } from '../net/telemetry';
import { bigJumpKmhOf } from '../track/catalog';
import { useSelection } from '../state/selection';
import { gameState, type LinkStatus } from '../state/store';

type XYZ = { x: number; y: number; z: number };

export interface RacerWheelState {
  inContact: boolean;
  suspensionForce: number;
  slip01: number;
  suspensionLength: number;
  lateralSlip: number;
  longitudinalSlip: number;
  spinRate: number;
  steering: number;
  groundColliderHandle: number | null;
}

export interface RacerState {
  position: XYZ;
  velocity: XYZ;
  up: XYZ;
  speedKmh: number;
  forwardSpeed: number;
  wheelsGrounded: number;
  wheels: RacerWheelState[];
  noseLift: boolean;
  frontAeroN: number;
  rearAeroN: number;
  /** Ground-effect factor on the vertical aero forces (1 on the ground, → 0.1 high over the void). */
  groundEffect: number;
  rearSlip: number;
  frontAxleLoadN: number;
  rearAxleLoadN: number;
  /** Drive force asked of the driven tyres, and their grip budget, N (carRuntime; visuals only). */
  driveForceN: number;
  driveGripN: number;
  throttle: number;
  brake: number;
  steer: number;
  airborneTime: number;
  physics: CarPhysicsParams;
  controls: SquadControls | null;
  link: LinkStatus;
  serverUrl: string;
  dashboards: number;
  checkpoint: number;
  totalCheckpoints: number;
  falls: number;
  finished: boolean;
  elapsedMs: number;
  bestMs: number | null;
  speedTrapKmh: number | null;
  track: string | null;
  /** Car class the physics are mapped for (and the mounted car once it has remounted). */
  carId: string;
  stepCount: number;
  simTime: number;
  car: CarDebugInfo | null;
}

export interface RacerHandle {
  getState(): RacerState;
  respawn(): void;
  restart(): void;
  teleport(checkpointIndex: number): void;
  /** Put the car at an arbitrary ground point facing `yaw` (run progress untouched). */
  placeAt(position: [number, number, number], yaw?: number): void;
  /** Partial driver input override; null hands control back to keyboard/gamepad. */
  setInput(input: Partial<DriverInput> | null): void;
  /** Same path as a `physics:set` frame (clamped). Returns the resulting params. */
  setPhysics(patch: Partial<CarPhysicsParams>): CarPhysicsParams;
  /** Same path as a `squad:controls` frame. Returns the resulting params. */
  setControls(controls: SquadControls): CarPhysicsParams;
  /** Run `seconds` of simulation synchronously in fixed steps (deterministic measurements). */
  advance(seconds: number): RacerState;
  /** Exactly what the next game:telemetry frame would contain. */
  telemetry(): ReturnType<typeof buildTelemetry>;
  linkStats(): { connected: boolean; sent: number; received: number; rejected: number; connects: number } | null;
  /** Pick a car class (same path as the garage: selection store → physics re-map → car remount). Returns the resolved id. */
  setCar(carId: string): string;
  /** The protocol's estimates for the current physics and car (+ the map's jump, if any). */
  estimates(): { carId: string; topSpeedKmh: number; liftOffKmh: number | null; bigJump: BigJumpAssessment | null };
  /** carId / trackId / bigJumpKmh as sent in game:state. */
  session(): ReturnType<typeof gameSessionInfo>;
}

declare global {
  interface Window {
    __RACER__?: RacerHandle;
  }
}

const xyz = (v: XYZ): XYZ => ({ x: v.x, y: v.y, z: v.z });

function snapshot(): RacerState {
  const s = gameState();
  const rt = carRuntime;
  return {
    position: xyz(rt.position),
    velocity: xyz(rt.velocity),
    up: xyz(rt.up),
    speedKmh: rt.speedKmh,
    forwardSpeed: rt.forwardSpeed,
    wheelsGrounded: rt.wheelsGrounded,
    wheels: rt.wheels.map((w) => ({
      inContact: w.inContact,
      suspensionForce: w.suspensionForce,
      slip01: w.slip01,
      suspensionLength: w.suspensionLength,
      lateralSlip: w.lateralSlip,
      longitudinalSlip: w.longitudinalSlip,
      spinRate: w.spinRate,
      steering: w.steering,
      groundColliderHandle: w.groundColliderHandle,
    })),
    noseLift: rt.noseLift,
    frontAeroN: rt.frontAeroN,
    rearAeroN: rt.rearAeroN,
    groundEffect: rt.groundEffect,
    rearSlip: rt.rearSlip,
    frontAxleLoadN: rt.frontAxleLoadN,
    rearAxleLoadN: rt.rearAxleLoadN,
    driveForceN: rt.driveForceN,
    driveGripN: rt.driveGripN,
    throttle: rt.throttle,
    brake: rt.brake,
    steer: rt.steer,
    airborneTime: rt.airborneTime,
    physics: { ...s.physics },
    controls: s.controls ? { ...s.controls } : null,
    link: s.linkStatus,
    serverUrl: s.serverUrl,
    dashboards: s.dashboards,
    checkpoint: s.run.checkpoint,
    totalCheckpoints: s.run.totalCheckpoints,
    falls: s.run.falls,
    finished: s.run.finished,
    elapsedMs: s.run.finished ? s.run.elapsedMs : runClock.elapsedMs,
    bestMs: s.run.bestMs,
    speedTrapKmh: s.run.speedTrapKmh,
    track: s.trackLayout?.id ?? null,
    carId: s.carId,
    stepCount: rt.stepCount,
    simTime: rt.simTime,
    car: carDebug.info ? carDebug.info() : null,
  };
}

/** Installs window.__RACER__ while mounted. Must render inside <Physics> (uses its stepper). */
export function useRacerHandle(): void {
  const { step } = useRapier();
  useEffect(() => {
    const handle: RacerHandle = {
      getState: snapshot,
      respawn: () => gameState().respawn('debug'),
      restart: () => gameState().restart(),
      teleport: (checkpointIndex) => gameState().teleportToCheckpoint(checkpointIndex),
      placeAt: (position, yaw = 0) => carDebug.place?.(position, yaw),
      setInput: (input) => setInputOverride(input),
      setPhysics: (patch) => {
        const clean = sanitizePhysicsPatch(patch);
        if (clean) gameState().patchPhysics(clean, 'debug');
        return { ...gameState().physics };
      },
      setControls: (controls) => {
        const clean = sanitizeSquadControls(controls);
        if (clean) gameState().applySquadControls(clean, 'debug');
        return { ...gameState().physics };
      },
      advance: (seconds) => {
        const steps = Math.max(0, Math.round(seconds / PHYSICS_DT));
        for (let i = 0; i < steps; i++) step(PHYSICS_DT);
        return snapshot();
      },
      telemetry: buildTelemetry,
      linkStats: () => {
        const link = getActiveLink();
        return link ? { connected: link.connected, ...link.stats } : null;
      },
      setCar: (carId) => {
        useSelection.getState().setCar(carId);
        return gameState().carId;
      },
      estimates: () => {
        const { physics, carId, trackLayout } = gameState();
        const lip = bigJumpKmhOf(trackLayout);
        return {
          carId,
          topSpeedKmh: estimateTopSpeedKmh(physics, carId),
          liftOffKmh: estimateFrontLiftOffKmh(physics, carId),
          bigJump: lip ? assessBigJump(physics, carId, lip) : null,
        };
      },
      session: gameSessionInfo,
    };
    window.__RACER__ = handle;
    return () => {
      if (window.__RACER__ === handle) delete window.__RACER__;
    };
  }, [step]);
}

export function RacerDebugHandle() {
  useRacerHandle();
  return null;
}
