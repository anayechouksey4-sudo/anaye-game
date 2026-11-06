/**
 * Links the island's shader programs one per frame while the world builds, so the first drawn
 * frame does not stall on all of them at once (no KHR_parallel_shader_compile on many drivers:
 * the link blocks on first use). Each material is compiled against the real scene (lights, fog,
 * shadows) on a dummy mesh with the same object flags as the real meshes, then its uniforms are
 * fetched, which forces the link inside this frame. `onDone` fires after the last one.
 * Optional CPU `tasks` (e.g. drawing the sign atlas) run first, time-sliced (≈ 6 ms per frame).
 */
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Mesh, type Material, type Texture } from 'three';
import { worldEngine } from '../engine';

export interface WarmupItem {
  material: Material;
  receiveShadow: boolean;
}

const TASK_SLICE_MS = 6;
const NO_TASKS: readonly (() => void)[] = [];

export function ShaderWarmup({ items, textures, tasks = NO_TASKS, onDone }: { items: readonly WarmupItem[]; textures: readonly Texture[]; tasks?: readonly (() => void)[]; onDone: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const st = useRef({ task: 0, next: 0, done: false });
  const done = useRef(onDone);
  done.current = onDone;
  const geometry = useRef<BufferGeometry | null>(null);

  useEffect(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1e4, 0, 1, -1e4, 0, 0, -1e4, 1]), 3));
    geometry.current = g;
    st.current = { task: 0, next: 0, done: false };
    worldEngine.warmupMs = [];
    worldEngine.warmupWhat = [];
    return () => {
      g.dispose();
      geometry.current = null;
    };
  }, [items, textures, tasks]);

  useFrame(() => {
    const s = st.current;
    if (s.done || !geometry.current) return;
    const t0 = performance.now();
    if (s.task < tasks.length) {
      do tasks[s.task++]!();
      while (s.task < tasks.length && performance.now() - t0 < TASK_SLICE_MS);
      worldEngine.warmupMs.push(Math.round(performance.now() - t0));
      worldEngine.warmupWhat.push(`tasks:${s.task}`);
      return;
    }
    if (s.next < textures.length) {
      // texture uploads (and mipmaps) first, one per frame
      gl.initTexture(textures[s.next]!);
      worldEngine.warmupMs.push(Math.round(performance.now() - t0));
      worldEngine.warmupWhat.push(`texture:${textures[s.next]!.name || s.next}`);
      s.next++;
      return;
    }
    const item = items[s.next - textures.length];
    if (!item) {
      s.done = true;
      done.current();
      return;
    }
    const mesh = new Mesh(geometry.current, item.material);
    mesh.receiveShadow = item.receiveShadow;
    gl.compile(mesh, camera, scene);
    const program = (gl.properties.get(item.material) as { currentProgram?: { getUniforms(): unknown } }).currentProgram;
    program?.getUniforms();
    worldEngine.warmupMs.push(Math.round(performance.now() - t0));
    worldEngine.warmupWhat.push(`program:${item.material.name || item.material.type}`);
    s.next++;
  });

  return null;
}
