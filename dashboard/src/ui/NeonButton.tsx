import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, colors, glow } from '../theme';
import { Txt } from './Txt';

interface NeonButtonProps {
  label: string;
  onPress(): void;
  color?: string;
  /** Solid neon fill for the primary action. */
  primary?: boolean;
  active?: boolean;
  disabled?: boolean;
  sublabel?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function NeonButton({
  label,
  onPress,
  color = colors.cyan,
  primary = false,
  active = false,
  disabled = false,
  sublabel,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: NeonButtonProps) {
  const lit = primary || active;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected: active }}
      hitSlop={4}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: alpha(color, disabled ? 0.25 : lit ? 0.95 : 0.55),
          backgroundColor: primary ? alpha(color, pressed ? 0.32 : 0.2) : alpha(color, pressed ? 0.18 : active ? 0.12 : 0.04),
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <View style={[styles.corner, { backgroundColor: color }]} />
      <Txt
        font="display"
        numberOfLines={1}
        style={[styles.label, { color: lit ? colors.white : color }, glow(color, lit ? 10 : 4)]}
      >
        {label}
      </Txt>
      {sublabel}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    top: -5,
    right: -5,
    width: 10,
    height: 10,
    transform: [{ rotate: '45deg' }],
  },
  label: {
    fontSize: 12,
    letterSpacing: 2,
  },
});
