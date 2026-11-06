/**
 * Text rules for everything a player types in the DRIVERS and MY RIDE tabs (names, plate text,
 * colours). Pure, dependency-free, shared by the game, its node tests and the share codes.
 *
 * A name keeps letters in any script (a kid may type Devanagari or an emoji), loses control and
 * format characters (bidi overrides, zero-width joiners), markup characters and runs of spaces, and
 * is cut to NAME_MAX code points (not UTF-16 units, so a 14-emoji name is 14 characters).
 * Names are only ever rendered as React text nodes, never as HTML.
 */

/** Longest driver name / car name (code points): fits a 56 px menu row at 360 px wide. */
export const NAME_MAX = 14;
/** Longest number plate text (A–Z 0–9 space -). "UK 07 DW 2400" is 13. */
export const PLATE_MAX = 14;

// Controls, format (bidi, zero-width), surrogates, private use and unassigned code points.
const BAD = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/gu;
const MARKUP = /[<>&"'`\\]/g;
const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeName(input: unknown, max: number = NAME_MAX): string {
  if (typeof input !== 'string') return '';
  const s = input.normalize('NFKC').replace(BAD, '').replace(MARKUP, '').replace(/\s+/g, ' ').trim();
  return [...s].slice(0, max).join('').trim();
}

/**
 * Plate alphabet (the same rules as the plate system's normalizePlate): upper-case A–Z, digits and
 * single spaces; `- _ . /` become spaces, everything else is dropped; ≤ PLATE_MAX characters.
 */
export function sanitizePlate(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[-_./·]+/g, ' ')
    .replace(/[^A-Z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLATE_MAX)
    .trim();
}

/** `#RRGGBB` (upper-case) or `fallback`. */
export function sanitizeHex(input: unknown, fallback: string): string {
  return typeof input === 'string' && HEX.test(input) ? input.toUpperCase() : fallback;
}

/** One of `list`, or `fallback` (the list's first entry when not given). */
export function pickOf<T extends readonly string[]>(list: T, value: unknown, fallback: T[number] = list[0] as T[number]): T[number] {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T[number]) : fallback;
}

/** An integer index into a list of `length`, or `fallback`. */
export function pickIndex(length: number, value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < length ? value : fallback;
}
