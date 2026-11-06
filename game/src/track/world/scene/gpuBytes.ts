/**
 * Upper-bound GPU memory estimate for the island (PLAN §4.13 "GPU estimate ≤ 25 MB"): every vertex
 * / index buffer the island creates (shared buffers counted once) and every texture with its mip
 * chain. Buffers are only uploaded when first drawn, so the resident figure is at most this.
 */
import type { BufferGeometry, Texture } from 'three';

export function geometryBytes(geometries: readonly BufferGeometry[]): number {
  const seen = new Set<ArrayBufferLike>();
  let bytes = 0;
  const add = (a: { array: ArrayLike<number> & { buffer: ArrayBufferLike; byteLength: number } } | null | undefined) => {
    if (!a || seen.has(a.array.buffer)) return;
    seen.add(a.array.buffer);
    bytes += a.array.byteLength;
  };
  for (const g of geometries) {
    for (const name of Object.keys(g.attributes)) add(g.attributes[name] as never);
    add(g.index as never);
  }
  return bytes;
}

export function textureBytes(t: Texture): number {
  const img = t.image as { width?: number; height?: number } | undefined;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  return Math.round(w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1));
}
