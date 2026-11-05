/**
 * Text and atmosphere: gate labels (one atlas, one draw call), hazard signs, the big-jump lip
 * sign with a live speed-trap readout, GAMERFLEET billboards (one merged mesh) and floating
 * voxel debris in the void (one InstancedMesh, gently bobbing).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
} from 'three';
import { useGameStore } from '../../state/store';
import { BIG_JUMP, COLORS } from './config';
import type { ChaosTrackPlan, GateSpec, SignSpec } from './plan';
import { GLOW_HEX } from './scenery';
import { createSignCanvas } from './signTexture';
import { createVoxelMaterial, ensureInstanceAttributes } from './voxel';

type Quad = { center: [number, number, number]; yaw: number; width: number; height: number; uv: [number, number, number, number] };

/** Merge textured quads (u0, v0, u1, v1 per quad) into one geometry. Quads face −Z when yaw = π. */
function quadGeometry(quads: Quad[]): BufferGeometry {
  const pos = new Float32Array(quads.length * 12);
  const uv = new Float32Array(quads.length * 8);
  const idx = new Uint16Array(quads.length * 6);
  const v = new Vector3();
  quads.forEach((q, i) => {
    const c = Math.cos(q.yaw);
    const s = Math.sin(q.yaw);
    const corners: [number, number][] = [
      [-q.width / 2, -q.height / 2],
      [q.width / 2, -q.height / 2],
      [q.width / 2, q.height / 2],
      [-q.width / 2, q.height / 2],
    ];
    corners.forEach(([lx, ly], k) => {
      // Local plane faces +Z; rotate about Y by yaw.
      v.set(q.center[0] + lx * c, q.center[1] + ly, q.center[2] - lx * s);
      pos.set([v.x, v.y, v.z], (i * 4 + k) * 3);
    });
    const [u0, v0, u1, v1] = q.uv;
    uv.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setIndex(new BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function gateText(g: GateSpec): string {
  if (g.kind === 'checkpoint') return `CP ${g.index} · ${g.label}`;
  return g.label;
}

/** All gate beam labels share one canvas atlas (one row per gate) → a single draw call. */
function GateLabels({ gates }: { gates: GateSpec[] }) {
  const { geometry, material } = useMemo(() => {
    const rows = Math.max(1, gates.length);
    const rowH = 72;
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = rows * rowH;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#07080d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      gates.forEach((g, i) => {
        const color = GLOW_HEX[g.color];
        const text = gateText(g);
        let size = rowH * 0.62;
        ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
        const w = ctx.measureText(text).width;
        if (w > canvas.width * 0.92) {
          size *= (canvas.width * 0.92) / w;
          ctx.font = `900 ${size}px "Arial Black", Arial, sans-serif`;
        }
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, rowH * (i + 0.5));
      });
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const quads: Quad[] = gates.map((g, i) => ({
      center: [g.position[0], g.position[1] + g.height, g.position[2] - 0.48],
      yaw: Math.PI,
      width: g.width + 1.6,
      height: 1.0,
      uv: [0, 1 - (i + 1) / rows, 1, 1 - i / rows],
    }));
    return { geometry: quadGeometry(quads), material: new MeshBasicMaterial({ map: texture, toneMapped: false }) };
  }, [gates]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return <mesh geometry={geometry} material={material} frustumCulled={false} />;
}

function Sign({ sign }: { sign: SignSpec }) {
  const accent = GLOW_HEX[sign.color];
  const canvas = useMemo(() => createSignCanvas(sign.width, sign.height, { accent }), [sign, accent]);
  const material = useMemo(() => new MeshBasicMaterial({ map: canvas.texture, toneMapped: false, side: DoubleSide }), [canvas]);
  useEffect(() => {
    if (sign.live !== 'speedTrap') {
      canvas.draw(sign.lines);
      return;
    }
    const render = (kmh: number | null) => {
      const ok = kmh !== null && kmh >= BIG_JUMP.REQUIRED_KMH;
      const trap = kmh === null ? 'LAST TRAP  ---' : `LAST TRAP  ${kmh.toFixed(1)} KM/H`;
      canvas.draw([...sign.lines, trap], { line: sign.lines.length, color: kmh === null ? '#9aa4b8' : ok ? COLORS.green : COLORS.magenta });
    };
    render(useGameStore.getState().run.speedTrapKmh);
    return useGameStore.subscribe((s, prev) => {
      if (s.run.speedTrapKmh !== prev.run.speedTrapKmh) render(s.run.speedTrapKmh);
    });
  }, [canvas, sign]);
  useEffect(
    () => () => {
      canvas.dispose();
      material.dispose();
    },
    [canvas, material],
  );
  return (
    <mesh position={sign.position} rotation={[0, sign.yaw, 0]} material={material}>
      <planeGeometry args={[sign.width, sign.height]} />
    </mesh>
  );
}

function Billboards({ plan }: { plan: ChaosTrackPlan }) {
  const { geometry, material } = useMemo(() => {
    const sign = createSignCanvas(22, 5.5, { accent: COLORS.cyan, pxPerM: 48 });
    sign.draw(['GAMERFLEET']);
    const quads: Quad[] = plan.billboards.map((b) => ({ center: b.position, yaw: b.yaw, width: b.width, height: b.height, uv: [0, 0, 1, 1] }));
    return { geometry: quadGeometry(quads), material: new MeshBasicMaterial({ map: sign.texture, toneMapped: false, side: DoubleSide }) };
  }, [plan]);
  useEffect(
    () => () => {
      geometry.dispose();
      material.map?.dispose();
      material.dispose();
    },
    [geometry, material],
  );
  return plan.billboards.length > 0 ? <mesh geometry={geometry} material={material} frustumCulled={false} /> : null;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _e = new Euler();
const _p = new Vector3();
const _s = new Vector3();
const _c = new Color();

function Debris({ plan }: { plan: ChaosTrackPlan }) {
  const ref = useRef<InstancedMesh>(null);
  const material = useMemo(() => createVoxelMaterial({ instanced: true, roughness: 0.8 }), []);
  useEffect(() => () => material.dispose(), [material]);
  const debris = plan.debris;

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const glow = ensureInstanceAttributes(mesh);
    debris.forEach((d, i) => {
      mesh.setColorAt(i, _c.set(d.color));
      glow.setX(i, d.glow);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    glow.needsUpdate = true;
  }, [debris]);

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < debris.length; i++) {
      const d = debris[i]!;
      const a = t * d.speed + d.phase;
      _q.setFromEuler(_e.set(d.rotation[0] + a * 0.3, d.rotation[1] + a * 0.5, d.rotation[2]));
      _m.compose(_p.set(d.position[0], d.position[1] + Math.sin(a) * d.bob, d.position[2]), _q, _s.set(d.size, d.size, d.size));
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, material, debris.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  );
}

export function Decor({ plan }: { plan: ChaosTrackPlan }) {
  return (
    <group name="chaos-decor">
      <GateLabels gates={plan.gates} />
      {plan.signs.map((s) => (
        <Sign key={s.id} sign={s} />
      ))}
      <Billboards plan={plan} />
      <Debris plan={plan} />
    </group>
  );
}
