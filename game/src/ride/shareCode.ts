/**
 * Ride share code `RIDE1-…` (≈ 30–60 characters): base class, options, four colours, stance, plate
 * and name, CRC-8 sealed (drivers/codec.ts). A friend pastes it into MY RIDE and gets the same car.
 * A code made with a class this build doesn't know decodes to the default base (`known: false`).
 */
import { CAR_CLASS_IDS } from '@shared/protocol';
import { BitReader, BitWriter, bytesToHex, entryAt, getText, hexToBytes, indexOf, openCode, putText, sealCode } from '../drivers/codec';
import { NAME_MAX, PLATE_MAX, sanitizeHex, sanitizeName, sanitizePlate } from '../drivers/sanitize';
import { DEFAULT_RIDE, EXHAUSTS, SPOILERS, STANCE_MIN, STANCE_STEP, TRIMS, WHEEL_STYLES, sanitizeRide, type RideConfig } from './config';

export const RIDE_CODE_PREFIX = 'RIDE1';
const VERSION = 1;
/** Base classes are written by name, so a code survives a reordered CAR_CLASS_IDS (the name is 1 byte per character; ids are short). */
const BASE_MAX_BYTES = 16;

export function encodeRide(input: RideConfig): string {
  const c = sanitizeRide(input);
  const w = new BitWriter();
  w.put(VERSION, 4);
  putText(w, c.base, BASE_MAX_BYTES);
  w.put(indexOf(TRIMS, c.trim), 3);
  w.put(indexOf(WHEEL_STYLES, c.wheel), 3);
  w.put(indexOf(SPOILERS, c.spoiler), 3);
  w.put(indexOf(EXHAUSTS, c.exhaust), 3);
  w.put(Math.round((c.stance - STANCE_MIN) / STANCE_STEP), 4);
  for (const h of [c.paint, c.paint2, c.accent, c.wheelColor]) w.putBytes(hexToBytes(sanitizeHex(h, '#FFFFFF')));
  putText(w, sanitizePlate(c.plate), PLATE_MAX);
  putText(w, sanitizeName(c.name, NAME_MAX), NAME_MAX * 4);
  return sealCode(RIDE_CODE_PREFIX, w.finish());
}

export interface RideDecode {
  ride: RideConfig;
  /** False when the code's base class isn't in this build (the ride then uses the default base). */
  known: boolean;
  /** The base id the code named. */
  baseId: string;
}

/** The ride a code describes (sanitised), or null for a corrupt code. */
export function decodeRide(code: unknown): RideDecode | null {
  const body = openCode(RIDE_CODE_PREFIX, code, 200);
  if (!body) return null;
  try {
    const r = new BitReader(body);
    if (r.get(4) !== VERSION) return null;
    const baseId = getText(r);
    const known = (CAR_CLASS_IDS as readonly string[]).includes(baseId);
    const raw = {
      base: known ? baseId : DEFAULT_RIDE.base,
      trim: entryAt(TRIMS, r.get(3)),
      wheel: entryAt(WHEEL_STYLES, r.get(3)),
      spoiler: entryAt(SPOILERS, r.get(3)),
      exhaust: entryAt(EXHAUSTS, r.get(3)),
      stance: STANCE_MIN + r.get(4) * STANCE_STEP,
      paint: bytesToHex(r.getBytes(3)),
      paint2: bytesToHex(r.getBytes(3)),
      accent: bytesToHex(r.getBytes(3)),
      wheelColor: bytesToHex(r.getBytes(3)),
      plate: getText(r),
      name: getText(r),
    };
    return { ride: sanitizeRide(raw), known, baseId };
  } catch {
    return null;
  }
}
