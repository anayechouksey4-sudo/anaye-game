/**
 * Terrain material: one MeshLambertMaterial (flat shading from derivatives, no normal attribute)
 * patched in onBeforeCompile, one shader program for every chunk and LOD. Lambert, not Standard:
 * the ground is matte anyway (roughness ≈ 1, no metal, no env map), and the program is a fraction
 * of the size, so it links faster and costs less per fragment on phones. It draws:
 *   - tileTex (4 m voxel tiles with baked prop shadows / AO; sampled NEAREST);
 *   - 4 m tile grout off-road, anti-aliased with fwidth, fading out by 120 m;
 *   - 1 m strata bands on steep faces (the tile colour already carries the region's rock tint);
 *   - roads from fieldTex: per-vertex distance to the centreline (the 4 corners are fetched and the
 *     sign pattern that fits a planar unit-gradient field is chosen, so the centreline is exact
 *     even between vertices), station phase (sin/cos), kind/width/kerb/neon bits from the nearest
 *     corner: asphalt with edge lines + centre dashes, flush kerbs, cyan emissive city edges, dirt
 *     ruts, cobbles, rail sleepers and rails, pier planks;
 *   - an underwater tint from the water depth in tileTex.A.
 */
import {
  DataTexture,
  LinearMipmapLinearFilter,
  MeshLambertMaterial,
  NearestFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture,
} from 'three';
import { WORLD_CELLS, WORLD_N, type WorldData } from '../gen/types';

export interface TerrainTextures {
  tile: DataTexture;
  field: DataTexture;
  dispose(): void;
}

export function createTerrainTextures(world: WorldData): TerrainTextures {
  const tile = new DataTexture(world.tileTex, WORLD_CELLS, WORLD_CELLS, RGBAFormat, UnsignedByteType);
  tile.colorSpace = SRGBColorSpace;
  tile.magFilter = NearestFilter;
  tile.minFilter = LinearMipmapLinearFilter;
  tile.generateMipmaps = true;
  tile.flipY = false;
  tile.needsUpdate = true;
  const field = new DataTexture(world.fieldTex, WORLD_N, WORLD_N, RGBAFormat, UnsignedByteType);
  field.colorSpace = NoColorSpace;
  field.magFilter = NearestFilter;
  field.minFilter = NearestFilter;
  field.generateMipmaps = false;
  field.flipY = false;
  field.needsUpdate = true;
  return {
    tile,
    field,
    dispose: () => {
      tile.dispose();
      field.dispose();
    },
  };
}

const VERT_PARS = /* glsl */ `
varying vec3 vTWorld;
`;
const VERT_MAIN = /* glsl */ `
vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

const FRAG_PARS = /* glsl */ `
uniform sampler2D uTile;
uniform highp sampler2D uField;
varying vec3 vTWorld;

float tBand(float x, float c, float hw) {
  float w = max(fwidth(x), 1e-3);
  return 1.0 - smoothstep(hw - w, hw + w, abs(x - c));
}
float tHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
const vec4 T_SIGNS[9] = vec4[9](
  vec4(1.0, 1.0, 1.0, 1.0),
  vec4(-1.0, 1.0, 1.0, 1.0), vec4(1.0, -1.0, 1.0, 1.0), vec4(1.0, 1.0, -1.0, 1.0), vec4(1.0, 1.0, 1.0, -1.0),
  vec4(-1.0, -1.0, 1.0, 1.0), vec4(1.0, 1.0, -1.0, -1.0), vec4(-1.0, 1.0, -1.0, 1.0), vec4(1.0, -1.0, 1.0, -1.0)
);
`;

const FRAG_MAIN = /* glsl */ `
vec3 tW = vTWorld;
float tCam = length(tW - cameraPosition);
vec4 tTile = texture2D(uTile, (tW.xz + 1024.0) / 2048.0);
vec3 tCol = tTile.rgb;
float tDepth = tTile.a * 25.5;
vec3 tN = normalize(cross(dFdx(tW), dFdy(tW)));
float tNy = abs(tN.y);
float tNeon = 0.0;

