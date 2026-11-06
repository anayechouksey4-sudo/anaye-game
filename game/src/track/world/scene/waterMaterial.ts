/**
 * Opaque voxel water (one program for the sea and Glassmere): colour by the water depth stored in
 * tileTex.A (foam on the shallowest cells, turquoise shelf, deep blue), quantised "pixel wave"
 * bands that drift slowly, scene fog. Unlit.
 */
import { Color, ShaderMaterial, UniformsLib, UniformsUtils, type Texture } from 'three';

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec3 vWWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWWorld = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uTile;
uniform float uTime;
uniform float uDepthScale;
uniform vec3 uFoam;
uniform vec3 uShelf;
uniform vec3 uDeep;
varying vec3 vWWorld;
void main() {
  vec2 uv = (vWWorld.xz + 1024.0) / 2048.0;
  float depth = texture2D(uTile, uv).a * 25.5 * uDepthScale;
  bool inside = uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0;
  if (!inside) depth = 30.0;
  vec3 col = mix(uShelf, uDeep, smoothstep(2.0, 9.0, depth));
  col = mix(uFoam, col, smoothstep(0.18, 0.32, depth));
  // quantised wave bands on 2 m blocks
  vec2 q = floor(vWWorld.xz * 0.5) * 2.0;
  float w = fract((q.x * 0.61 + q.y * 0.37) / 23.0 + sin(q.y * 0.031 + uTime * 0.5) * 0.18 + uTime * 0.035);
  col *= 1.0 + 0.10 * step(0.86, w) - 0.05 * step(w, 0.08);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWaterMaterial(tile: Texture, depthScale = 1): ShaderMaterial {
  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTile: { value: null },
        uTime: { value: 0 },
        uDepthScale: { value: depthScale },
        uFoam: { value: new Color('#d8f2f4') },
        uShelf: { value: new Color('#2fb3b8') },
        uDeep: { value: new Color('#164c84') },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  });
  // UniformsUtils.merge clones values; textures must be the shared instance.
  material.uniforms.uTile!.value = tile;
  return material;
}
