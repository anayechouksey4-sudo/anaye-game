/**
 * The island's one additive program (PLAN §4.13: terrain, water, additive). Everything that glows
 * on top of the scene uses it: sign text, holo arrows, chevrons, event-pad rings and the fog-free
 * beacons. One ShaderMaterial, one texture atlas (scene/eventAtlas.ts), vertex colours in display
 * (sRGB) values, premultiplied by the texel alpha, additive, no depth write.
 *
 * Per-vertex `fx`: x = fade-out distance in metres (< 0: fade-in distance, the beacons), y = pulse phase
 * in radians (< -100 = steady). The pulse is a travelling brightness wave (holo arrows).
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, DoubleSide, ShaderMaterial, Sphere, Vector3, type Texture } from 'three';

const VERT = /* glsl */ `
attribute vec3 color;
attribute vec2 fx;
uniform float uTime;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = length(mv.xyz);
  // fx.x > 0: fade out by that distance (signs, arrows); < 0: fade in up to -fx.x (beacons vanish
  // when you stand on them, so they never wall off the view); 0: always on
  float fade = fx.x > 0.0 ? 1.0 - smoothstep(0.55 * fx.x, fx.x, dist) : (fx.x < 0.0 ? smoothstep(-0.25 * fx.x, -fx.x, dist) : 1.0);
  float pulse = fx.y < -100.0 ? 1.0 : 0.72 + 0.38 * sin(uTime * 5.0 + fx.y);
  vUv = uv;
  vColor = color * fade * pulse;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uGain;
varying vec2 vUv;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  vec3 c = t.rgb * t.a * vColor * uGain;
  if (c.r + c.g + c.b < 0.003) discard;
  gl_FragColor = vec4(c, 1.0);
}
`;

export function createGlowMaterial(atlas: Texture): ShaderMaterial {
  const m = new ShaderMaterial({
    uniforms: { uMap: { value: atlas }, uTime: { value: 0 }, uGain: { value: 1 } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    toneMapped: false,
  });
  m.name = 'tessera-glow';
  return m;
}

export type UvRect = readonly [number, number, number, number];
type P3 = readonly [number, number, number];

/** Accumulates glow quads (position, uv, colour, fx) and emits one indexed geometry. */
export class GlowBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private fx: number[] = [];
  private idx: number[] = [];

  get quads(): number {
    return this.pos.length / 12;
  }

  /** Corners in order bottom-left, bottom-right, top-right, top-left (uv u0 v0 → u1 v1). */
  quad(a: P3, b: P3, c: P3, d: P3, uv: UvRect, rgb: P3, fadeM: number, pulse = -1000, mirrorU = false): void {
    const base = this.pos.length / 3;
    const [u0, v0, u1, v1] = uv;
    const ul = mirrorU ? u1 : u0;
    const ur = mirrorU ? u0 : u1;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    this.uv.push(ul, v0, ur, v0, ur, v1, ul, v1);
    for (let k = 0; k < 4; k++) {
      this.col.push(rgb[0], rgb[1], rgb[2]);
      this.fx.push(fadeM, pulse);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** An upright quad centred at c, facing yaw (normal (sin yaw, 0, cos yaw)); u runs to the viewer's right. */
  upright(c: P3, yaw: number, w: number, h: number, uv: UvRect, rgb: P3, fadeM: number, mirrorU = false): void {
    const rx = Math.cos(yaw) * (w / 2);
    const rz = -Math.sin(yaw) * (w / 2);
    const y0 = c[1] - h / 2;
    const y1 = c[1] + h / 2;
    this.quad([c[0] - rx, y0, c[2] - rz], [c[0] + rx, y0, c[2] + rz], [c[0] + rx, y1, c[2] + rz], [c[0] - rx, y1, c[2] - rz], uv, rgb, fadeM, -1000, mirrorU);
  }

  build(): BufferGeometry | null {
    if (this.idx.length === 0) return null;
    const g = new BufferGeometry();
    const n = this.pos.length / 3;
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('fx', new BufferAttribute(new Float32Array(this.fx), 2));
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx), 1));
    g.computeBoundingBox();
    g.boundingSphere = g.boundingBox ? g.boundingBox.getBoundingSphere(new Sphere()) : new Sphere(new Vector3(), 1e4);
    return g;
  }
}

/** '#rrggbb' → display-space [r, g, b] in 0..1 (the glow program writes display values). */
export function hexRgb(hex: string, gain = 1): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(((v >> 16) & 255) / 255) * gain, (((v >> 8) & 255) / 255) * gain, ((v & 255) / 255) * gain];
}
