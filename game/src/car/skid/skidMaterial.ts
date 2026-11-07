/**
 * Material for the skid-mark strip: an unlit, vertex-coloured, transparent MeshBasicMaterial (so it
 * takes the scene fog, tone mapping and colour space for free) whose alpha is the per-vertex
 * `aAlpha` times a fade computed in the shader from the vertex's `aBorn` time and a `uTime`
 * uniform: full for the first half of MARK_FADE_S, then a linear fade to nothing. Fully faded
 * fragments are discarded. Depth is tested but not written, and a small polygon offset keeps the
 * marks in front of the road at distance, where the 2 cm lift falls below the depth precision.
 */
import { DoubleSide, MeshBasicMaterial } from 'three';
import { MARK_FADE_S } from './skidRules';

export interface SkidMaterial extends MeshBasicMaterial {
  /** Drives the fade; SkidMarks sets `.value` to its mark clock every frame. */
  readonly uTime: { value: number };
}

export function createSkidMaterial(): SkidMaterial {
  const material = new MeshBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  }) as MeshBasicMaterial & { uTime: { value: number } };
  material.name = 'skid-marks';
  material.toneMapped = false;
  // three draws a transparent double-sided material in two passes (back faces, then front) unless
  // told not to; the strip is flat, so one pass = one draw call.
  material.forceSinglePass = true;
  const uTime = { value: 0 };
  material.uTime = uTime;
  const fade = MARK_FADE_S.toFixed(3);
  const tail = (MARK_FADE_S * 0.5).toFixed(3);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nattribute float aBorn;\nuniform float uTime;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvAlpha = aAlpha * clamp((${fade} - (uTime - aBorn)) / ${tail}, 0.0, 1.0);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;\nif (diffuseColor.a < 0.004) discard;');
  };
  material.customProgramCacheKey = () => 'skid-marks-v1';
  return material;
}
