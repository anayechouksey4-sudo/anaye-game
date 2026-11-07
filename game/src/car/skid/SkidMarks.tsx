/**
 * Skid marks, in WORLD space (a sibling of the car's RigidBody, like the smoke): dark tyre marks
 * laid where a grounded wheel slides, read every frame from `carRuntime` — contact point and
 * normal, slip, the handbrake — and never touching the physics.
 *
 *   Each wheel lays a strip: while its mark intensity (skidRules.ts: combined slip above a
 *   threshold, or a rear wheel dragged under the handbrake) stays above zero, every frame the
 *   contact patch moved at least MARK_MIN_STEP_M adds one quad from the previous strip edge to the
 *   current one, perpendicular to the patch's travel, as wide as the tyre (its shorter contact
 *   length when sliding sideways), lifted MARK_LIFT_M along the contact normal, alpha by slip and
 *   surface (black rubber on built surfaces, a pale scuff on ice, salt and snow, ruts on the
 *   island's dirt, grass and sand). A jump longer than MARK_BREAK_M (a respawn, a flight) starts a
 *   new strip. Marks hold for half of MARK_FADE_S and fade over the rest, in the shader.
 *
 *   All four wheels share ONE ring buffer of SKID_CAPACITY quads in one mesh (one draw call, no
 *   shadow pass), created once for the whole app: the marks belong to the track, so they survive a
 *   car swap on the same map and are cleared when a different map mounts (Car remounts per
 *   track + car). Nothing is allocated per frame; a frame uploads only the vertices it wrote.
 *   Paused by the ☰ menu: nothing is laid and the fade clock stops, like the smoke.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Mesh, Vector3 } from 'three';
import { PHYSICS_DT } from '../../config';
import { selectionState } from '../../state/selection';
import { gameState } from '../../state/store';
import { worldLive } from '../../state/worldRuntime';
import { carRuntime } from '../runtime';
import { WHEEL_COUNT, type VehicleSpec } from '../vehicleSpec';
import { SkidBuffer } from './skidBuffer';
import { skidDebug, type SkidDebugHandle, type SkidDebugStats } from './skidDebug';
import { createSkidMaterial, type SkidMaterial } from './skidMaterial';
import { MARK_ALPHA_MAX, MARK_BREAK_M, MARK_FADE_S, MARK_LIFT_M, MARK_MIN_STEP_M, markHalfWidth, markIntensity, markStyle } from './skidRules';
import { skidSettings, useSkidSettings } from './skidStore';

export { SKID_CAPACITY } from './skidBuffer';

/** The strip state of one wheel between frames. */
interface Trail {
  active: boolean;
  /** Previous strip edge: left and right corners. */
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Previous centre point. */
  px: number;
  py: number;
  pz: number;
  /** Previous side vector (keeps the strip from twisting when the travel direction flips). */
  sx: number;
  sy: number;
  sz: number;
  /** Alpha at the previous edge. */
  alpha: number;
}

function makeTrail(): Trail {
  return { active: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, sx: 0, sy: 0, sz: 0, alpha: 0 };
}

/** One buffer, mesh, material and clock for the whole app (see the header). */
interface SharedMarks {
  buffer: SkidBuffer;
  mesh: Mesh;
  material: SkidMaterial;
  /** Mark clock, s: advances only while the game runs. */
  now: number;
  trails: Trail[];
  laying: boolean[];
  triangles: number;
}

let shared: SharedMarks | null = null;

function sharedMarks(): SharedMarks {
  if (shared) return shared;
  const buffer = new SkidBuffer();
  const material = createSkidMaterial();
  const mesh = new Mesh(buffer.geometry, material);
  mesh.name = 'skid-marks';
  // The strip spans the whole track behind the car; bounds would always be stale.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  // Over the road (opaque), under the smoke (renderOrder 3).
  mesh.renderOrder = 2;
  mesh.visible = false;
  shared = {
    buffer,
    mesh,
    material,
    now: 0,
    trails: Array.from({ length: WHEEL_COUNT }, makeTrail),
    laying: new Array<boolean>(WHEEL_COUNT).fill(false),
    triangles: 0,
  };
  return shared;
}

function dropTrails(S: SharedMarks): void {
  for (let i = 0; i < WHEEL_COUNT; i++) {
    S.trails[i]!.active = false;
    S.laying[i] = false;
  }
}

function clearMarks(S: SharedMarks): void {
  S.buffer.clear();
  dropTrails(S);
  S.triangles = 0;
  S.mesh.visible = false;
}

const _render = new Vector3();
const _offset = new Vector3();
const _arm = new Vector3();
const _patchVelocity = new Vector3();
const _dir = new Vector3();
const _side = new Vector3();

