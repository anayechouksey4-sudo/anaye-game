/**
 * The player's profile: the five drivers (names, looks), which one is driving, and MY RIDE (the
 * custom car) with whether it is mounted. Cosmetic only — nothing here touches physics, best
 * times or medals (a ride records against its base class).
 *
 * Kept apart from `selection.ts` (car / map / menu) and persisted under its own key, best-effort
 * like the other stores. Invalid or partial saved data falls back field by field to the defaults.
 * `?driver=DRV1-…` / `?ride=RIDE1-…` in the URL import a shared code on load (a link from a friend).
 *
 * Consumers: hud/DriversTab.tsx, hud/RideTab.tsx, drivers/DriverBust.tsx (active avatar), the car
 * look (ride + driver → ride/livery.ts), net/squadLink (driver and ride names in game:state).
 */
import { create } from 'zustand';
import { getQueryParam } from '../config';
import { DEFAULT_DRIVERS, DRIVER_COUNT, sanitizeAvatar, sanitizeDriver, type AvatarConfig, type DriverProfile } from '../drivers/avatar';
import { sanitizeName } from '../drivers/sanitize';
import { decodeDriver, type DriverShare } from '../drivers/shareCode';
import { DEFAULT_RIDE, sanitizeRide, type RideConfig } from '../ride/config';
import { decodeRide } from '../ride/shareCode';

export const PROFILE_STORAGE_KEY = 'gamerfleet.profile.v1';

export interface ProfileState {
  /** Exactly DRIVER_COUNT drivers, slot order. */
  drivers: DriverProfile[];
  activeDriverId: string;
  ride: RideConfig;
  /** MY RIDE is mounted: the car in play is `ride.base` wearing the ride's look. */
  rideActive: boolean;
  renameDriver: (id: string, name: string) => void;
  setDriverAvatar: (id: string, avatar: AvatarConfig) => void;
  resetDriver: (id: string) => void;
  setActiveDriver: (id: string) => void;
  /** Apply a decoded DRV1 code to a slot (name too, unless empty). */
  importDriver: (id: string, share: DriverShare) => void;
  setRide: (patch: Partial<RideConfig>) => void;
  resetRide: (base?: RideConfig['base']) => void;
  setRideActive: (active: boolean) => void;
  /** Paste handler: imports a RIDE1 code into the ride; false for a corrupt code. */
  importRideCode: (code: string) => boolean;
}

interface Saved {
  drivers?: unknown;
  activeDriverId?: unknown;
  ride?: unknown;
  rideActive?: unknown;
}

function loadSaved(): Saved {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Saved) : {};
  } catch {
    return {};
  }
}

function save(state: Pick<ProfileState, 'drivers' | 'activeDriverId' | 'ride' | 'rideActive'>): void {
  try {
    window.localStorage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({ drivers: state.drivers, activeDriverId: state.activeDriverId, ride: state.ride, rideActive: state.rideActive }),
    );
  } catch {
    // Storage blocked: the profile lasts for this page load only.
  }
}

/** The drivers list from anything: always DRIVER_COUNT valid drivers in slot order. */
export function sanitizeDrivers(input: unknown): DriverProfile[] {
  const list = Array.isArray(input) ? input : [];
  return Array.from({ length: DRIVER_COUNT }, (_, i) => {
    const byId = list.find((d) => d && typeof d === 'object' && (d as { id?: unknown }).id === DEFAULT_DRIVERS[i]!.id);
    return sanitizeDriver(byId ?? list[i], i);
  });
}

/** The whole persisted profile from anything (exported for the tests). */
export function sanitizeProfile(saved: Saved): Pick<ProfileState, 'drivers' | 'activeDriverId' | 'ride' | 'rideActive'> {
  const drivers = sanitizeDrivers(saved.drivers);
  const activeDriverId = drivers.some((d) => d.id === saved.activeDriverId) ? (saved.activeDriverId as string) : drivers[0]!.id;
  return { drivers, activeDriverId, ride: sanitizeRide(saved.ride), rideActive: saved.rideActive === true };
}

function initialState(): Pick<ProfileState, 'drivers' | 'activeDriverId' | 'ride' | 'rideActive'> {
  const state = sanitizeProfile(typeof window === 'undefined' ? {} : loadSaved());
  if (typeof window !== 'undefined') {
    const driverCode = getQueryParam('driver');
    const shared = driverCode ? decodeDriver(driverCode) : null;
    if (shared) {
      // A shared driver lands in slot 2 (the owner keeps slot 1) and takes the wheel.
      const slot = state.drivers[1]!;
      state.drivers[1] = { ...slot, name: shared.name || slot.name, avatar: shared.avatar };
      state.activeDriverId = slot.id;
    }
    const rideCode = getQueryParam('ride');
    const ride = rideCode ? decodeRide(rideCode) : null;
    if (ride) {
      state.ride = ride.ride;
      state.rideActive = true;
    }
  }
  return state;
}

export const useProfile = create<ProfileState>()((set, get) => ({
  ...initialState(),
  renameDriver: (id, name) => {
    const clean = sanitizeName(name);
    if (!clean) return;
    set({ drivers: get().drivers.map((d) => (d.id === id ? { ...d, name: clean } : d)) });
    save(get());
  },
  setDriverAvatar: (id, avatar) => {
    const clean = sanitizeAvatar(avatar);
    set({ drivers: get().drivers.map((d) => (d.id === id ? { ...d, avatar: clean } : d)) });
    save(get());
  },
  resetDriver: (id) => {
    const index = get().drivers.findIndex((d) => d.id === id);
    if (index < 0) return;
    set({ drivers: get().drivers.map((d, i) => (i === index ? { ...DEFAULT_DRIVERS[index]!, avatar: { ...DEFAULT_DRIVERS[index]!.avatar } } : d)) });
    save(get());
  },
  setActiveDriver: (id) => {
    if (!get().drivers.some((d) => d.id === id) || get().activeDriverId === id) return;
    set({ activeDriverId: id });
    save(get());
  },
  importDriver: (id, share) => {
    set({ drivers: get().drivers.map((d) => (d.id === id ? { ...d, name: sanitizeName(share.name) || d.name, avatar: sanitizeAvatar(share.avatar) } : d)) });
    save(get());
  },
  setRide: (patch) => {
    set({ ride: sanitizeRide({ ...get().ride, ...patch }, get().ride) });
    save(get());
  },
  resetRide: (base) => {
    set({ ride: { ...DEFAULT_RIDE, base: base ?? get().ride.base } });
    save(get());
  },
  setRideActive: (rideActive) => {
    if (get().rideActive === rideActive) return;
    set({ rideActive });
    save(get());
  },
  importRideCode: (code) => {
    const decoded = decodeRide(code);
    if (!decoded) return false;
    set({ ride: decoded.ride });
    save(get());
    return true;
  },
}));

/** Non-React access (car model, link, audio). */
export const profileState = () => useProfile.getState();

/** The driver at the wheel. */
export function activeDriver(state: Pick<ProfileState, 'drivers' | 'activeDriverId'> = useProfile.getState()): DriverProfile {
  return state.drivers.find((d) => d.id === state.activeDriverId) ?? state.drivers[0]!;
}

/** React: the driver at the wheel (re-renders on a rename, a new look or a swap). */
export function useActiveDriver(): DriverProfile {
  return useProfile((s) => s.drivers.find((d) => d.id === s.activeDriverId) ?? s.drivers[0]!);
}