// --- road field: 4 corners (vertex grid, 4 m)
vec2 tG = clamp((tW.xz + 1024.0) * 0.25, vec2(0.0), vec2(511.999));
vec2 tG0 = floor(tG);
vec2 tF = tG - tG0;
ivec2 tI = ivec2(tG0);
vec4 tF00 = texelFetch(uField, tI, 0);
vec4 tF10 = texelFetch(uField, tI + ivec2(1, 0), 0);
vec4 tF01 = texelFetch(uField, tI + ivec2(0, 1), 0);
vec4 tF11 = texelFetch(uField, tI + ivec2(1, 1), 0);
vec4 tD = vec4(tF00.r, tF10.r, tF01.r, tF11.r) * 63.75;
float tDMax = max(max(tD.x, tD.y), max(tD.z, tD.w));
float tOnRoad = 0.0;
if (min(min(tD.x, tD.y), min(tD.z, tD.w)) < 12.0) {
  // metadata from the nearest corner that has a road
  vec4 tFN = tF.x < 0.5 ? (tF.y < 0.5 ? tF00 : tF01) : (tF.y < 0.5 ? tF10 : tF11);
  if (tFN.a < 0.5 / 255.0) {
    float m = min(min(tD.x, tD.y), min(tD.z, tD.w));
    tFN = m == tD.x ? tF00 : m == tD.y ? tF10 : m == tD.z ? tF01 : tF11;
  }
  int tA = int(tFN.a * 255.0 + 0.5);
  int tKind = tA & 7;
  int tWc = (tA >> 3) & 7;
  bool tKerb = (tA & 64) != 0;
  bool tNeonF = (tA & 128) != 0;
  float tHalf = tWc > 0 ? 2.0 + float(tWc) : 0.0;
  // distance: plain bilinear, or (near the centreline) the signed planar fit
  float tDist = mix(mix(tD.x, tD.y, tF.x), mix(tD.z, tD.w, tF.x), tF.y);
  // fit residual: ~0 where the 4 corners measure one road; large where two roads meet (junctions),
  // whose station phases do not match, so dashes and kerbs are left out there
  float tFit = 0.0;
  if (tDMax < 20.0) {
    float best = 1e9;
    vec4 bs = tD;
    for (int k = 0; k < 9; k++) {
      vec4 s = T_SIGNS[k] * tD;
      float gx = 0.5 * ((s.y - s.x) + (s.w - s.z));
      float gz = 0.5 * ((s.z - s.x) + (s.w - s.y));
      float r = abs(s.x + s.w - s.y - s.z) + abs(gx * gx + gz * gz - 16.0) * 0.125;
      if (r < best) { best = r; bs = s; }
    }
    tDist = abs(mix(mix(bs.x, bs.y, tF.x), mix(bs.z, bs.w, tF.x), tF.y));
    tFit = best;
  }
  float tClean = 1.0 - step(1.0, tFit);
  if (tKind > 0 && tHalf > 0.0) {
    float aa = max(fwidth(tDist), 0.03);
    tOnRoad = 1.0 - smoothstep(tHalf - aa, tHalf + aa, tDist);
    float sn = mix(mix(tF00.g, tF10.g, tF.x), mix(tF01.g, tF11.g, tF.x), tF.y) * 255.0 - 128.0;
    float cs = mix(mix(tF00.b, tF10.b, tF.x), mix(tF01.b, tF11.b, tF.x), tF.y) * 255.0 - 128.0;
    float st = (atan(sn, cs) / 6.2831853 + 0.5) * 16.0; // station mod 16 m
    float grain = tHash(floor(tW.xz * 2.0)) * 0.08;
    vec3 rc;
    if (tKind == 1) {
      // asphalt
      rc = vec3(0.034, 0.036, 0.043) * (0.92 + grain);
      float edge = tBand(tDist, tHalf - 0.55, 0.11);
      rc = mix(rc, vec3(0.62), edge * (tNeonF ? 0.0 : 1.0));
      if (tHalf >= 6.0) {
        float dash = step(st, 6.0) * tBand(tDist, 0.0, 0.11) * tClean;
        rc = mix(rc, tHalf >= 8.0 ? vec3(0.78, 0.55, 0.08) : vec3(0.62), dash);
      }
      if (tKerb) {
        float kb = 1.0 - smoothstep(tHalf - 0.95, tHalf - 0.9, tDist);
        kb = 1.0 - kb;
        float red = step(0.5, fract(st * 0.5));
        rc = mix(rc, mix(vec3(0.8), vec3(0.62, 0.03, 0.02), red), kb * tOnRoad * tClean);
      }
      if (tNeonF) {
        float neon = tBand(tDist, tHalf - 0.45, 0.13);
        rc = mix(rc, vec3(0.0, 0.55, 0.65), neon);
        tNeon = neon * tOnRoad;
      }
    } else if (tKind == 2) {
      // dirt: tile tint, darker ruts
      rc = vec3(0.30, 0.17, 0.08) * (0.9 + grain * 1.5);
      float rut = tBand(tDist, 1.15, 0.32) + tBand(tDist, 2.9, 0.32);
      rc *= 1.0 - 0.22 * clamp(rut, 0.0, 1.0);
    } else if (tKind == 3) {
      // cobble: 0.6 m stones, dark joints
      vec2 c = tW.xz / 0.6;
      vec2 cf = abs(fract(c) - 0.5);
      float joint = smoothstep(0.42, 0.48, max(cf.x, cf.y));
      rc = vec3(0.30, 0.27, 0.23) * (0.85 + tHash(floor(c)) * 0.3);
      rc *= 1.0 - 0.45 * joint;
    } else if (tKind == 4) {
      // rail bed: ballast, sleepers every 0.8 m, two rails
      rc = vec3(0.16, 0.14, 0.12) * (0.85 + grain * 2.0);
      float sl = step(fract(st / 0.8), 0.35) * (1.0 - smoothstep(1.25, 1.35, tDist));
      rc = mix(rc, vec3(0.20, 0.12, 0.06), sl);
      float rails = tBand(tDist, 0.72, 0.05);
      rc = mix(rc, vec3(0.55, 0.55, 0.58), rails);
    } else {
      // planks (pier)
      float pl = fract(st / 0.5);
      rc = vec3(0.32, 0.20, 0.10) * (0.85 + tHash(vec2(floor(st / 0.5), floor(tW.x))) * 0.25);
      rc *= 1.0 - 0.5 * smoothstep(0.9, 0.96, pl);
    }
    tCol = mix(tCol, rc, tOnRoad);
  }
}

