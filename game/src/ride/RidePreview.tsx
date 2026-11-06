/**
 * Live 3D preview of a look: the car on a dark disc, orbit with one finger (drei OrbitControls,
 * distance clamped to 2.5–8 m, slow auto-rotate until touched). Its own small <Canvas>, so it works
 * in the ☰ menu (over the paused game) and on the dev lab pages alike; it unmounts with the tab,
 * so the game's frame cost is untouched while the builder is closed.
 *
 * Rebuilds are debounced (REBUILD_DEBOUNCE_MS trailing) and happen one at a time; the previous
 * geometries are disposed when the next ones mount. `lookBuildLog` has the measured cost.
 */
import { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Color, PerspectiveCamera, Vector3 } from 'three';
import type { CarClassId } from '@shared/protocol';
import { CH, createCarMaterial, setChannel, type CarMaterialHandle } from '../car/model/carMaterial';
import { wheelRestCenterYFor } from '../car/vehicleSpec';
import { avatarKey, type AvatarConfig } from '../drivers/avatar';
import { DriverBust } from '../drivers/DriverBust';
import { seatFor } from './anchors';
import { rideLookKey, type RideConfig } from './config';
import { buildLookAssets, type LookAssets } from './previewAssets';

export const REBUILD_DEBOUNCE_MS = 60;

/** The preview renderer's last frame (draw calls / triangles / programs), for the lab measurements. */
export const previewRenderInfo = { calls: 0, triangles: 0, programs: 0, geometries: 0, frames: 0 };

const _dir = new Vector3();
const TARGET_Y = 0.55;

/**
 * Frames the car when the class changes: the camera keeps its orbit direction and moves to the
 * distance at which the car's length fills ~70 % of the narrower field of view (so a 360-px
 * portrait phone and a wide landscape screen both see the whole car large).
 */
function FrameCar({ length, height }: { length: number; height: number }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const aspect = size.width / Math.max(1, size.height);
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // The length must fit across the width, the height (with headroom for a spoiler) down the height.
    const byWidth = (0.5 * length * 1.25) / Math.tan(hfov / 2);
    const byHeight = (0.5 * height * 1.9) / Math.tan(vfov / 2);
    // Never closer than the car is long: a diagonal view of a long, low car would otherwise clip.
    const distance = Math.min(8, Math.max(2.6, length * 0.95, Math.max(byWidth, byHeight) + 0.4));
    _dir.copy(camera.position).sub(new Vector3(0, TARGET_Y, 0));
    if (_dir.lengthSq() < 1e-6) _dir.set(-0.65, 0.35, 0.8);
    _dir.normalize().multiplyScalar(distance);
    camera.position.set(_dir.x, TARGET_Y + _dir.y, _dir.z);
    camera.lookAt(0, TARGET_Y, 0);
  }, [camera, length, height, size.width, size.height]);
  return null;
}

/** `onReady` fires once, at the start of the frame after the first one that drew the car (the shaders are compiled by then). */
function RenderProbe({ carShown, onReady }: { carShown: boolean; onReady?: () => void }) {
  const gl = useThree((s) => s.gl);
  const carFrames = useRef(0);
  useFrame(() => {
    previewRenderInfo.calls = gl.info.render.calls;
    previewRenderInfo.triangles = gl.info.render.triangles;
    previewRenderInfo.programs = gl.info.programs?.length ?? 0;
    previewRenderInfo.geometries = gl.info.memory.geometries;
    previewRenderInfo.frames++;
    if (carShown && carFrames.current++ === 1) onReady?.();
  });
  return null;
}

let previewMaterial: CarMaterialHandle | null = null;
function material(): CarMaterialHandle {
  previewMaterial ??= createCarMaterial();
  return previewMaterial;
}

const HEADLIGHT = new Color('#BDF6FF');
const MAGENTA = new Color('#FF2A6D');
const CYAN = new Color('#00F0FF');
const EXHAUST = new Color('#F5E663');

export interface RidePreviewProps {
  /** The ride to show, or null for the stock look of `carId`. */
  ride: RideConfig | null;
  /** The class to show when `ride` is null. */
  carId?: CarClassId;
  driver: AvatarConfig | null;
  /** CSS height of the preview box (default from profile.css). */
  height?: number | string;
  autoRotate?: boolean;
  className?: string;
  /** Called once the car has been drawn (shaders compiled): the host can drop a "building preview" veil. */
  onReady?: () => void;
}

function lookKey(carId: CarClassId, ride: RideConfig | null, driver: AvatarConfig | null): string {
  return `${carId}|${ride ? rideLookKey(ride) : 'stock'}|${driver ? avatarKey(driver) : 'none'}`;
}

