/**
 * COLLAPSE ZONE: a grid of fixed voxel floor tiles over the void. The first touch arms a tile;
 * exactly TILES.collapseDelayS later (counted in physics steps) it turns dynamic and tumbles away.
 *
 * The car's wheels are raycasts, so they raise no collision events: touches are read every step
 * from `carRuntime.wheels[i].groundColliderHandle`, with a chassis contact-pair check as backup
 * (belly flops, sideways slides). Bodies are created imperatively so the tile ↔ collider mapping,
 * body-type switches and resets are fully under our control; visuals are one InstancedMesh.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAfterPhysicsStep, useRapier } from '@react-three/rapier';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import { Color, Euler, Matrix4, Quaternion, Vector3, type InstancedMesh } from 'three';
import { PHYSICS_DT } from '../../../config';
import { carRuntime } from '../../../car/runtime';
import { onGameEvent } from '../../../game/events';
import { COLORS, TILE_COLLISION_GROUPS, TILES } from '../config';
import { chaosRuntime, recordCollapse, register, type TileProbe, type TileState } from '../chaosRuntime';
import type { TilesSegment } from '../plan';
import { CHAOS_PALETTE, type TrackPalette } from '../recipe';
import { mulberry32 } from '../rng';
import { createVoxelMaterial, ensureInstanceAttributes } from '../voxel';

const DELAY_STEPS = Math.round(TILES.collapseDelayS / PHYSICS_DT);
const VISUAL_GAP = 0.16;
/** Tiles are heavy-ish slabs (density × volume ≈ 6.4 t) so a falling tile drags the car down with it. */
const TILE_DENSITY = 0.5;

interface TileRuntime {
  index: number;
  home: Vector3;
  body: RigidBody | null;
  collider: Collider | null;
  state: TileState;
  touchedStep: number | null;
  touchedBy: 'wheel' | 'chassis';
  droppedStep: number | null;
  /** Set while a reset tile waits (disabled) for its clean re-insertion. */
  enableAtStep: number | null;
  baseColor: Color;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _e = new Euler();
const _c = new Color();
const ORANGE = new Color(COLORS.orange);
const RED = new Color(COLORS.red);

export function CollapsingTiles({ segment, palette = CHAOS_PALETTE }: { segment: TilesSegment; palette?: TrackPalette }) {
  const { world, rapier } = useRapier();
  const meshRef = useRef<InstancedMesh>(null);
  const material = useMemo(() => createVoxelMaterial({ instanced: true, roughness: 0.6, metalness: 0.25 }), []);
  const stepRef = useRef(0);
  const dirtyRef = useRef(true);

  const tiles = useMemo<TileRuntime[]>(() => {
    const rng = mulberry32(segment.tiles.length * 7919 + Math.round(segment.fieldStartZ));
    return segment.tiles.map((t) => {
      const base = new Color(palette.hazard.tile);
      const hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl);
      base.setHSL(hsl.h + (rng() - 0.5) * 0.05, hsl.s, hsl.l * (0.8 + rng() * 0.45));
      return {
        index: t.index,
        home: new Vector3(...t.center),
        body: null,
        collider: null,
        state: 'solid',
        touchedStep: null,
        touchedBy: 'wheel',
        droppedStep: null,
        enableAtStep: null,
        baseColor: base,
      };
    });
  }, [segment, palette]);

  const byHandle = useRef(new Map<number, TileRuntime>());

