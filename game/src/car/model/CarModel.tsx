/**
 * PLACEHOLDER car visual — a few boxes plus blocky wheels. The car-visuals agent replaces the
 * body with the voxel hypercar; keep the wheel-driving pattern (`useWheelPose`) and the
 * chassis-frame convention from vehicleSpec.ts (+Z forward, +Y up, origin RIDE_HEIGHT above ground).
 */
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { carRuntime } from '../runtime';
import { BODY, RIDE_HEIGHT, WHEELS, type WheelSpec } from '../vehicleSpec';

const GROUND_Y = -RIDE_HEIGHT;

/**
 * Drives a wheel group from the runtime every frame: suspension travel, steering and spin.
 * Returns refs for an outer group (placed at the suspension mount, steers) and an inner
 * group (wheel centre, spins about X).
 */
export function useWheelPose(wheel: WheelSpec) {
  const mountRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  useFrame(() => {
    const w = carRuntime.wheels[wheel.index];
    const mount = mountRef.current;
    const spin = spinRef.current;
    if (!w || !mount || !spin) return;
    mount.position.set(wheel.connection[0], wheel.connection[1] - w.suspensionLength, wheel.connection[2]);
    mount.rotation.y = w.steering;
    spin.rotation.x = w.rotation;
  });
  return { mountRef, spinRef };
}

function PlaceholderWheel({ wheel }: { wheel: WheelSpec }) {
  const { mountRef, spinRef } = useWheelPose(wheel);
  return (
    <group ref={mountRef}>
      <group ref={spinRef}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[wheel.radius, wheel.radius, wheel.width, 8]} />
          <meshStandardMaterial color="#14161f" roughness={0.9} />
        </mesh>
        {/* Off-centre hub block so rotation is visible. */}
        <mesh position={[wheel.side === 'left' ? wheel.width / 2 : -wheel.width / 2, wheel.radius * 0.45, 0]}>
          <boxGeometry args={[0.04, wheel.radius * 0.5, wheel.radius * 0.5]} />
          <meshStandardMaterial color="#F5E663" emissive="#F5E663" emissiveIntensity={0.6} />
        </mesh>
      </group>
    </group>
  );
}

export function CarModel() {
  const bodyBottom = GROUND_Y + BODY.groundClearance;
  return (
    <group name="car-model">
      {/* Main tub */}
      <mesh position={[0, bodyBottom + 0.22, 0]} castShadow receiveShadow>
        <boxGeometry args={[BODY.width - 0.1, 0.44, BODY.length - 0.3]} />
        <meshStandardMaterial color="#1d3a5c" metalness={0.35} roughness={0.4} />
      </mesh>
      {/* Wedge nose */}
      <mesh position={[0, bodyBottom + 0.12, BODY.length / 2 - 0.25]} castShadow>
        <boxGeometry args={[BODY.width - 0.3, 0.2, 0.5]} />
        <meshStandardMaterial color="#00F0FF" emissive="#00F0FF" emissiveIntensity={0.35} />
      </mesh>
      {/* Front wing */}
      <mesh position={[0, bodyBottom + 0.02, BODY.length / 2 - 0.05]} castShadow>
        <boxGeometry args={[BODY.width, 0.05, 0.35]} />
        <meshStandardMaterial color="#FF2A6D" emissive="#FF2A6D" emissiveIntensity={0.4} />
      </mesh>
      {/* Canopy */}
      <mesh position={[0, bodyBottom + 0.62, 0.15]} castShadow>
        <boxGeometry args={[1.2, 0.38, 1.7]} />
        <meshStandardMaterial color="#071018" metalness={0.8} roughness={0.15} />
      </mesh>
      {/* Rear wing on struts */}
      <mesh position={[0, GROUND_Y + BODY.height - 0.05, -BODY.length / 2 + 0.35]} castShadow>
        <boxGeometry args={[BODY.width - 0.15, 0.06, 0.45]} />
        <meshStandardMaterial color="#FF2A6D" emissive="#FF2A6D" emissiveIntensity={0.4} />
      </mesh>
      {[-0.5, 0.5].map((x) => (
        <mesh key={x} position={[x, GROUND_Y + BODY.height - 0.3, -BODY.length / 2 + 0.4]}>
          <boxGeometry args={[0.06, 0.45, 0.12]} />
          <meshStandardMaterial color="#1a1d29" />
        </mesh>
      ))}
      {/* Tail light bar */}
      <mesh position={[0, bodyBottom + 0.3, -BODY.length / 2 + 0.14]}>
        <boxGeometry args={[BODY.width - 0.3, 0.06, 0.04]} />
        <meshStandardMaterial color="#FF2A6D" emissive="#FF2A6D" emissiveIntensity={2} />
      </mesh>
      {WHEELS.map((wheel) => (
        <PlaceholderWheel key={wheel.id} wheel={wheel} />
      ))}
    </group>
  );
}
