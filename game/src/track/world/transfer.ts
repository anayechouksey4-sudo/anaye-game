/** Every distinct ArrayBuffer inside a WorldData (for postMessage transfer). Pure. */
import type { WorldData } from './gen/types';

export function worldTransferables(world: WorldData): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>();
  const add = (a: ArrayBufferView) => {
    const b = a.buffer;
    if (b instanceof ArrayBuffer && b.byteLength > 0) seen.add(b);
  };
  for (const a of [world.heights, world.hf, world.tileTex, world.fieldTex, world.surface, world.region, world.cliff, world.minimap]) add(a);
  for (const d of world.districts) {
    for (const m of [d.near, d.far]) if (m) for (const a of [m.position, m.normal, m.color, m.glow, m.index]) add(a);
    if (d.collider) {
      add(d.collider.vertices);
      add(d.collider.indices);
    }
  }
  for (const r of world.roads) for (const a of [r.points, r.base, r.tangents, r.flags]) add(a);
  for (const e of world.events) {
    add(e.route);
    add(e.speeds);
  }
  return [...seen];
}
