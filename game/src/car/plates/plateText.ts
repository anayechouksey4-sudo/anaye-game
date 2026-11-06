/**
 * Number-plate text rules (pure: no DOM, no three.js, so the game, the lab page and the tests
 * share them). A plate is cosmetic — it never touches physics, best-time keys or medals.
 *
 * `normalizePlate` turns whatever the player typed (or a `?plate=` URL value, or an old save)
 * into the text that is drawn:
 *   - letters are upper-cased (`uk 07 dw` → `UK 07 DW`);
 *   - separators `- _ . / ·` become spaces (`UK-07-DW` → `UK 07 DW`);
 *   - anything that is not A–Z, 0–9 or a space is dropped (emoji, accents, punctuation);
 *   - runs of spaces collapse to one, leading / trailing spaces go;
 *   - at most PLATE_MAX_LENGTH characters (`UK 07 DW 2400` is 13), cut on the right, then
 *     trimmed again so a cut never leaves a trailing space;
 *   - an empty result means "use the car's default plate" (catalog `defaultPlate`).
 * No profanity filter: the plate renders on the player's own phone.
 */
export const PLATE_MAX_LENGTH = 14;

const SEPARATORS = /[-_./·]+/g;
const NOT_PLATE = /[^A-Z0-9 ]+/g;

export function normalizePlate(text: unknown): string {
  if (typeof text !== 'string') return '';
  return text
    .toUpperCase()
    .replace(SEPARATORS, ' ')
    .replace(NOT_PLATE, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, PLATE_MAX_LENGTH)
    .trim();
}

/** True when `text` is already in normalized form (what the editor shows as valid). */
export function isNormalizedPlate(text: string): boolean {
  return normalizePlate(text) === text;
}

const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ'; // no I / O / Q: they read as 1 / 0 on a 5×7 font
const DIGITS = '0123456789';

/** Deterministic 0…1 generator for `randomPlate` (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh plate in the game's own pattern, two letters, two digits, three letters (`KX 42 PGD`):
 * 9 characters, always valid. `seed` makes it reproducible (tests); unseeded = Math.random.
 */
export function randomPlate(seed?: number): string {
  const next = seed === undefined ? Math.random : rng(seed);
  const pick = (alphabet: string, n: number) => {
    let out = '';
    for (let i = 0; i < n; i++) out += alphabet[Math.floor(next() * alphabet.length)]!;
    return out;
  };
  return `${pick(LETTERS, 2)} ${pick(DIGITS, 2)} ${pick(LETTERS, 3)}`;
}
