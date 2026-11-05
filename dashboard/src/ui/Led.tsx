import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { alpha } from '../theme';

interface LedProps {
  color: string;
  /** Breathing animation (connecting / retrying). */
  pulse?: boolean;
  size?: number;
  testID?: string;
}

const useNativeDriver = Platform.OS !== 'web';

export function Led({ color, pulse = false, size = 10, testID }: LedProps) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 450, useNativeDriver }),
        Animated.timing(opacity, { toValue: 1, duration: 450, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  return (
    <View testID={testID} style={[styles.halo, { width: size * 2.2, height: size * 2.2, borderRadius: size * 1.1, backgroundColor: alpha(color, 0.14) }]}>
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
          shadowColor: color,
          shadowOpacity: 1,
          shadowRadius: size * 0.8,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
