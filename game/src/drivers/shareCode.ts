/**
 * Driver share code `DRV1-…` (≈ 20–45 characters): the avatar's twelve fields bit-packed, the
 * signature colour as 3 bytes, the name as length-prefixed UTF-8, CRC-8 sealed (drivers/codec.ts).
 * Paste a friend's code into the DRIVERS tab to get their look; the name stays editable.
 */
import { BEARDS, EYES, EYE_COLORS, GLASSES, HAIR_COLORS, HAIR_STYLES, HELMETS, MARKS, MOUTHS, SKIN_TONES, VISORS, sanitizeAvatar, type AvatarConfig } from './avatar';
import { BitReader, BitWriter, bytesToHex, entryAt, getText, hexToBytes, indexOf, openCode, putText, sealCode } from './codec';
import { NAME_MAX, sanitizeHex, sanitizeName } from './sanitize';

export const DRIVER_CODE_PREFIX = 'DRV1';
const VERSION = 1;

export interface DriverShare {
  name: string;
  avatar: AvatarConfig;
}

export function encodeDriver(d: DriverShare): string {
  const a = sanitizeAvatar(d.avatar);
  const w = new BitWriter();
  w.put(VERSION, 4);
  w.put(a.skin, 3);
  w.put(indexOf(HAIR_STYLES, a.hair), 4);
  w.put(a.hairColor, 3);
  w.put(indexOf(HELMETS, a.helmet), 3);
  w.put(indexOf(VISORS, a.visor), 3);
  w.put(indexOf(EYES, a.eyes), 3);
  w.put(a.eyeColor, 3);
  w.put(indexOf(MOUTHS, a.mouth), 3);
  w.put(indexOf(GLASSES, a.glasses), 2);
  w.put(indexOf(BEARDS, a.beard), 2);
  w.put(indexOf(MARKS, a.mark), 3);
  w.putBytes(hexToBytes(sanitizeHex(a.color, '#00F0FF')));
  putText(w, sanitizeName(d.name), NAME_MAX * 4);
  return sealCode(DRIVER_CODE_PREFIX, w.finish());
}

/** The driver a code describes (fields range-checked and sanitised), or null for a corrupt code. */
export function decodeDriver(code: unknown): DriverShare | null {
  const body = openCode(DRIVER_CODE_PREFIX, code, 160);
  if (!body) return null;
  try {
    const r = new BitReader(body);
    if (r.get(4) !== VERSION) return null;
    const raw = {
      skin: r.get(3) % SKIN_TONES.length,
      hair: entryAt(HAIR_STYLES, r.get(4)),
      hairColor: r.get(3) % HAIR_COLORS.length,
      helmet: entryAt(HELMETS, r.get(3)),
      visor: entryAt(VISORS, r.get(3)),
      eyes: entryAt(EYES, r.get(3)),
      eyeColor: r.get(3) % EYE_COLORS.length,
      mouth: entryAt(MOUTHS, r.get(3)),
      glasses: entryAt(GLASSES, r.get(2)),
      beard: entryAt(BEARDS, r.get(2)),
      mark: entryAt(MARKS, r.get(3)),
      color: bytesToHex(r.getBytes(3)),
    };
    const name = sanitizeName(getText(r));
    return { name, avatar: sanitizeAvatar(raw) };
  } catch {
    return null;
  }
}

/** Which kind of share code a pasted string is (by prefix), before decoding it. */
export function shareCodeKind(text: unknown): 'driver' | 'ride' | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toUpperCase();
  if (t.startsWith('DRV1-')) return 'driver';
  if (t.startsWith('RIDE1-')) return 'ride';
  return null;
}
