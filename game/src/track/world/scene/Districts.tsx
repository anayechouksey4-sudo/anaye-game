/**
 * Props, buildings and trees: per 256 m district one merged near mesh (everything, < 300 m) and
 * one far mesh (buildings as 1–2 boxes, trees as 1, 300–540 m), both drawn with the shared voxel
 * material (vertex colour + glow attribute; the same program as the other maps' scenery).
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three';
import type { MeshArrays, WorldData } from '../gen/types';
import { worldEngine } from '../engine';
import { aabbDistance } from './terrainChunks';
import { geometryBytes } from './gpuBytes';

export const NEAR_FAR_M = 300;
export const FAR_FAR_M = 540;

export function toGeometry(m: MeshArrays): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.position, 3));
  g.setAttribute('normal', new BufferAttribute(m.normal, 3, true));
  g.setAttribute('color', new BufferAttribute(m.color, 3, true));
  g.setAttribute('glow', new BufferAttribute(m.glow, 1));
  g.setIndex(new BufferAttribute(m.index, 1));
  const b = m.bounds;
  g.boundingBox = new Box3(new Vector3(b[0], b[1], b[2]), new Vector3(b[3], b[4], b[5]));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
  return g;
}

interface DistrictMeshes {
  near: Mesh | null;
  far: Mesh | null;
  bounds: readonly number[];
}

function build(world: WorldData, material: Material): { group: Group; list: DistrictMeshes[]; geometries: BufferGeometry[] } {
  const group = new Group();
  group.name = 'tessera-districts';
  group.visible = false;
  const geometries: BufferGeometry[] = [];
  const list: DistrictMeshes[] = [];
  const mk = (m: MeshArrays | null, name: string): Mesh | null => {
    if (!m || m.index.length === 0) return null;
    const g = toGeometry(m);
    geometries.push(g);
    const mesh = new Mesh(g, material);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  for (const d of world.districts) {
    const near = mk(d.near, `district-${d.ix}-${d.iz}-near`);
    const far = mk(d.far, `district-${d.ix}-${d.iz}-far`);
    if (!near && !far) continue;
    const b = d.near?.bounds ?? d.far?.bounds ?? d.bounds;
    list.push({ near, far, bounds: b });
  }
  worldEngine.gpu.districts = geometryBytes(geometries);
  return { group, list, geometries };
}

export function Districts({ world, material }: { world: WorldData; material: Material }) {
  const built = useMemo(() => build(world, material), [world, material]);
  useEffect(() => () => built.geometries.forEach((g) => g.dispose()), [built]);

  useFrame(({ camera }) => {
    built.group.visible = worldEngine.reveal.districts;
    if (!built.group.visible) return;
    const p = camera.position;
    let nearN = 0;
    let farN = 0;
    for (const d of built.list) {
      const dist = aabbDistance(d.bounds, p.x, p.y, p.z);
      const useNear = dist < NEAR_FAR_M && d.near !== null;
      const useFar = !useNear && dist < FAR_FAR_M && d.far !== null;
      if (d.near) d.near.visible = useNear;
      if (d.far) d.far.visible = useFar;
      if (useNear) nearN++;
      if (useFar) farN++;
    }
    worldEngine.districts.near = nearN;
    worldEngine.districts.far = farN;
  });

  return <primitive object={built.group} />;
}
