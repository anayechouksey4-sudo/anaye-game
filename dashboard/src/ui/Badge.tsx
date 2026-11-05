import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, glow } from '../theme';
import { Txt } from './Txt';

interface BadgeProps {
  label: string;
  color: string;
  /** Filled badges are for verdicts; outlined ones for status. */
  filled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Badge({ label, color, filled = false, style, testID }: BadgeProps) {
  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        { borderColor: alpha(color, 0.7), backgroundColor: filled ? alpha(color, 0.16) : 'transparent' },
        style,
      ]}
    >
      <Txt font="display" style={[styles.label, { color }, glow(color, 5)]} numberOfLines={1}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    transform: [{ skewX: '-12deg' }],
  },
  label: {
    fontSize: 10,
    letterSpacing: 1.6,
  },
});
