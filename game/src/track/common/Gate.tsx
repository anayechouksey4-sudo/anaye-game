import type { Vec3 } from '../types';

interface GateProps {
  position: Vec3;
  yaw: number;
  /** [width, height, depth] — same as the trigger volume. */
  size: Vec3;
  color: string;
  label?: 'finish' | 'checkpoint';
}

/** Visual arch for a checkpoint / finish trigger (no collider: you drive through it). */
export function Gate({ position, yaw, size, color, label = 'checkpoint' }: GateProps) {
  const [width, height] = size;
  const pillar = 0.6;
  const checker = label === 'finish';
  return (
    <group position={position} rotation={[0, yaw, 0]}>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (width + pillar)) / 2, height / 2, 0]} castShadow>
          <boxGeometry args={[pillar, height, pillar]} />
          <meshStandardMaterial color="#10131d" emissive={color} emissiveIntensity={0.25} />
        </mesh>
      ))}
      <mesh position={[0, height, 0]}>
        <boxGeometry args={[width + pillar * 2, 0.7, pillar]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {checker &&
        Array.from({ length: 12 }, (_, i) => (
          <mesh key={i} position={[-width / 2 + (i + 0.5) * (width / 12), 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[width / 12, 1.5]} />
            <meshBasicMaterial color={i % 2 === 0 ? '#f0f0f0' : '#05060A'} />
          </mesh>
        ))}
    </group>
  );
}