/** The latest built assets for a look, rebuilt (debounced) when the look changes; disposed on unmount. */
function useLookAssets(carId: CarClassId, ride: RideConfig | null, driver: AvatarConfig | null): LookAssets | null {
  const [assets, setAssets] = useState<LookAssets | null>(null);
  const current = useRef<LookAssets | null>(null);
  const key = lookKey(carId, ride, driver);
  useEffect(() => {
    const delay = current.current ? REBUILD_DEBOUNCE_MS : 0;
    const timer = setTimeout(() => {
      const next = buildLookAssets(carId, { ride, driver });
      current.current?.dispose();
      current.current = next;
      setAssets(next);
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(
    () => () => {
      current.current?.dispose();
      current.current = null;
    },
    [],
  );
  return assets;
}

function PreviewCar({ assets, ride, driver }: { assets: LookAssets; ride: RideConfig | null; driver: AvatarConfig | null }) {
  const handle = material();
  useFrame(() => {
    setChannel(handle, CH.headlight, HEADLIGHT, 2.4);
    setChannel(handle, CH.tail, MAGENTA, 1.4);
    setChannel(handle, CH.exhaust, EXHAUST, 0.8);
    setChannel(handle, CH.aero, CYAN, 1.2);
  });
  const spec = assets.spec;
  const stance = ride?.stance ?? 0;
  const seat = seatFor(spec.id);
  return (
    <group position={[0, spec.rideHeight, 0]}>
      <group position={[0, stance, 0]}>
        <mesh geometry={assets.body} material={handle.material} dispose={null} />
        {assets.wing && (
          <group position={assets.wing.config.pivot}>
            <mesh geometry={assets.wing.main} material={handle.material} dispose={null} />
            {assets.wing.upper && assets.wing.config.upper && (
              <group position={[0, assets.wing.config.upper.hingeY, -assets.wing.config.main.chord + assets.wing.config.upper.hingeOverlap]}>
                <mesh geometry={assets.wing.upper} material={handle.material} dispose={null} />
              </group>
            )}
          </group>
        )}
        {driver && seat.open && <DriverBust avatar={driver} carId={spec.id} rideHeight={spec.rideHeight} material={handle.material} />}
      </group>
      {spec.wheels.map((w, i) => (
        <mesh key={w.id} geometry={assets.wheels[i]} material={handle.material} position={[w.connection[0], wheelRestCenterYFor(spec, w), w.connection[2]]} dispose={null} />
      ))}
    </group>
  );
}

function Scene({ carId, ride, driver, autoRotate, onReady }: { carId: CarClassId; ride: RideConfig | null; driver: AvatarConfig | null; autoRotate: boolean; onReady?: () => void }) {
  const assets = useLookAssets(carId, ride, driver);
  return (
    <>
      <color attach="background" args={['#070912']} />
      <hemisphereLight args={['#dff6ff', '#1a1030', 0.9]} />
      <directionalLight position={[4, 6, 3]} intensity={2.2} color="#fff4e0" />
      <directionalLight position={[-5, 2, -4]} intensity={0.6} color="#00f0ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]}>
        <circleGeometry args={[4.2, 48]} />
        <meshStandardMaterial color="#0d1020" roughness={0.9} metalness={0.1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <ringGeometry args={[3.0, 3.08, 64]} />
        <meshBasicMaterial color={ride?.accent ?? '#00f0ff'} toneMapped={false} />
      </mesh>
      {assets && <PreviewCar assets={assets} ride={ride} driver={driver} />}
      {assets && <FrameCar length={assets.spec.body.length} height={assets.spec.body.height} />}
      <RenderProbe carShown={assets !== null} onReady={onReady} />
      <OrbitControls
        makeDefault
        target={[0, TARGET_Y, 0]}
        enablePan={false}
        enableDamping
        dampingFactor={0.12}
        minDistance={2.5}
        maxDistance={8}
        maxPolarAngle={1.5}
        autoRotate={autoRotate}
        autoRotateSpeed={0.9}
      />
    </>
  );
}

export function RidePreview({ ride, carId, driver, height, autoRotate = true, className, onReady }: RidePreviewProps) {
  const id: CarClassId = ride?.base ?? carId ?? 'hypercar';
  return (
    <div className={`pf-preview${className ? ` ${className}` : ''}`} style={height !== undefined ? { height } : undefined} data-testid="ride-preview">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ fov: 38, near: 0.1, far: 80, position: [-3.6, 1.7, 4.4] }}
        gl={{ antialias: true, powerPreference: 'low-power' }}
        style={{ touchAction: 'none' }}
      >
        <Scene carId={id} ride={ride} driver={driver} autoRotate={autoRotate} onReady={onReady} />
      </Canvas>
    </div>
  );
}
