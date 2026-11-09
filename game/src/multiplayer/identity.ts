/**
 * Who we are on the wire (RoomIdentity from the profile, garage and MY RIDE stores) and how the
 * others' identities turn back into a KinematicCar look: the ride and driver travel as the share
 * codes the DRIVERS / MY RIDE tabs already produce (`RIDE1-…`, `DRV1-…`), so the wire rule is the
 * share-code rule and a corrupt code just means the stock look.
 */
import { sanitizeRoomPlate, type RoomIdentity, type RoomPlayer } from '@shared/protocol';
import { getCarEntry, resolveCarId } from '../car/catalog';
import { plateFor } from '../car/plates/platePick';
import type { AvatarConfig } from '../drivers/avatar';
import { decodeDriver, encodeDriver } from '../drivers/shareCode';
import type { RideConfig } from '../ride/config';
import { decodeRide, encodeRide } from '../ride/shareCode';
import type { RideLook } from '../rivals/KinematicCar';
import { activeDriver, profileState } from '../state/profile';
import { selectionState } from '../state/selection';
import { roomName } from './friendsProfile';

/** Colours for players whose avatar carries no usable signature colour, by join order. */
const FALLBACK_COLORS = ['#00f0ff', '#ff3d9a', '#f5e663', '#39ff14', '#ff9a1f', '#9b5cff', '#2ef2c8', '#4d7cff'];

export function localIdentity(): RoomIdentity {
  const profile = profileState();
  const carId = resolveCarId(selectionState().carId);
  const driver = activeDriver(profile);
  const rideOn = profile.rideActive && profile.ride.base === carId;
  return {
    // YOUR NAME (FRIENDS) when set, else the selected driver's name.
    name: roomName(profile),
    carId,
    look: rideOn ? encodeRide(profile.ride) : null,
    plate: sanitizeRoomPlate(plateFor(carId)),
    avatar: encodeDriver({ name: driver.name, avatar: driver.avatar }),
  };
}

export const identityKey = (i: RoomIdentity): string => `${i.name}|${i.carId}|${i.look ?? ''}|${i.plate}|${i.avatar ?? ''}`;

export interface DecodedPlayer {
  look: RideLook;
  color: string;
  carName: string;
  avatar: AvatarConfig | null;
}

const decodeCache = new Map<string, DecodedPlayer>();

/** Ride + driver for KinematicCar and a display colour (the avatar's signature colour). Memoized per code pair. */
export function decodePlayer(p: Pick<RoomPlayer, 'carId' | 'look' | 'avatar'>, index = 0): DecodedPlayer {
  const key = `${p.carId}|${p.look ?? ''}|${p.avatar ?? ''}|${index}`;
  const hit = decodeCache.get(key);
  if (hit) return hit;
  let ride: RideConfig | null = null;
  if (p.look) {
    const decoded = decodeRide(p.look);
    if (decoded && decoded.known && decoded.ride.base === p.carId) ride = decoded.ride;
  }
  const avatar = p.avatar ? (decodeDriver(p.avatar)?.avatar ?? null) : null;
  const color = avatar?.color && /^#[0-9a-f]{6}$/i.test(avatar.color) ? avatar.color : FALLBACK_COLORS[index % FALLBACK_COLORS.length]!;
  const out: DecodedPlayer = { look: { ride, driver: avatar }, color, carName: getCarEntry(resolveCarId(p.carId)).name, avatar };
  if (decodeCache.size > 64) decodeCache.clear();
  decodeCache.set(key, out);
  return out;
}
