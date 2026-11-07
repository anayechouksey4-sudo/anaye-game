/**
 * A car drawn from a pose you mutate in place each frame: the rivals (rivals/), the shadow ghost and
 * the multiplayer builder's remote players. No React re-render per frame, no physics body, no
 * collider: a group follows `pose.position` / `pose.quaternion` in useFrame, the wheels spin from
 * `pose.speedKmh` and steer from `pose.steer`.
 *
 * CONTRACT (PLAN-M1 §2 R; extend freely, never rename): KinematicPose, KinematicCarProps, default export.
 *
 * Budget: 3 draw calls per car (body + wing merged, the 4 wheels as one InstancedMesh, the plate),
 * no shadow casting; the body is the class's voxel car wearing `look` at half resolution
 * (rivalAssets.ts) so three rivals stay under ~30 k triangles. `label` is drawn by the HUD
 * (rivals/NameTags) from a screen projection: no extra draw call.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type JSX } from 'react';
import { useFrame } from '@react-three/fiber';
import { Matrix4, Object3D, type Group, type InstancedMesh, type MeshStandardMaterial, type Quaternion, type Vector3 } from 'three';
import { isCarClassId, type CarClassId } from '@shared/protocol';
import { defaultPlateFor, getCarEntry } from '../car/catalog';
import { PLATE_THICKNESS, getPlateAsset, plateGeometry } from '../car/plates/plateTexture';
import { normalizePlate } from '../car/plates/plateText';
import { getVehicleSpec } from '../car/vehicleSpec';
import { CAR_MODELS } from '../car/model/models';
import type { AvatarConfig } from '../drivers/avatar';
import type { RideConfig } from '../ride/config';
import { registerTag, updateTag, unregisterTag } from './nameTags';
import { getRivalAssets, kinematicMaterial } from './rivalAssets';

export interface KinematicPose {
  position: Vector3;
  quaternion: Quaternion;
  speedKmh: number;
  /** −1…1, + = right (the player's convention, car/input.ts). */
  steer: number;
}

/** What the car wears: MY RIDE's config (or null for the stock class) and the driver (painted window / bust). */
export interface RideLook {
  ride: RideConfig | null;
  driver: AvatarConfig | null;
}

export interface KinematicCarProps {
  carId: CarClassId;
  look?: RideLook | null;
  /** Rear plate text (car/plates rules: ≤ 14 of A–Z 0–9 space); default: the class's catalog plate. */
  plate?: string;
  /** Name tag over the roof (drawn by the HUD; needs <NameTags/> mounted, see rivals/NameTags.tsx). */
  label?: string;
  labelColor?: string;
  /** 0…1; below 1 the car is drawn translucent (no shadows). */
  opacity?: number;
  /** Optional live opacity (mutated in place, read every frame): overrides `opacity` without a re-render. */
  fade?: { opacity: number };
  pose: KinematicPose;
}

const _m = new Matrix4();
const _dummy = new Object3D();

/** Opacity → material flags; `transparent` flips only across 0.999 so an opaque car keeps the opaque program. */
function applyOpacity(material: MeshStandardMaterial, value: number, st: { opacity: number }): void {
  const v = Math.max(0, Math.min(1, value));
  if (v === st.opacity) return;
  st.opacity = v;
  const translucent = v < 0.999;
  if (material.transparent !== translucent) {
    material.transparent = translucent;
    material.needsUpdate = true;
  }
  material.opacity = v;
}

/** Wheel pose (steer about Y, spin about X) in the chassis frame, as the player's useWheelPose does. */
function wheelMatrix(connection: readonly [number, number, number], restLength: number, steer: number, spin: number, scaleX: number, out: Matrix4): void {
  _dummy.position.set(connection[0], connection[1] - restLength, connection[2]);
  _dummy.rotation.set(spin, steer, 0, 'YXZ');
  _dummy.scale.set(scaleX, 1, 1);
  _dummy.updateMatrix();
  out.copy(_dummy.matrix);
}

