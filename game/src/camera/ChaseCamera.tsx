/**
 * Camera rig. 'chase' (default) trails the car, 'hood' rides on the nose, 'orbit' lets the
 * mouse orbit around the moving car. `C` cycles (see game/hotkeys.ts). Follows the car's
 * interpolated render transform, never React state.
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

function readCarPose(): boolean {
  const obj = carRuntime.chassisObject;
  if (!obj) return false;
  obj.getWorldPosition(_carPos);
  obj.getWorldQuaternion(_carQuat);
  return true;
}

function FollowRig({ mode }: { mode: Exclude<CameraMode, 'orbit'> }) {
  const camera = useThree((s) => s.camera);
  const heading = useRef(new Vector3(0, 0, 1));
  const offset = useRef(new Vector3(0, 2.4, -7));
  const smoothY = useRef(0);
  const snap = useRef(true);

  useEffect(() => onGameEvent('teleported', () => (snap.current = true)), []);
  useEffect(() => {
    snap.current = true;
  }, [mode]);

  useFrame((_, delta) => {
    if (!readCarPose()) return;
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
  useEffect(() => onGameEvent('teleported', () => (snap.current = true)), []);

  useFrame(() => {
    const c = controls.current;
    if (!c || !readCarPose()) return;
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
