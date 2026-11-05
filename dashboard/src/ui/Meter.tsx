import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, colors } from '../theme';

interface MeterProps {
  /** 0…1, clamped. */
  value: number;
  color: string;
  height?: number;
  /** Number of segment gaps drawn over the fill (LED-bar look); 0 for a solid bar. */
  segments?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Meter({ value, color, height = 8, segments = 20, style, testID }: MeterProps) {
  const v = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return (
    <View testID={testID} style={[styles.track, { height, borderColor: alpha(color, 0.25) }, style]}>
      <View style={[styles.fill, { width: `${v * 100}%`, backgroundColor: color, shadowColor: color }]} />
      {segments > 0 ? (
        <View pointerEvents="none" style={styles.segments}>
          {Array.from({ length: segments - 1 }, (_, i) => (
            <View key={i} style={styles.gap} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    backgroundColor: alpha(colors.lineBright, 0.45),
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  segments: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    justifyContent: 'space-evenly',
  },
  gap: {
    width: 2,
    height: '100%',
    backgroundColor: colors.panel,
  },
});
