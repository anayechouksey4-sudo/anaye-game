/**
 * The voxel car of the mounted class, drawn in the chassis frame (+Z forward, +Y up, origin the
 * class's ride height above the ground at rest). Draw calls: body 1, front-wing elements 0–2,
 * wheels 4, exhaust flame 1 (only under throttle).
 *
 * Everything live is driven from useFrame — never React state — so dashboard changes show up on
 * the next frame without re-rendering:
 *   front wing   angle + chord follow physics.frontDownforce (Front Wing Aero)
 *   aero LEDs    cyan when the wing beats body lift, magenta when the nose is net-lifting; brightness
 *                follows the live front-axle aero load, blinking while the nose is up
 *   exhaust      colour cyan → yellow → magenta with engineTorque (Engine Tier), glow and flame
 *                length with throttle, a backfire pop on sharp lift-offs at high tiers
 *   tail lights  brighten under braking
 *   wheels       spin / steer / suspension travel from carRuntime (useWheelPose)
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type Group, type Mesh, type Object3D } from 'three';
import { gameState } from '../../state/store';
import { carRuntime } from '../runtime';
import { HYPERCAR_SPEC, type VehicleSpec, type WheelSpec } from '../vehicleSpec';
import { getCarAssets, type CarAssets } from './carAssets';
import { carFxDebug, useCarFxDebugHandle, type CarFxLiveState } from './carFxDebug';
import { CAR_COLORS, CH, setChannel } from './carMaterial';
import { frontWingPose, type FrontWingPose } from './frontWing';

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

function VoxelWheel({ wheel, assets }: { wheel: WheelSpec; assets: CarAssets }) {
  const { mountRef, spinRef } = useWheelPose(wheel);
  const geometry = assets.wheels[wheel.index];
  return (
    <group ref={mountRef} position={wheel.connection}>
      <group ref={spinRef}>
        <mesh geometry={geometry} material={assets.material.material} castShadow dispose={null} />
      </group>
    </group>
  );
}

// Preallocated colours for the per-frame channel updates.
const HEADLIGHT = new Color('#BDF6FF');
const CYAN = new Color(CAR_COLORS.cyan);
const MAGENTA = new Color(CAR_COLORS.magenta);
const YELLOW = new Color(CAR_COLORS.yellow);
const BACKFIRE = new Color('#FFE9A8');
const _exhaust = new Color();
const _aero = new Color();

/** Engine torque → 0 (tier 1) … 1 (tier 5) for the car's class, continuing past 1 for physics-panel values. */
function tierFraction(engineTorque: number, spec: VehicleSpec): number {
  const { torqueBase, torquePerTier } = spec.car;
  return Math.max(0, (engineTorque - torqueBase) / Math.max(1, 4 * torquePerTier));
}

/** cyan (tier 1) → yellow (tier 3) → magenta (tier 5). */
function exhaustColor(t: number, out: Color): Color {
  if (t <= 0.5) return out.copy(CYAN).lerp(YELLOW, t / 0.5);
  return out.copy(YELLOW).lerp(MAGENTA, Math.min((t - 0.5) / 0.5, 1));
}

const BACKFIRE_SECONDS = 0.16;

/** Visible meshes under the car (= colour-pass draw calls) and how many also cast shadows. */
function countDrawables(root: Object3D | null): { meshes: number; shadowCasters: number } {
  let meshes = 0;
  let shadowCasters = 0;
  root?.traverseVisible((o) => {
    if (!(o as Mesh).isMesh) return;
    meshes++;
    if (o.castShadow) shadowCasters++;
  });
  return { meshes, shadowCasters };
}