export default function KinematicCar(props: KinematicCarProps): JSX.Element {
  const { pose, label, labelColor, fade } = props;
  const carId: CarClassId = isCarClassId(props.carId) ? props.carId : 'hypercar';
  const opacity = props.opacity ?? 1;
  const look = props.look ?? null;
  const spec = useMemo(() => getVehicleSpec(carId), [carId]);
  const assets = getRivalAssets(carId, look);
  const plateText = normalizePlate(props.plate) || defaultPlateFor(carId);
  const plate = getPlateAsset(plateText, getCarEntry(carId).accent);
  const plateMount = CAR_MODELS[carId].plates?.rear;
  const rootRef = useRef<Group>(null);
  const wheelsRef = useRef<InstancedMesh>(null);
  const state = useRef({ spin: 0, steer: 0, tagId: -1, opacity: -1 });
  // One material instance per car (opacity is a material property); disposed with the car.
  const material = useMemo(() => kinematicMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  useLayoutEffect(() => {
    applyOpacity(material, props.fade ? props.fade.opacity : opacity, state.current);
  }, [material, opacity, props.fade]);

  // Name tag: registered with the HUD projector while a label is set.
  useEffect(() => {
    if (!label) return;
    const id = registerTag(label, labelColor ?? '#d8f7ff');
    state.current.tagId = id;
    return () => {
      state.current.tagId = -1;
      unregisterTag(id);
    };
  }, [label, labelColor]);

  useFrame((_, delta) => {
    const root = rootRef.current;
    if (!root) return;
    root.position.copy(pose.position);
    root.quaternion.copy(pose.quaternion);
    const dt = Math.min(delta, 0.1);
    const st = state.current;
    if (fade) applyOpacity(material, fade.opacity, st);
    // Rolling angle from speed (rear wheel radius); steering eased toward the request.
    const w0 = spec.wheels[0]!;
    st.spin += ((pose.speedKmh / 3.6) * dt) / Math.max(0.05, w0.radius);
    if (st.spin > 1e4) st.spin -= 1e4;
    const maxSteer = 0.55;
    st.steer += (-pose.steer * maxSteer - st.steer) * Math.min(1, dt * 10);
    const wheels = wheelsRef.current;
    if (wheels) {
      const rear = spec.wheels[2]!;
      for (let i = 0; i < spec.wheels.length; i++) {
        const w = spec.wheels[i]!;
        wheelMatrix(w.connection, spec.suspensionRestLength + spec.staticCompression, w.steered ? st.steer : 0, st.spin, w.width / rear.width, _m);
        wheels.setMatrixAt(i, _m);
      }
      wheels.instanceMatrix.needsUpdate = true;
    }
    if (st.tagId >= 0) updateTag(st.tagId, pose.position.x, pose.position.y + spec.body.height - spec.rideHeight + 0.6, pose.position.z);
  });

  // Rear wheel geometry serves all four (front pairs are scaled across by their width ratio).
  const wheelGeometry = assets.wheels[2] ?? assets.wheels[0]!;
  const stance = look?.ride && look.ride.base === carId ? look.ride.stance : 0;
  return (
    <group ref={rootRef} name="kinematic-car" userData={{ carId, look: assets.lookKey }} frustumCulled={false}>
      <group position={[0, stance, 0]}>
        <mesh name="kinematic-body" geometry={assets.body} material={material} receiveShadow dispose={null} />
        {plateMount && (
          <mesh
            name="kinematic-plate"
            geometry={plateGeometry()}
            material={plate.material}
            position={[plateMount.position[0], plateMount.position[1] - spec.rideHeight, plateMount.position[2] - PLATE_THICKNESS / 2 - 0.001]}
            rotation={[plateMount.tilt ?? 0, Math.PI, 0]}
            scale={[plateMount.scale ?? 1, plateMount.scale ?? 1, 1]}
            userData={{ plate: plateText }}
            dispose={null}
          />
        )}
      </group>
      <instancedMesh ref={wheelsRef} name="kinematic-wheels" args={[wheelGeometry, material, spec.wheels.length]} receiveShadow dispose={null} frustumCulled={false} />
    </group>
  );
}
