/**
 * `window.__PROFILE__` — drivers + MY RIDE for tests and the console: the store, the preview
 * build log and the share codes. Installed by the dev lab pages; the game can call
 * `installProfileDebug()` from its debug handle next to `__RACER__`.
 */
import { DEFAULT_DRIVERS, type AvatarConfig, type DriverProfile } from '../drivers/avatar';
import { bustStats } from '../drivers/DriverBust';
import { decodeDriver, encodeDriver } from '../drivers/shareCode';
import { activeDriver, profileState, useProfile, type ProfileState } from '../state/profile';
import { type RideConfig } from './config';
import { lookBuildLog } from './previewAssets';
import { previewRenderInfo } from './RidePreview';
import { decodeRide, encodeRide } from './shareCode';

export interface ProfileDebugHandle {
  state(): Pick<ProfileState, 'drivers' | 'activeDriverId' | 'ride' | 'rideActive'>;
  activeDriver(): DriverProfile;
  setRide(patch: Partial<RideConfig>): void;
  setDriverAvatar(id: string, avatar: Partial<AvatarConfig>): void;
  renameDriver(id: string, name: string): void;
  rideCode(): string;
  driverCode(id?: string): string;
  decode(code: string): unknown;
  /** Preview rebuild log: builds, last / max ms, last 32 build times, per-class first-fill ms. */
  builds(): typeof lookBuildLog;
  defaults(): readonly DriverProfile[];
  /** The preview canvas's last frame: draw calls, triangles, programs, geometries, frames rendered. */
  render(): typeof previewRenderInfo;
  /** Boxes / triangles of the last mounted driver bust. */
  bust(): { boxes: number; triangles: number };
  subscribe(fn: () => void): () => void;
}

declare global {
  interface Window {
    __PROFILE__?: ProfileDebugHandle;
  }
}

export function installProfileDebug(): () => void {
  const handle: ProfileDebugHandle = {
    state: () => {
      const s = profileState();
      return { drivers: s.drivers, activeDriverId: s.activeDriverId, ride: s.ride, rideActive: s.rideActive };
    },
    activeDriver: () => activeDriver(),
    setRide: (patch) => profileState().setRide(patch),
    setDriverAvatar: (id, avatar) => {
      const d = profileState().drivers.find((x) => x.id === id);
      if (d) profileState().setDriverAvatar(id, { ...d.avatar, ...avatar });
    },
    renameDriver: (id, name) => profileState().renameDriver(id, name),
    rideCode: () => encodeRide(profileState().ride),
    driverCode: (id = profileState().activeDriverId) => {
      const d = profileState().drivers.find((x) => x.id === id) ?? activeDriver();
      return encodeDriver({ name: d.name, avatar: d.avatar });
    },
    decode: (code) => decodeRide(code) ?? decodeDriver(code),
    builds: () => lookBuildLog,
    defaults: () => DEFAULT_DRIVERS,
    render: () => previewRenderInfo,
    bust: () => ({ ...bustStats }),
    subscribe: (fn) => useProfile.subscribe(fn),
  };
  window.__PROFILE__ = handle;
  return () => {
    if (window.__PROFILE__ === handle) delete window.__PROFILE__;
  };
}
