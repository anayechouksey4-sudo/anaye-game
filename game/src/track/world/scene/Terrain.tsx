/**
 * Island terrain: 8 × 8 chunk meshes, each swapping between 3 LOD geometries by the distance from
 * the camera to the chunk's box (LOD0 < 170 m, LOD1 < 380 m, LOD2 < 540 m, hidden beyond). Chunks
 * lying entirely below y −0.5 (open sea floor) are never drawn. One material, one program.
 */
import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3, type Material } from 'three';
import { geometryBytes } from './gpuBytes';
import type { WorldData } from '../gen/types';
import { worldEngine } from '../engine';
import { aabbDistance, CHUNKS, chunkIndex, chunkPositions, LOD_STEPS } from './terrainChunks';

export const LOD_FAR = [170, 380, 540] as const;
const SUNKEN_Y = -0.5;

interface Chunk {
  mesh: Mesh;
  lods: BufferGeometry[];
  bounds: [number, number, number, number, number, number];
  sunken: boolean;
}

function buildChunks(world: WorldData, material: Material): { group: Group; chunks: Chunk[] } {
  const group = new Group();
  group.name = 'tessera-terrain';
  group.visible = false;
  const indices = LOD_STEPS.map((s) => new BufferAttribute(chunkIndex(s), 1));
  const chunks: Chunk[] = [];
  for (let cz = 0; cz < CHUNKS; cz++)
    for (let cx = 0; cx < CHUNKS; cx++) {
      let bounds: Chunk['bounds'] | null = null;
      const lods = LOD_STEPS.map((step, l) => {
        const c = chunkPositions(world.heights, cx, cz, step);
        if (l === 0) bounds = c.bounds;
        const g = new BufferGeometry();
        g.setAttribute('position', new BufferAttribute(c.position, 3));
        g.setIndex(indices[l]!);
        const b = c.bounds;
        const center = new Vector3((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
        const radius = Math.hypot(b[3] - b[0], b[4] - b[1] + 3, b[5] - b[2]) / 2;
        g.boundingSphere = new Sphere(center, radius);
        return g;
      });
      const b = bounds!;
      const mesh = new Mesh(lods[2], material);
      mesh.name = `terrain-${cx}-${cz}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      const sunken = b[4] < SUNKEN_Y;
      if (!sunken) group.add(mesh);
      chunks.push({ mesh, lods, bounds: b, sunken });
    }
  worldEngine.gpu.terrain = geometryBytes(chunks.filter((c) => !c.sunken).flatMap((c) => c.lods));
  return { group, chunks };
}

export function Terrain({ world, material }: { world: WorldData; material: Material }) {
  const built = useMemo(() => buildChunks(world, material), [world, material]);
  useEffect(
    () => () => {
      for (const c of built.chunks) for (const g of c.lods) g.dispose();
    },
    [built],
  );

  useFrame(({ camera }) => {
    built.group.visible = worldEngine.reveal.terrain;
    if (!built.group.visible) return;
    const p = camera.position;
    let l0 = 0;
    let l1 = 0;
    let l2 = 0;
    let hidden = 0;
    for (const c of built.chunks) {
      if (c.sunken) {
        hidden++;
        continue;
      }
      const d = aabbDistance(c.bounds, p.x, p.y, p.z);
      const lod = d < LOD_FAR[0] ? 0 : d < LOD_FAR[1] ? 1 : d < LOD_FAR[2] ? 2 : -1;
      if (lod < 0) {
        c.mesh.visible = false;
        hidden++;
        continue;
      }
      c.mesh.visible = true;
      c.mesh.geometry = c.lods[lod]!;
      if (lod === 0) l0++;
      else if (lod === 1) l1++;
      else l2++;
    }
    const s = worldEngine.chunks;
    s.lod0 = l0;
    s.lod1 = l1;
    s.lod2 = l2;
    s.hidden = hidden;
  });

  return <primitive object={built.group} />;
}