/** `spec`: the mounted car's geometry (tyre widths, which axle each wheel is on). */
export function SkidMarks({ spec }: { spec: VehicleSpec }) {
  const S = useMemo(sharedMarks, []);

  useEffect(() => {
    // Marks belong to the map: a different map mounting starts clean, a car swap keeps them.
    const trackId = gameState().trackLayout?.id ?? null;
    if (S.buffer.trackId !== trackId) {
      clearMarks(S);
      S.buffer.trackId = trackId;
    } else {
      dropTrails(S); // the new car's wheels start their own strips
    }
    const stats = (): SkidDebugStats => ({
      enabled: skidSettings().marks,
      capacity: S.buffer.capacity,
      live: S.buffer.live,
      written: S.buffer.written,
      head: S.buffer.head,
      tail: S.buffer.tail,
      visible: S.mesh.visible,
      triangles: S.triangles,
      now: S.now,
      newestAgeS: S.buffer.live > 0 ? S.now - S.buffer.newestBorn : null,
      trackId: S.buffer.trackId,
      fadeS: MARK_FADE_S,
      laying: S.laying.slice(),
    });
    skidDebug.stats = stats;
    skidDebug.clear = () => clearMarks(S);
    const handle: SkidDebugHandle = {
      stats: () => skidDebug.stats?.() ?? null,
      setEnabled: (on) => useSkidSettings.getState().setMarks(on),
      clear: () => skidDebug.clear?.(),
    };
    window.__SKID__ = handle;
    return () => {
      dropTrails(S);
      if (skidDebug.stats === stats) skidDebug.stats = null;
      if (window.__SKID__ === handle) delete window.__SKID__;
    };
  }, [S]);

  useFrame((_, delta) => {
    const B = S.buffer;
    if (!skidSettings().marks) {
      // OFF: nothing drawn and nothing kept, so turning it back on starts clean.
      if (B.live > 0 || B.written > 0 || S.mesh.visible) clearMarks(S);
      return;
    }
    // Paused by the ☰ menu: physics is frozen with the last slip values still set, so neither lay
    // nor age marks — they stay as they are and carry on on RESUME.
    if (selectionState().menuOpen) return;
    const dt = Math.min(delta, 0.1);
    S.now += dt;
    const now = S.now;
    const rt = carRuntime;

    if (rt.ready && rt.chassisObject) {
      // Contact points are recorded before the step integrates (one step behind rt.position) and
      // the rendered car is interpolated a little behind it; shift by both so the strip's tip
      // sits under the wheel you actually see.
      rt.chassisObject.getWorldPosition(_render);
      _offset.subVectors(_render, rt.position).addScaledVector(rt.velocity, PHYSICS_DT);
      const trackGrip = gameState().trackLayout?.surfaceGrip ?? 1;
      const handbrake = rt.handbrake;

      for (let i = 0; i < WHEEL_COUNT; i++) {
        const w = rt.wheels[i];
        const wheel = spec.wheels[i];
        const trail = S.trails[i];
        if (!w || !wheel || !trail) continue;
        const n = w.contactNormalWorld;
        // Velocity of the contact patch (chassis velocity + spin × lever arm), in the surface plane.
        _arm.subVectors(w.contactPointWorld, rt.position);
        _patchVelocity.crossVectors(rt.angularVelocity, _arm).add(rt.velocity);
        _dir.copy(_patchVelocity).addScaledVector(n, -n.dot(_patchVelocity));
        const travel = _dir.length();

        const intensity = markIntensity(w.inContact, w.slip01, handbrake, wheel.axle === 'rear', travel);
        if (intensity <= 0) {
          trail.active = false;
          S.laying[i] = false;
          continue;
        }
        S.laying[i] = true;
        // A standing burnout moves nothing: keep the strip where it is until the car rolls.
        if (travel < 0.05) continue;
        _dir.multiplyScalar(1 / travel);
        _side.crossVectors(n, _dir);
        const sideLength = _side.length();
        if (sideLength < 1e-4) continue;
        _side.multiplyScalar(1 / sideLength);
        if (trail.active && _side.x * trail.sx + _side.y * trail.sy + _side.z * trail.sz < 0) _side.negate();

        const half = markHalfWidth(wheel.width, _dir.dot(rt.forward));
        const p = w.contactPointWorld;
        const cx = p.x + n.x * MARK_LIFT_M + _offset.x;
        const cy = p.y + n.y * MARK_LIFT_M + _offset.y;
        const cz = p.z + n.z * MARK_LIFT_M + _offset.z;
        const style = markStyle(worldLive.wheelSurface[i] ?? null, trackGrip);
        const alpha = MARK_ALPHA_MAX * style.alpha * intensity;
        const lx = cx - _side.x * half;
        const ly = cy - _side.y * half;
        const lz = cz - _side.z * half;
        const rx = cx + _side.x * half;
        const ry = cy + _side.y * half;
        const rz = cz + _side.z * half;

        if (trail.active) {
          const dx = cx - trail.px;
          const dy = cy - trail.py;
          const dz = cz - trail.pz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < MARK_MIN_STEP_M) continue; // merge into the next frame's step
          if (dist <= MARK_BREAK_M) {
            B.writeQuad(trail.lx, trail.ly, trail.lz, trail.rx, trail.ry, trail.rz, rx, ry, rz, lx, ly, lz, style.r, style.g, style.b, trail.alpha, alpha, now);
          }
          // else: the wheel jumped (respawn, flight): start a new strip here.
        }
        trail.active = true;
        trail.lx = lx;
        trail.ly = ly;
        trail.lz = lz;
        trail.rx = rx;
        trail.ry = ry;
        trail.rz = rz;
        trail.px = cx;
        trail.py = cy;
        trail.pz = cz;
        trail.sx = _side.x;
        trail.sy = _side.y;
        trail.sz = _side.z;
        trail.alpha = alpha;
      }
    } else {
      dropTrails(S);
    }

    B.expire(now);
    S.material.uTime.value = now;
    S.triangles = B.flush();
    S.mesh.visible = S.triangles > 0;
  });

  return <primitive object={S.mesh} />;
}
