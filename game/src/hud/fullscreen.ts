import { useEffect, useState } from 'react';

export const canFullscreen = (): boolean => typeof document !== 'undefined' && document.fullscreenEnabled === true;

/** Fullscreen on/off; entering also locks to landscape where the browser allows it. */
export function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  document.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(() => {
      // Not every browser can lock (and none outside fullscreen); portrait stays playable anyway.
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      return orientation.lock?.('landscape');
    })
    .catch(() => {});
}

export function useFullscreen(): boolean {
  const [on, setOn] = useState(() => typeof document !== 'undefined' && !!document.fullscreenElement);
  useEffect(() => {
    const sync = () => setOn(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);
  return on;
}
