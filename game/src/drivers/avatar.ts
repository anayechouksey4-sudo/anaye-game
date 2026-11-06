/**
 * The driver avatar model: a face is a handful of palette indices and feature presets. The same
 * `AvatarConfig` drives the 2D portrait (portrait.ts) and the in-car bust (bust.ts), so the two
 * always agree. There is no image input anywhere: a look-alike of a friend is built from blocks.
 *
 * Everything here is original and generic by construction (1–3-block features, 8 skin swatches,
 * 9 hair styles…); the five default drivers are invented characters in the game's neon style.
 * Slot 1 carries the owner's first name; every name is editable in the DRIVERS tab.
 */
import { pickIndex, pickOf, sanitizeHex, sanitizeName } from './sanitize';

export const SKIN_TONES = ['#F6DCC8', '#EBC3A3', '#D9A47C', '#C0845A', '#9E6240', '#7A4A2E', '#5B3620', '#3E2416'] as const;
export const HAIR_COLORS = ['#141216', '#3A261C', '#7A4A2E', '#C98A4B', '#E8D9A0', '#D23A3A', '#39FF14', '#00F0FF'] as const;
export const EYE_COLORS = ['#2A1F1A', '#4A3B2F', '#2E6F3E', '#2F5FB8', '#8A8F9A', '#FF2A6D'] as const;
/** Signature colours offered by the builder (any #RRGGBB is accepted). */
export const SIGNATURE_COLORS = ['#FF3D9A', '#00F0FF', '#F5E663', '#39FF14', '#FF9A1F', '#9B5CFF', '#FF2A2A', '#2EF2C8', '#F4F7FB', '#4D7CFF'] as const;

export const HAIR_STYLES = ['none', 'buzz', 'crop', 'quiff', 'curls', 'bun', 'long', 'mohawk', 'braid'] as const;
export const HELMETS = ['none', 'open', 'full', 'cap', 'beanie', 'band'] as const;
export const VISORS = ['none', 'clear', 'cyan', 'magenta', 'gold'] as const;
export const EYES = ['dot', 'wide', 'sleepy', 'wink', 'star'] as const;
export const MOUTHS = ['grin', 'smirk', 'flat', 'open', 'tongue'] as const;
export const GLASSES = ['none', 'round', 'square', 'shades'] as const;
export const BEARDS = ['none', 'stubble', 'full', 'goatee'] as const;
export const MARKS = ['none', 'freckles', 'stripe', 'scar', 'dots'] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Helmet = (typeof HELMETS)[number];
export type Visor = (typeof VISORS)[number];
export type Eyes = (typeof EYES)[number];
export type Mouth = (typeof MOUTHS)[number];
export type Glasses = (typeof GLASSES)[number];
export type Beard = (typeof BEARDS)[number];
export type Mark = (typeof MARKS)[number];

export interface AvatarConfig {
  /** Index into SKIN_TONES. */
  skin: number;
  hair: HairStyle;
  /** Index into HAIR_COLORS. */
  hairColor: number;
  helmet: Helmet;
  /** Signature colour (helmet, suit accent, chip colour), `#RRGGBB`. */
  color: string;
  visor: Visor;
  eyes: Eyes;
  /** Index into EYE_COLORS. */
  eyeColor: number;
  mouth: Mouth;
  glasses: Glasses;
  beard: Beard;
  mark: Mark;
}

export interface DriverProfile {
  /** Stable slot id (`d1`…`d5`). */
  id: string;
  name: string;
  /** Slot 1: the garage owner (a tag on the row; no gameplay effect). */
  owner: boolean;
  /** One line for the row. */
  bio: string;
  /** Start-line banner text, upper case. */
  taunt: string;
  avatar: AvatarConfig;
}

export const DRIVER_COUNT = 5;

export const DEFAULT_AVATAR: Readonly<AvatarConfig> = Object.freeze({
  skin: 3,
  hair: 'crop',
  hairColor: 0,
  helmet: 'none',
  color: '#00F0FF',
  visor: 'none',
  eyes: 'dot',
  eyeColor: 0,
  mouth: 'grin',
  glasses: 'none',
  beard: 'none',
  mark: 'none',
});

