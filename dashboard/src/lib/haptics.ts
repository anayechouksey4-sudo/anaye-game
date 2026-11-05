import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import type { HapticKind } from './hapticRules';

export { hapticForChange, type HapticKind } from './hapticRules';

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
