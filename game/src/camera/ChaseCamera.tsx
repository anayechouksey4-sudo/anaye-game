/**
 * Camera rig. 'chase' (default) trails the car, 'hood' rides on the nose, 'orbit' lets the
 * mouse orbit around the moving car. `C` cycles (see game/hotkeys.ts). Follows the car's
 * interpolated render transform (its physics pose for a couple of steps after a teleport), never
 * React state.
 */
import { useEffect, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { carRuntime } from '../car/runtime';
import { BODY, RIDE_HEIGHT } from '../car/vehicleSpec';
import { onGameEvent } from '../game/events';
import { useGameStore, type CameraMode } from '../state/store';

const BASE_FOV = 62;
/** Onboard "T-cam" just above the roof, behind the cockpit (chassis frame). */
const ONBOARD_CAM_Y = BODY.height - RIDE_HEIGHT + 0.16;
const ONBOARD_CAM_Z = -0.35;
const _carPos = new Vector3();
const _carQuat = new Quaternion();
const _fwd = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();
/** Physics steps after a teleport before the interpolated render pose is trusted again. */
const TELEPORT_SETTLE_STEPS = 2;

/**
 * Step count until which the rig keeps snapping after the latest teleport. A respawn usually
 * teleports the car inside a physics step (RunController's kill plane), so @react-three/rapier
 * still interpolates the render pose from the pre-teleport pose (down in the void) until the
 * physics has stepped past it; snapping to that would frame a point half-way up from the void.
 */
function useTeleportSettle() {
  const settleUntil = useRef(-1);
  useEffect(() => onGameEvent('teleported', () => (settleUntil.current = carRuntime.stepCount + TELEPORT_SETTLE_STEPS)), []);
  return settleUntil;
}

/**
 * Car pose into _carPos/_carQuat: the interpolated render transform, or while `settling` after a
 * teleport the physics pose the teleport wrote (the car mesh is hidden meanwhile, as it is still
 * drawn part-way between the old and the new pose).
 */
function readCarPose(settling: boolean): boolean {
  const obj = carRuntime.chassisObject;
  if (!obj) return false;
  obj.visible = !settling;
  if (settling) {
    _carPos.copy(carRuntime.position);
    _carQuat.copy(carRuntime.quaternion);
  } else {
    obj.getWorldPosition(_carPos);
    obj.getWorldQuaternion(_carQuat);
  }
  return true;
}

function FollowRig({ mode }: { mode: Exclude<CameraMode, 'orbit'> }) {
  const camera = useThree((s) => s.camera);
  const heading = useRef(new Vector3(0, 0, 1));
  const offset = useRef(new Vector3(0, 2.4, -7));
  const smoothY = useRef(0);
  const snap = useRef(true);
  const settleUntil = useTeleportSettle();

  useEffect(() => onGameEvent('teleported', () => (snap.current = true)), []);
  useEffect(() => {
    snap.current = true;
  }, [mode]);

  useFrame((_, delta) => {
    const settling = carRuntime.stepCount < settleUntil.current;
    if (!readCarPose(settling)) return;
    if (settling) snap.current = true;
    const dt = Math.min(delta, 0.1);
    _fwd.set(0, 0, 1).applyQuaternion(_carQuat);

    if (mode === 'hood') {
      _desired.set(0, ONBOARD_CAM_Y, ONBOARD_CAM_Z).applyQuaternion(_carQuat).add(_carPos);
      _look.set(0, ONBOARD_CAM_Y - 0.9, 30).applyQuaternion(_carQuat).add(_carPos);
      camera.position.copy(_desired);
      camera.lookAt(_look);
    } else {
      // Smooth the offset relative to the car (heading, distance, height), never the absolute
      // position — otherwise the camera trails by a distance proportional to speed.
      const flat = _desired.set(_fwd.x, 0, _fwd.z);
      if (flat.lengthSq() > 0.04) {
        flat.normalize();
        if (snap.current) heading.current.copy(flat);
        else heading.current.lerp(flat, 1 - Math.exp(-dt * 4)).normalize();
      }
      const speed = Math.min(carRuntime.speedKmh, 300);
      const dist = 6.8 + speed * 0.01;
      const height = 2.2 + speed * 0.002;
      _desired.copy(heading.current).multiplyScalar(-dist);
      _desired.y = height;
      if (snap.current) {
        offset.current.copy(_desired);
        smoothY.current = _carPos.y;
      } else {
        offset.current.lerp(_desired, 1 - Math.exp(-dt * 6));
        // Vertical follow is damped separately so bumps and landings don't shake the view.
        smoothY.current += (_carPos.y - smoothY.current) * (1 - Math.exp(-dt * 8));
      }
      camera.position.set(_carPos.x + offset.current.x, smoothY.current + offset.current.y, _carPos.z + offset.current.z);
      _look.set(_carPos.x + heading.current.x * 4, smoothY.current + 0.7, _carPos.z + heading.current.z * 4);
      camera.lookAt(_look);
    }
    snap.current = false;

    if (camera instanceof PerspectiveCamera) {
      const fov = BASE_FOV + Math.min(carRuntime.speedKmh / 300, 1) * (mode === 'hood' ? 10 : 16);
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-dt * 3));
        camera.updateProjectionMatrix();
      }
    }
  });
  return null;
}

function OrbitRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera);
  const last = useRef(new Vector3());
  // Re-frame the car on entry and after every teleport (respawn / restart): carrying the old
  // offset across a teleport could leave the camera far from the car or inside scenery.
  const snap = useRef(true);
  const settleUntil = useTeleportSettle();
  useEffect(() => onGameEvent('teleported', () => (snap.current = true)), []);

  useFrame(() => {
    const c = controls.current;
    const settling = carRuntime.stepCount < settleUntil.current;
    if (!c || !readCarPose(settling)) return;
    if (settling) snap.current = true;
    if (snap.current) {
      _fwd.set(0, 0, 1).applyQuaternion(_carQuat);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, 1);
      _fwd.normalize();
      camera.position.copy(_carPos).addScaledVector(_fwd, -9);
      camera.position.y += 4;
      snap.current = false;
    } else {
      // Ride along with the car so the user's orbit angle and distance are kept.
      camera.position.add(_look.copy(_carPos).sub(last.current));
    }
    last.current.copy(_carPos);
    c.target.copy(_carPos);
    c.update();
  });

  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={3} maxDistance={60} />;
}

export function ChaseCamera() {
  const mode = useGameStore((s) => s.ui.cameraMode);
  return mode === 'orbit' ? <OrbitRig /> : <FollowRig mode={mode} />;
}
