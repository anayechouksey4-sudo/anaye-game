/**
 * Every island collider on ONE fixed body at the origin (PLAN §4.8): the 513² heightfield, one
 * trimesh per district (solid props only; ghost props have none), and the ramp cuboids. Created
 * imperatively: the body, heightfield and ramps at once, the trimeshes 8 per frame; `onProgress`
 * reports 0…1 and `onReady` fires once everything exists. Freed with removeRigidBody on unmount.
 */
import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { WORLD_CELLS, WORLD_SIZE, type WorldData } from '../gen/types';
import { worldEngine } from '../engine';

const TRIMESHES_PER_FRAME = 8;

const _qy = new Quaternion();
const _qp = new Quaternion();
const Y = new Vector3(0, 1, 0);
const X = new Vector3(1, 0, 0);

export function WorldColliders({ world: data, onProgress, onReady }: { world: WorldData; onProgress: (p: number) => void; onReady: () => void }) {
  const { world, rapier } = useRapier();
  const state = useRef<{ body: RigidBody | null; next: number; done: boolean; total: number }>({ body: null, next: 0, done: false, total: 0 });
  const cb = useRef({ onProgress, onReady });
  cb.current = { onProgress, onReady };

  useEffect(() => {
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
    const hf = world.createCollider(
      rapier.ColliderDesc.heightfield(WORLD_CELLS, WORLD_CELLS, data.hf, { x: WORLD_SIZE, y: 1, z: WORLD_SIZE }, rapier.HeightFieldFlags.FIX_INTERNAL_EDGES)
        .setFriction(1)
        .setRestitution(0),
      body,
    );
    const names = new Map<number, string>([[hf.handle, 'heightfield']]);
    for (const r of data.ramps) {
      _qy.setFromAxisAngle(Y, r.yaw);
      _qp.setFromAxisAngle(X, r.pitch);
      _qy.multiply(_qp);
      const c = world.createCollider(
        rapier.ColliderDesc.cuboid(r.half[0], r.half[1], r.half[2])
          .setTranslation(r.center[0], r.center[1], r.center[2])
          .setRotation({ x: _qy.x, y: _qy.y, z: _qy.z, w: _qy.w })
          .setFriction(1)
          .setRestitution(0),
        body,
      );
      names.set(c.handle, `ramp:${r.rampId}`);
    }
    worldEngine.colliderNames = names;
    const st = state.current;
    st.body = body;
    st.next = 0;
    st.done = false;
    st.total = data.districts.filter((d) => d.collider).length;
    worldEngine.physics = { world, rapier };
    worldEngine.bodyHandle = body.handle;
    worldEngine.heightfieldHandle = hf.handle;
    worldEngine.colliders = 1 + data.ramps.length;
    return () => {
      try {
        if (world.getRigidBody(body.handle)) world.removeRigidBody(body);
      } catch {
        // The physics world may already be freed when <Physics> unmounts first.
      }
      st.body = null;
      st.done = true;
      worldEngine.physics = null;
      worldEngine.bodyHandle = null;
      worldEngine.heightfieldHandle = null;
      worldEngine.colliders = 0;
    };
  }, [world, rapier, data]);

  useFrame(() => {
    const st = state.current;
    if (st.done || !st.body) return;
    let made = 0;
    const list = data.districts;
    while (st.next < list.length && made < TRIMESHES_PER_FRAME) {
      const d = list[st.next++]!;
      const col = d.collider;
      if (!col) continue;
      const c = world.createCollider(
        rapier.ColliderDesc.trimesh(col.vertices, col.indices, rapier.TriMeshFlags.FIX_INTERNAL_EDGES).setFriction(0.6).setRestitution(0.1),
        st.body,
      );
      worldEngine.colliderNames.set(c.handle, `district:${d.ix},${d.iz}`);
      worldEngine.colliders++;
      made++;
    }
    const builtTrimeshes = worldEngine.colliders - 1 - data.ramps.length;
    cb.current.onProgress(st.total > 0 ? builtTrimeshes / st.total : 1);
    if (st.next >= list.length) {
      st.done = true;
      cb.current.onReady();
    }
  });

  return null;
}