/** `spec`: the mounted class (defaults to the hypercar, e.g. for previews). */
export function CarModel({ spec = HYPERCAR_SPEC }: { spec?: VehicleSpec }) {
  const assets = getCarAssets(spec.id);
  const wing = assets.wing;
  const mainRef = useRef<Group>(null);
  const mainMeshRef = useRef<Mesh>(null);
  const upperMountRef = useRef<Group>(null);
  const upperRef = useRef<Group>(null);
  const upperMeshRef = useRef<Mesh>(null);
  const flameRef = useRef<Mesh>(null);
  const rootRef = useRef<Group>(null);
  const fx = useRef({
    pose: { mainAngle: 0, mainChordScale: 1, upperAngle: 0, upperChordScale: 1 } as FrontWingPose,
    target: { mainAngle: 0, mainChordScale: 1, upperAngle: 0, upperChordScale: 1 } as FrontWingPose,
    initialised: false,
    time: 0,
    prevThrottle: 0,
    backfire: 0,
    flameLength: 0,
  });

  useCarFxDebugHandle();
  useEffect(() => {
    const state = fx.current;
    const channels = assets.material.channels;
    carFxDebug.model = () => assets.stats;
    carFxDebug.live = (): CarFxLiveState => ({
      wingMainDeg: (state.pose.mainAngle * 180) / Math.PI,
      wingUpperDeg: (state.pose.upperAngle * 180) / Math.PI,
      wingMainChord: state.pose.mainChordScale,
      wingUpperChord: state.pose.upperChordScale,
      channels: channels.map((c) => [c.x, c.y, c.z]),
      flameLength: state.flameLength,
      drawables: countDrawables(rootRef.current),
    });
    return () => {
      carFxDebug.model = null;
      carFxDebug.live = null;
    };
  }, [assets]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const state = fx.current;
    state.time += dt;
    const physics = gameState().physics;
    const rt = carRuntime;
    const handle = assets.material;

    // Front wing: servo toward the pose for the live downforce factor.
    if (wing) frontWingPose(physics.frontDownforce, state.target, spec.car.frontWingMax, wing.config);
    const k = state.initialised ? 1 - Math.exp(-dt * 9) : 1;
    state.initialised = true;
    const pose = state.pose;
    pose.mainAngle += (state.target.mainAngle - pose.mainAngle) * k;
    pose.mainChordScale += (state.target.mainChordScale - pose.mainChordScale) * k;
    pose.upperAngle += (state.target.upperAngle - pose.upperAngle) * k;
    pose.upperChordScale += (state.target.upperChordScale - pose.upperChordScale) * k;
    if (wing && mainRef.current && mainMeshRef.current) {
      mainRef.current.rotation.x = pose.mainAngle;
      mainMeshRef.current.scale.z = pose.mainChordScale;
      const upper = wing.config.upper;
      if (upper && upperMountRef.current && upperRef.current && upperMeshRef.current) {
        upperMountRef.current.position.set(0, upper.hingeY, -wing.config.main.chord * pose.mainChordScale + upper.hingeOverlap);
        upperRef.current.rotation.x = pose.upperAngle - pose.mainAngle;
        upperMeshRef.current.scale.z = pose.upperChordScale;
      }
    }

    // Aero-status LEDs: setup verdict (colour) × live front-axle aero load (brightness).
    _aero.copy(physics.frontDownforce >= spec.car.frontBodyLift ? CYAN : MAGENTA);
    let aeroIntensity = 0.7 + 1.8 * Math.min(Math.abs(rt.frontAeroN) / 3000, 1);
    if (rt.noseLift) aeroIntensity = Math.sin(state.time * 38) > 0 ? 3.2 : 0.25;
    setChannel(handle, CH.aero, _aero, aeroIntensity);

    setChannel(handle, CH.headlight, HEADLIGHT, 2.4);
    setChannel(handle, CH.tail, MAGENTA, rt.brake > 0.05 || rt.handbrake > 0.05 ? 4.2 : 1.4);

    // Exhaust: tier sets the colour, throttle the glow and flame length.
    const tier = tierFraction(physics.engineTorque, spec);
    const throttle = rt.throttle;
    if (state.prevThrottle > 0.75 && throttle < 0.2 && rt.speedKmh > 70 && tier >= 0.7) state.backfire = BACKFIRE_SECONDS;
    state.prevThrottle = throttle;
    state.backfire = Math.max(0, state.backfire - dt);
    const flicker = 0.82 + 0.18 * Math.sin(state.time * 61) * Math.sin(state.time * 23.7);
    exhaustColor(Math.min(tier, 1), _exhaust);
    if (state.backfire > 0) _exhaust.lerp(BACKFIRE, 0.6);
    const exhaustGlow = (0.3 + 2.2 * throttle) * (0.6 + 0.6 * Math.min(tier, 1.5)) * flicker + state.backfire * 18;
    setChannel(handle, CH.exhaust, _exhaust, exhaustGlow);

    const flame = flameRef.current;
    if (flame) {
      const length = throttle * (0.35 + 0.8 * Math.min(tier, 1.5)) * flicker + state.backfire * 9;
      state.flameLength = length;
      flame.visible = length > 0.04;
      if (flame.visible) {
        const girth = 0.7 + 0.3 * Math.min(length, 1.2);
        flame.scale.set(girth, girth, Math.max(length, 0.05));
        assets.flameMaterial.color.copy(_exhaust);
        assets.flameMaterial.opacity = Math.min(0.35 + 0.5 * length, 0.95);
      }
    }
  });

  const material = assets.material.material;
  const [, outletY, outletZ] = assets.flameOrigin;
  return (
    <group ref={rootRef} name="car-model" userData={{ carId: spec.id }}>
      <mesh name="car-body" geometry={assets.body} material={material} castShadow receiveShadow dispose={null} />
      {wing && (
        <group position={wing.config.pivot}>
          <group ref={mainRef}>
            <mesh ref={mainMeshRef} name="car-front-wing-main" geometry={wing.main} material={material} dispose={null} />
            {wing.upper && (
              <group ref={upperMountRef}>
                <group ref={upperRef}>
                  <mesh ref={upperMeshRef} name="car-front-wing-upper" geometry={wing.upper} material={material} dispose={null} />
                </group>
              </group>
            )}
          </group>
        </group>
      )}
      {spec.wheels.map((wheel) => (
        <VoxelWheel key={wheel.id} wheel={wheel} assets={assets} />
      ))}
      {/* Flame geometry already carries the outlets' offsets; only the first outlet's plane is placed here. */}
      <mesh
        ref={flameRef}
        name="car-exhaust-flame"
        position={[0, outletY, outletZ]}
        geometry={assets.flame}
        material={assets.flameMaterial}
        visible={false}
        renderOrder={2}
        dispose={null}
      />
    </group>
  );
}
