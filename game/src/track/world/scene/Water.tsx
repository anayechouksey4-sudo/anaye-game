/**
 * Water: a 1,400 m sea quad at y 0 that follows the camera (snapped to 64 m) and Glassmere, a
 * 64-segment ellipse at the lake level covering the lake basin. Two draw calls, one program.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Group } from 'three';
import { worldEngine } from '../engine';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, PlaneGeometry, type Mesh, type ShaderMaterial } from 'three';
import { LAKE_LEVEL } from '../gen/types';
import { GLASSMERE } from '../gen/tessera';

const SEA_SIZE = 1400;
const SEA_SNAP = 64;
/** The lake basin as gen/textures.ts inLake() defines it: 1.3 × the semi-axes. */
const LAKE_SCALE = 1.3;

function lakeGeometry(): BufferGeometry {
  const seg = 64;
  const pos = new Float32Array((seg + 1) * 3);
  const idx = new Uint16Array(seg * 3);
  pos[0] = GLASSMERE.x;
  pos[1] = LAKE_LEVEL;
  pos[2] = GLASSMERE.z;
  for (let i = 0; i < seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    const o = (i + 1) * 3;
    pos[o] = GLASSMERE.x + Math.cos(t) * GLASSMERE.a * LAKE_SCALE;
    pos[o + 1] = LAKE_LEVEL;
    pos[o + 2] = GLASSMERE.z + Math.sin(t) * GLASSMERE.b * LAKE_SCALE;
    // CCW from +Y: centre, next, current
    idx[i * 3] = 0;
    idx[i * 3 + 1] = ((i + 1) % seg) + 1;
    idx[i * 3 + 2] = i + 1;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** `sea` / `lake`: water materials (waterMaterial.ts; the lake one with a stretched depth scale). Owned by the caller. */
export function Water({ sea: seaMat, lake: lakeMat }: { sea: ShaderMaterial; lake: ShaderMaterial }) {
  const sea = useRef<Mesh>(null);
  const group = useRef<Group>(null);
  const res = useMemo(() => {
    const seaGeo = new PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1);
    seaGeo.rotateX(-Math.PI / 2);
    return { seaGeo, lakeGeo: lakeGeometry(), seaMat, lakeMat };
  }, [seaMat, lakeMat]);
  useEffect(
    () => () => {
      res.seaGeo.dispose();
      res.lakeGeo.dispose();
    },
    [res],
  );

  useFrame(({ camera, clock }) => {
    if (group.current) group.current.visible = worldEngine.reveal.water;
    const t = clock.elapsedTime;
    res.seaMat.uniforms.uTime!.value = t;
    res.lakeMat.uniforms.uTime!.value = t;
    const m = sea.current;
    if (m) {
      m.position.set(Math.round(camera.position.x / SEA_SNAP) * SEA_SNAP, 0, Math.round(camera.position.z / SEA_SNAP) * SEA_SNAP);
      m.updateMatrix();
    }
  });

  return (
    <group ref={group} name="tessera-water" visible={false}>
      <mesh ref={sea} geometry={res.seaGeo} material={res.seaMat} matrixAutoUpdate={false} frustumCulled={false} name="tessera-sea" />
      <mesh geometry={res.lakeGeo} material={res.lakeMat} name="tessera-lake" />
    </group>
  );
}
