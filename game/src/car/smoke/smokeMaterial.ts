/**
 * Material for the voxel smoke puffs: a lit, transparent MeshStandardMaterial whose alpha is
 * multiplied by a per-instance `aAlpha` attribute, so one InstancedMesh draws every puff at its
 * own fade level. Instance colour (three's built-in instanceColor) tints each puff.
 */
import { MeshStandardMaterial } from 'three';

export function createSmokeMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    // Faint self-light so puffs stay visible in the car's shadow and against the dark void.
    emissive: '#1b1f2a',
    transparent: true,
    depthWrite: false,
  });
  material.name = 'voxel-tyre-smoke';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  material.customProgramCacheKey = () => 'voxel-tyre-smoke-v1';
  return material;
}
