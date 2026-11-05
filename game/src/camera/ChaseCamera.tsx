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
import { onGameEvent } from '../game/events';
import { useGameStore, type CameraMode } from '../state/store';

const BASE_FOV = 62;
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
  const lookAt = useRef(new Vector3());
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
      _desired.set(0, 0.32, 0.35).applyQuaternion(_carQuat).add(_carPos);
      _look.set(0, 0.15, 30).applyQuaternion(_carQuat).add(_carPos);
      camera.position.copy(_desired);
      camera.lookAt(_look);
    } else {
      // Level heading from the car's nose; keep the previous one while the car points straight up/down.
      const flat = _desired.set(_fwd.x, 0, _fwd.z);
      if (flat.lengthSq() > 0.04) {
        flat.normalize();
        if (snap.current) heading.current.copy(flat);
        else heading.current.lerp(flat, 1 - Math.exp(-dt * 4)).normalize();
      }
      const speed = carRuntime.speedKmh;
      const dist = 7 + Math.min(speed, 300) * 0.012;
      const height = 2.4 + Math.min(speed, 300) * 0.002;
      _desired.copy(_carPos).addScaledVector(heading.current, -dist);
      _desired.y += height;
      _look.copy(_carPos).addScaledVector(heading.current, 4);
      _look.y += 0.7;
      if (snap.current) {
        camera.position.copy(_desired);
        lookAt.current.copy(_look);
      } else {
        camera.position.lerp(_desired, 1 - Math.exp(-dt * 7));
        lookAt.current.lerp(_look, 1 - Math.exp(-dt * 12));
      }
      camera.lookAt(lookAt.current);
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
  const last = useRef<Vector3 | null>(null);

  useFrame(() => {
    const c = controls.current;
    if (!c || !readCarPose()) return;
    if (last.current) camera.position.add(_look.copy(_carPos).sub(last.current));
    else last.current = new Vector3();
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
