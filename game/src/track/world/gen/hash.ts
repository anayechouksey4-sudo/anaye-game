/**
 * FNV-1a over the world's bytes. Typed arrays are hashed word-wise (32-bit little-endian words,
 * then the tail bytes), which is fast and identical in Node and browsers. Two lanes with different
 * offsets give a 64-bit fingerprint (16 hex chars). Pure.
 */

export class Fnv {
  private a = 0x811c9dc5;
  private b = 0x050c5d1f;

  bytes(view: ArrayBufferView): this {
    const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const words = u8.byteLength >> 2;
    let a = this.a;
    let b = this.b;
    if ((u8.byteOffset & 3) === 0) {
      const u32 = new Uint32Array(u8.buffer, u8.byteOffset, words);
      for (let i = 0; i < words; i++) {
        const w = u32[i]!;
        a = Math.imul(a ^ w, 0x01000193);
        b = Math.imul(b ^ (w >>> 7) ^ (w << 25), 0x01000193);
      }
    } else {
      for (let i = 0; i < words; i++) {
        const o = i * 4;
        const w = (u8[o]! | (u8[o + 1]! << 8) | (u8[o + 2]! << 16) | (u8[o + 3]! << 24)) >>> 0;
        a = Math.imul(a ^ w, 0x01000193);
        b = Math.imul(b ^ (w >>> 7) ^ (w << 25), 0x01000193);
      }
    }
    for (let i = words * 4; i < u8.byteLength; i++) {
      a = Math.imul(a ^ u8[i]!, 0x01000193);
      b = Math.imul(b ^ u8[i]!, 0x01000193);
    }
    // length separator
    a = Math.imul(a ^ u8.byteLength, 0x01000193);
    b = Math.imul(b ^ (u8.byteLength * 31), 0x01000193);
    this.a = a;
    this.b = b;
    return this;
  }

  text(s: string): this {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ (c * 131), 0x01000193);
    }
    this.a = a;
    this.b = b;
    return this;
  }

  hex(): string {
    return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0');
  }
}

/** Stable JSON for hashing (numbers rounded to 1e-4 so float noise in derived values cannot leak in). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10000) / 10000 : String(v);
    if (ArrayBuffer.isView(v)) return `<${(v as ArrayBufferView).byteLength}B>`;
    return v;
  });
}
