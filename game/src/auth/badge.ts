/**
 * The verified badge: ✓ and the player's Google first name, as the relay reports it on each room player
 * (`verified: true` + `givenName`). Only the relay can set it, so a typed YOUR NAME can never carry it.
 */
import type { RoomPlayer } from '@shared/protocol';

type BadgeFields = Pick<RoomPlayer, 'verified' | 'givenName'>;

/** Check-mark look-alikes (✓ ✔ ☑ ✅ √ 🗸 and heavy / ballot variants): a typed name must not look verified. */
const CHECK_LOOKALIKES = /[\u2713\u2714\u2611\u2705\u221A\u2610\u2612\u{1F5F8}\u{1F5F9}]/gu;

/** A room name as the game shows it: check-mark look-alikes removed (only the relay's `verified` earns ✓). */
export function displayName(name: string): string {
  const s = name.replace(CHECK_LOOKALIKES, '').replace(/\s+/g, ' ').trim();
  return s || '?';
}

/** '✓ ANA' for a verified player ('✓ SIGNED IN' when the relay knows no first name), else null. */
export function verifiedLabel(p: BadgeFields): string | null {
  if (p.verified !== true) return null;
  const given = p.givenName ? displayName(p.givenName) : '';
  return given && given !== '?' ? `✓ ${given}` : '✓ SIGNED IN';
}

/**
 * The name tag over a friend's car: the room name, then the badge ('SPEEDY ✓ ANA'); just '✓ ANA' when the
 * first name is the room name. Unverified players keep their plain name.
 */
export function nameTagLabel(p: BadgeFields & Pick<RoomPlayer, 'name'>): string {
  const name = displayName(p.name);
  if (p.verified !== true) return name;
  const given = p.givenName ? displayName(p.givenName) : '';
  if (!given || given === '?') return `${name} ✓`;
  if (given.toLocaleLowerCase() === name.toLocaleLowerCase()) return `✓ ${name}`;
  return `${name} ✓ ${given}`;
}