/** Five invented defaults. Slot 1 is the owner's first name; the rest are nicknames in the game's neon style. */
export const DEFAULT_DRIVERS: readonly DriverProfile[] = [
  {
    id: 'd1',
    name: 'Anaye',
    owner: true,
    bio: 'Owner of the garage. Drives everything flat out.',
    taunt: 'LIGHTS OUT. SEE YOU AT THE LINE.',
    avatar: { skin: 3, hair: 'quiff', hairColor: 0, helmet: 'open', color: '#FF3D9A', visor: 'none', eyes: 'wide', eyeColor: 0, mouth: 'grin', glasses: 'none', beard: 'none', mark: 'none' },
  },
  {
    id: 'd2',
    name: 'Volt',
    owner: false,
    bio: 'Electric-grid kid. Hums at idle, screams at redline.',
    taunt: 'CHARGED UP. TRY TO KEEP UP.',
    avatar: { skin: 1, hair: 'mohawk', hairColor: 7, helmet: 'none', color: '#00F0FF', visor: 'none', eyes: 'dot', eyeColor: 3, mouth: 'smirk', glasses: 'shades', beard: 'none', mark: 'stripe' },
  },
  {
    id: 'd3',
    name: 'Pixel Rae',
    owner: false,
    bio: 'Counts the voxels on every corner. Never lifts.',
    taunt: 'CORNER 1 IS MINE.',
    avatar: { skin: 5, hair: 'curls', hairColor: 1, helmet: 'band', color: '#F5E663', visor: 'none', eyes: 'star', eyeColor: 2, mouth: 'open', glasses: 'round', beard: 'none', mark: 'freckles' },
  },
  {
    id: 'd4',
    name: 'Mx. Glitch',
    owner: false,
    bio: 'Half signal, half noise. Drifts before the braking zone.',
    taunt: 'ERROR 404: YOUR LEAD NOT FOUND.',
    avatar: { skin: 0, hair: 'none', hairColor: 0, helmet: 'full', color: '#39FF14', visor: 'magenta', eyes: 'sleepy', eyeColor: 4, mouth: 'flat', glasses: 'none', beard: 'none', mark: 'none' },
  },
  {
    id: 'd5',
    name: 'Tarmac Tej',
    owner: false,
    bio: 'Old-school. Big engine, bigger grin, no telemetry.',
    taunt: 'HOLD GAS. THAT IS THE PLAN.',
    avatar: { skin: 6, hair: 'buzz', hairColor: 0, helmet: 'cap', color: '#FF9A1F', visor: 'none', eyes: 'wink', eyeColor: 0, mouth: 'tongue', glasses: 'none', beard: 'full', mark: 'scar' },
  },
];

/** A valid avatar from anything (saved JSON, a share code, a URL): invalid fields fall back one by one to `base`. */
export function sanitizeAvatar(input: unknown, base: Readonly<AvatarConfig> = DEFAULT_AVATAR): AvatarConfig {
  const a = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof AvatarConfig, unknown>>;
  return {
    skin: pickIndex(SKIN_TONES.length, a.skin, base.skin),
    hair: pickOf(HAIR_STYLES, a.hair, base.hair),
    hairColor: pickIndex(HAIR_COLORS.length, a.hairColor, base.hairColor),
    helmet: pickOf(HELMETS, a.helmet, base.helmet),
    color: sanitizeHex(a.color, base.color),
    visor: pickOf(VISORS, a.visor, base.visor),
    eyes: pickOf(EYES, a.eyes, base.eyes),
    eyeColor: pickIndex(EYE_COLORS.length, a.eyeColor, base.eyeColor),
    mouth: pickOf(MOUTHS, a.mouth, base.mouth),
    glasses: pickOf(GLASSES, a.glasses, base.glasses),
    beard: pickOf(BEARDS, a.beard, base.beard),
    mark: pickOf(MARKS, a.mark, base.mark),
  };
}

/** A valid driver for slot `index` from anything; the slot's default fills every missing or junk field. */
export function sanitizeDriver(input: unknown, index: number): DriverProfile {
  const base = DEFAULT_DRIVERS[index] ?? DEFAULT_DRIVERS[0]!;
  const d = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof DriverProfile, unknown>>;
  const name = sanitizeName(d.name);
  return {
    id: base.id,
    name: name || base.name,
    owner: base.owner,
    bio: sanitizeName(d.bio, 60) || base.bio,
    taunt: (sanitizeName(d.taunt, 40) || base.taunt).toUpperCase(),
    avatar: sanitizeAvatar(d.avatar, base.avatar),
  };
}

export function avatarEqual(a: Readonly<AvatarConfig>, b: Readonly<AvatarConfig>): boolean {
  return (
    a.skin === b.skin &&
    a.hair === b.hair &&
    a.hairColor === b.hairColor &&
    a.helmet === b.helmet &&
    a.color === b.color &&
    a.visor === b.visor &&
    a.eyes === b.eyes &&
    a.eyeColor === b.eyeColor &&
    a.mouth === b.mouth &&
    a.glasses === b.glasses &&
    a.beard === b.beard &&
    a.mark === b.mark
  );
}

/** A short stable key of an avatar (cache keys for portraits and busts). */
export function avatarKey(a: Readonly<AvatarConfig>): string {
  return `${a.skin}|${a.hair}|${a.hairColor}|${a.helmet}|${a.color}|${a.visor}|${a.eyes}|${a.eyeColor}|${a.mouth}|${a.glasses}|${a.beard}|${a.mark}`;
}
