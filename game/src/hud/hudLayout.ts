import { useSyncExternalStore } from 'react';
import { wantsTouchControls } from '../car/input';

/** On-screen touch controls, decided once per page load (`?touch=` or the device type, see car/input.ts). */
export const TOUCH_CONTROLS = wantsTouchControls();

/** Phone-sized windows (portrait phones are narrow, landscape phones are short). */
const SMALL_SCREEN_QUERY = '(max-width: 900px), (max-height: 520px)';

const smallScreenQuery = (): MediaQueryList | null =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(SMALL_SCREEN_QUERY) : null;

function subscribeSmallScreen(onChange: () => void): () => void {
  const mq = smallScreenQuery();
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

const isSmallScreen = (): boolean => smallScreenQuery()?.matches ?? false;

/** Compact HUD (status chips instead of big panels): whenever the touch controls are shown or the window is phone-sized. */
export function useCompactHud(): boolean {
  const small = useSyncExternalStore(subscribeSmallScreen, isSmallScreen, () => false);
  return TOUCH_CONTROLS || small;
}