  useEffect(() => {
    const half = segment.size / 2;
    const map = byHandle.current;
    for (const tile of tiles) {
      const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(tile.home.x, tile.home.y, tile.home.z));
      const collider = world.createCollider(
        rapier.ColliderDesc.cuboid(half, segment.thickness / 2, half)
          .setFriction(1)
          .setRestitution(0)
          .setDensity(TILE_DENSITY)
          .setCollisionGroups(TILE_COLLISION_GROUPS),
        body,
      );
      tile.body = body;
      tile.collider = collider;
      tile.state = 'solid';
      tile.touchedStep = null;
      tile.droppedStep = null;
      map.set(collider.handle, tile);
    }
    dirtyRef.current = true;
    return () => {
      for (const tile of tiles) {
        try {
          if (tile.body && world.getRigidBody(tile.body.handle)) world.removeRigidBody(tile.body);
        } catch {
          // The world may already be freed when <Physics> unmounts first.
        }
        tile.body = null;
        tile.collider = null;
      }
      map.clear();
    };
  }, [world, rapier, tiles, segment]);

  useEffect(() => {
    const resetTile = (tile: TileRuntime) => {
      const body = tile.body;
      if (!body) return;
      if (tile.state === 'solid' && body.isFixed() && tile.enableAtStep === null) return;
      // Turning a falling (dynamic) body back into a fixed one in place leaves a stale entry in
      // Rapier's scene-query BVH: the chassis still collides with the restored tile but the wheel
      // rays drive straight through it. Parking it disabled for a step before re-enabling forces
      // a clean re-insertion (the re-enable happens in the after-step callback).
      body.setEnabled(false);
      body.setBodyType(rapier.RigidBodyType.Fixed, false);
      body.setTranslation(tile.home, false);
      body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, false);
      body.setLinvel({ x: 0, y: 0, z: 0 }, false);
      body.setAngvel({ x: 0, y: 0, z: 0 }, false);
      tile.enableAtStep = stepRef.current + 2;
      tile.state = 'solid';
      tile.touchedStep = null;
      tile.droppedStep = null;
    };
    const resetAll = () => {
      tiles.forEach(resetTile);
      dirtyRef.current = true;
    };
    const offs = [
      onGameEvent('restart', resetAll),
      // Respawning at (or before) the checkpoint that guards this field means facing it again.
      onGameEvent('respawn', ({ checkpoint }) => {
        if (checkpoint <= segment.checkpoint) resetAll();
      }),
      register(chaosRuntime.tileSources, {
        probe: (): TileProbe[] =>
          tiles.map((t) => ({
            segment: segment.id,
            index: t.index,
            state: t.state,
            touchedStep: t.touchedStep,
            droppedStep: t.droppedStep,
            y: t.body ? t.body.translation().y : t.home.y,
            colliderY: t.collider ? t.collider.translation().y : t.home.y,
            enabled: t.body ? t.body.isEnabled() : false,
          })),
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [rapier, tiles, segment]);

  // Stable (not re-created every step); reads the step counter the after-step hook just advanced.
  const arm = useCallback((tile: TileRuntime, by: 'wheel' | 'chassis') => {
    if (tile.state !== 'solid') return;
    tile.state = 'armed';
    tile.touchedStep = stepRef.current;
    tile.touchedBy = by;
    dirtyRef.current = true;
  }, []);

  useAfterPhysicsStep(() => {
    const step = ++stepRef.current;
    const map = byHandle.current;

    if (carRuntime.ready) {
      for (const wheel of carRuntime.wheels) {
        if (!wheel.inContact || wheel.groundColliderHandle === null) continue;
        const tile = map.get(wheel.groundColliderHandle);
        if (tile) arm(tile, 'wheel');
      }
      checkChassisContacts(arm);
    }

    for (const tile of tiles) {
      const body = tile.body;
      if (!body) continue;
      if (tile.enableAtStep !== null) {
        if (step >= tile.enableAtStep) {
          body.setEnabled(true);
          tile.enableAtStep = null;
        }
        continue;
      }
      if (tile.state === 'armed' && tile.touchedStep !== null && step - tile.touchedStep >= DELAY_STEPS) {
        body.setBodyType(rapier.RigidBodyType.Dynamic, true);
        // A little tumble so a falling floor reads as debris, not an elevator.
        const k = TILES.tumble;
        const seed = Math.sin(tile.index * 12.9898 + step * 0.001) * 43758.5453;
        const r = seed - Math.floor(seed);
        body.setAngvel({ x: (r - 0.5) * 2 * k, y: (0.5 - r) * k * 0.5, z: (r * 2 - 1) * k }, true);
        body.wakeUp();
        tile.state = 'falling';
        tile.droppedStep = step;
        recordCollapse({ segment: segment.id, tile: tile.index, touchedStep: tile.touchedStep, droppedStep: step, delayS: (step - tile.touchedStep) * PHYSICS_DT, by: tile.touchedBy });
        dirtyRef.current = true;
      } else if (tile.state === 'falling' && body.translation().y < tile.home.y - TILES.disableDepth) {
        body.setEnabled(false);
        tile.state = 'gone';
        dirtyRef.current = true;
      }
    }
  });

  /** Backup for touches the wheel rays can't see: the chassis box resting on / sliding over tiles. */
  function checkChassisContacts(arm: (tile: TileRuntime, by: 'chassis') => void): void {
    const handle = carRuntime.chassisColliderHandle;
    if (handle === null) return;
    const p = carRuntime.position;
    const size = segment.size;
    const halfW = (segment.cols * size) / 2;
    const cx = segment.x0;
    if (p.z < segment.fieldStartZ - 4 || p.z > segment.fieldEndZ + 4 || Math.abs(p.x - cx) > halfW + 4) return;
    if (Math.abs(p.y - segment.y) > 4) return;
    const chassis = world.getCollider(handle);
    if (!chassis) return;
    const col0 = Math.floor((p.x - (cx - halfW)) / size);
    const row0 = Math.floor((p.z - segment.fieldStartZ) / size);
    for (let row = row0 - 1; row <= row0 + 1; row++) {
      for (let col = col0 - 1; col <= col0 + 1; col++) {
        if (row < 0 || row >= segment.rows || col < 0 || col >= segment.cols) continue;
        const tile = tiles[row * segment.cols + col];
        if (!tile || tile.state !== 'solid' || !tile.collider) continue;
        let touching = false;
        world.contactPair(chassis, tile.collider, (manifold) => {
          if (manifold.numContacts() > 0) touching = true;
        });
        if (touching) arm(tile, 'chassis');
      }
    }
  }

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    ensureInstanceAttributes(mesh);
    dirtyRef.current = true;
  }, [tiles]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh || !mesh.instanceColor) return;
    const animating = tiles.some((t) => t.state === 'armed' || t.state === 'falling');
    if (!animating && !dirtyRef.current) return;
    dirtyRef.current = false;
    const glow = mesh.geometry.getAttribute('instanceGlow');
    const time = state.clock.elapsedTime;
    const size = segment.size - VISUAL_GAP;
    const step = stepRef.current;
    for (const tile of tiles) {
      let g = 0.05;
      _c.copy(tile.baseColor);
      if (tile.state === 'gone' || !tile.body) {
        _m.makeScale(0, 0, 0);
      } else if (tile.state === 'falling') {
        const t = tile.body.translation();
        const r = tile.body.rotation();
        _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s.set(size, segment.thickness, size));
        _c.lerp(RED, 0.6);
        g = 0.6;
      } else if (tile.state === 'armed') {
        const progress = Math.min(1, (step - (tile.touchedStep ?? step)) / DELAY_STEPS);
        const amp = TILES.shake * (0.35 + 0.65 * progress);
        const ph = tile.index * 1.7;
        _p.set(
          tile.home.x + Math.sin(time * 53 + ph) * amp,
          tile.home.y + Math.sin(time * 71 + ph) * amp * 0.5,
          tile.home.z + Math.cos(time * 47 + ph) * amp,
        );
        _q.setFromEuler(_e.set(Math.sin(time * 37 + ph) * 0.02 * progress, 0, Math.cos(time * 41 + ph) * 0.02 * progress));
        _m.compose(_p, _q, _s.set(size, segment.thickness, size));
        const flash = 0.5 + 0.5 * Math.sin(time * (14 + 26 * progress));
        _c.copy(ORANGE).lerp(RED, progress);
        g = (0.4 + 1.2 * flash) * (0.6 + 0.5 * progress);
      } else {
        _m.compose(tile.home, _q.identity(), _s.set(size, segment.thickness, size));
      }
      mesh.setMatrixAt(tile.index, _m);
      mesh.setColorAt(tile.index, _c);
      glow.setX(tile.index, g);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    glow.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, material, tiles.length]} frustumCulled={false} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}