// --- grout (off-road), strata (steep faces), underwater tint
vec2 tG4 = tW.xz * 0.25;
vec2 tGd = abs(fract(tG4 - 0.5) - 0.5) / max(fwidth(tG4), vec2(1e-4));
float tGrout = (1.0 - clamp(min(tGd.x, tGd.y), 0.0, 1.0)) * (1.0 - smoothstep(70.0, 120.0, tCam));
tCol *= 1.0 - 0.28 * tGrout * (1.0 - tOnRoad);
float tSteep = 1.0 - smoothstep(0.5, 0.6, tNy);
float tBandY = fract(tW.y);
tCol *= mix(1.0, (tBandY < 0.5 ? 0.86 : 1.0) * (1.0 - 0.25 * tBand(tBandY, 0.0, 0.04)), tSteep);
if (tDepth > 0.0) tCol = mix(tCol, vec3(0.03, 0.17, 0.21), clamp(tDepth * 0.2, 0.0, 0.75));
diffuseColor.rgb *= tCol;
`;

const EMISSIVE = /* glsl */ `
totalEmissiveRadiance += vec3(0.0, 0.85, 1.0) * (tNeon * 1.4);
`;

export function createTerrainMaterial(textures: { tile: Texture; field: Texture }): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTile = { value: textures.tile };
    shader.uniforms.uField = { value: textures.field };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_MAIN}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${EMISSIVE}`);
  };
  material.customProgramCacheKey = () => 'tessera-terrain-v3';
  return material;
}
