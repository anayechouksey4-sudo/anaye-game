/**
 * Bit packing for the share codes (drivers/shareCode.ts, ride/shareCode.ts): a BitWriter /
 * BitReader, CRC-8 and base64url without padding. Browser and node (no Buffer).
 *
 * Code layout: `PREFIX-` + base64url(body ‖ crc8(body)). A reader rejects a code whose CRC does not
 * match, whose version nibble is unknown or that runs short; a flipped character that happens to
 * pass the CRC still decodes to a valid, sanitised config (every field is range-checked).
 */

export class BitWriter {
  private readonly bytes: number[] = [];
  private acc = 0;
  private n = 0;

  put(value: number, bits: number): void {
    for (let b = bits - 1; b >= 0; b--) {
      this.acc = (this.acc << 1) | ((value >>> b) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }

  putBytes(arr: Uint8Array): void {
    for (const x of arr) this.put(x, 8);
  }

  finish(): Uint8Array {
    if (this.n) this.put(0, 8 - this.n);
    return Uint8Array.from(this.bytes);
  }
}

export class BitReader {
  private pos = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get(bits: number): number {
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const byte = this.bytes[this.pos >> 3];
      if (byte === undefined) throw new Error('short code');
      v = (v << 1) | ((byte >> (7 - (this.pos & 7))) & 1);
      this.pos++;
    }
    return v >>> 0;
  }

  getBytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.get(8);
    return out;
  }
}

export function crc8(b: Uint8Array): number {
  let c = 0;
  for (const x of b) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (b !== undefined) out += ALPHABET[(n >> 6) & 63]!;
    if (c !== undefined) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Inverse of toBase64Url; null for a character outside the alphabet or an impossible length. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of text) {
    const v = LOOKUP.get(ch);
    if (v === undefined) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Length-prefixed UTF-8 (6-bit length, so ≤ 63 bytes), cut at a code-point boundary to fit. */
export function putText(w: BitWriter, text: string, maxBytes: number): void {
  let s = text;
  let u = encoder.encode(s);
  while (u.length > Math.min(63, maxBytes)) {
    s = [...s].slice(0, -1).join('');
    u = encoder.encode(s);
  }
  w.put(u.length, 6);
  w.putBytes(u);
}

/** The text putText wrote, or '' for invalid UTF-8. */
export function getText(r: BitReader): string {
  const n = r.get(6);
  const u = r.getBytes(n);
  try {
    return decoder.decode(u);
  } catch {
    return '';
  }
}

/** `PREFIX-` + base64url(body ‖ crc). */
export function sealCode(prefix: string, body: Uint8Array): string {
  const all = new Uint8Array(body.length + 1);
  all.set(body);
  all[body.length] = crc8(body);
  return `${prefix}-${toBase64Url(all)}`;
}

/** The body of a sealed code (prefix, alphabet, length and CRC checked), or null. */
export function openCode(prefix: string, code: unknown, maxChars = 200): Uint8Array | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim();
  const head = `${prefix}-`;
  if (trimmed.length > maxChars + head.length || !trimmed.toUpperCase().startsWith(head)) return null;
  const tail = trimmed.slice(head.length);
  if (!/^[A-Za-z0-9_-]{4,}$/.test(tail)) return null;
  const all = fromBase64Url(tail);
  if (!all || all.length < 2) return null;
  const body = all.subarray(0, all.length - 1);
  return crc8(body) === all[all.length - 1] ? body : null;
}

/** `#RRGGBB` → 3 bytes (caller sanitises first). */
export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
}

export function bytesToHex(b: Uint8Array): string {
  return '#' + [...b].map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join('');
}

/** Index of `value` in `list` (0 when absent). */
export function indexOf<T extends readonly string[]>(list: T, value: string): number {
  return Math.max(0, list.indexOf(value));
}

/** `list[i]`, or its first entry for an out-of-range index. */
export function entryAt<T extends readonly string[]>(list: T, i: number): T[number] {
  return (list[i] ?? list[0]) as T[number];
}
