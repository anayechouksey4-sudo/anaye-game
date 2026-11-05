import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { SquadControlKey } from '../../../shared/protocol';

export type HapticKind = 'tick' | 'notch' | 'confirm';

/**
 * Which haptic (if any) a local slider move deserves: every Engine Tier step, every 10 units on the
 * other two, and a firmer bump when Chassis Balance lands on the neutral centre notch.
 */
export function hapticForChange(key: SquadControlKey, prev: number, next: number): HapticKind | null {
  if (prev === next) return null;
  if (key === 'engineTier') return 'tick';
  if (key === 'chassisBalance' && next === 0) return 'notch';
  return Math.floor(prev / 10) !== Math.floor(next / 10) ? 'tick' : null;
}

export function playHaptic(kind: HapticKind): void {
  if (Platform.OS === 'web') return;
  const run =
    kind === 'tick'
      ? Haptics.selectionAsync()
      : kind === 'notch'
        ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  // Haptics are a nicety; devices without an engine (or with it disabled) just reject.
  run.catch(() => undefined);
}
