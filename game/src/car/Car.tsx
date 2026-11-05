import { useEffect, useRef } from 'react';
import type { Group } from 'three';
import {
  CuboidCollider,
  RigidBody,
  useAfterPhysicsStep,
  useBeforePhysicsStep,
  useRapier,
  type RapierCollider,
  type RapierRigidBody,
} from '@react-three/rapier';
import { PHYSICS_DT } from '../config';
import { emitGameEvent, onGameEvent } from '../game/events';
import { gameState } from '../state/store';
import type { Vec3 } from '../track/types';
import { carDebug } from './carDebug';
import { CarController, yawToQuaternion } from './carController';
import { CarModel } from './model/CarModel';
import { carRuntime } from './runtime';
import { TireSmoke } from './smoke/TireSmoke';
import { CHASSIS_COLLIDER, RIDE_HEIGHT, WHEELS } from './vehicleSpec';

interface CarProps {
  spawn: { position: Vec3; yaw: number };
}

/**
 * The player car: a dynamic chassis + Rapier raycast vehicle. Mounted once per track (keyed by
 * track id) and never re-rendered — all live changes flow through the store/runtime.
 */
export function Car({ spawn }: CarProps) {
  const { world, rapier } = useRapier();
  const bodyRef = useRef<RapierRigidBody>(null);
  const colliderRef = useRef<RapierCollider>(null);
  const chassisRef = useRef<Group>(null);
  const controllerRef = useRef<CarController | null>(null);
  // Initial transform only; later moves are imperative (teleport) so props never fight the sim.
  const initial = useRef({
    position: [spawn.position[0], spawn.position[1] + RIDE_HEIGHT + 0.12, spawn.position[2]] as Vec3,
    quaternion: yawToQuaternion(spawn.yaw),
  });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const controller = new CarController(world, rapier, body);
    controller.applyParams(gameState().physics);
    controllerRef.current = controller;
    carRuntime.bodyHandle = body.handle;
    carRuntime.chassisColliderHandle = colliderRef.current?.handle ?? null;
    carRuntime.chassisObject = chassisRef.current;
    carDebug.info = () => ({
      mass: body.mass(),
      localCom: body.localCom(),
      suspensionStiffness: WHEELS.map((w) => controller.vehicle.wheelSuspensionStiffness(w.index) ?? 0),
      suspensionCompression: WHEELS.map((w) => controller.vehicle.wheelSuspensionCompression(w.index) ?? 0),
      suspensionRelaxation: WHEELS.map((w) => controller.vehicle.wheelSuspensionRelaxation(w.index) ?? 0),
    });

    const placeAt = (position: Vec3, yaw: number) => {
      controller.teleport(position, yaw);
      emitGameEvent('teleported', { position, yaw });
    };
    carDebug.place = placeAt;
    const offRespawn = onGameEvent('respawn', ({ checkpoint }) => {
      const layout = gameState().trackLayout;
      const cp = layout?.checkpoints[checkpoint] ?? layout?.checkpoints[0];
      if (cp) placeAt(cp.position, cp.yaw);
      else if (layout) placeAt(layout.spawn.position, layout.spawn.yaw);
    });
    const offRestart = onGameEvent('restart', () => {
      const layout = gameState().trackLayout;
      if (layout) placeAt(layout.spawn.position, layout.spawn.yaw);
    });

    return () => {
      offRespawn();
      offRestart();
      controllerRef.current = null;
      carDebug.info = null;
      carDebug.place = null;
      controller.dispose();
      carRuntime.ready = false;
      carRuntime.bodyHandle = null;
      carRuntime.chassisColliderHandle = null;
      carRuntime.chassisObject = null;
    };
  }, [world, rapier]);

  useBeforePhysicsStep(() => {
    controllerRef.current?.beforeStep(PHYSICS_DT, gameState().physics);
  });

  useAfterPhysicsStep(() => {
    controllerRef.current?.afterStep(PHYSICS_DT);
  });

  const { position, quaternion } = initial.current;
  return (
    <>
      <RigidBody
        ref={bodyRef}
        type="dynamic"
        colliders={false}
        canSleep={false}
        ccd
        position={position}
        quaternion={[quaternion.x, quaternion.y, quaternion.z, quaternion.w]}
        linearDamping={0}
        angularDamping={0.05}
        name="player-car"
      >
        <CuboidCollider
          ref={colliderRef}
          args={CHASSIS_COLLIDER.halfExtents}
          position={CHASSIS_COLLIDER.offset}
          density={0}
          friction={CHASSIS_COLLIDER.friction}
          restitution={CHASSIS_COLLIDER.restitution}
        />
        <group ref={chassisRef}>
          <CarModel />
        </group>
      </RigidBody>
      {/* World-space: smoke must stay where it was emitted, not ride along with the chassis. */}
      <TireSmoke />
    </>
  );
}
