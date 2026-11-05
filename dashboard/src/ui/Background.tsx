import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { alpha, colors } from '../theme';

const GRID = 32;
const BEAM_HEIGHT = 160;
const useNativeDriver = Platform.OS !== 'web';

/** Fixed HUD backdrop: vignette, faint grid and a slow scan beam. Rendered once; never re-renders on data. */
export const Background = memo(function Background() {
  const { width, height } = useWindowDimensions();
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver }),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const columns = Math.ceil(width / GRID);
  const rows = Math.ceil(height / GRID);
  const translateY = sweep.interpolate({ inputRange: [0, 1], outputRange: [-BEAM_HEIGHT, height] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['#08122A', colors.bg, colors.bg, '#12061A']}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      {Array.from({ length: columns }, (_, i) => (
        <View key={`c${i}`} style={[styles.vLine, { left: i * GRID, opacity: i % 4 === 0 ? 0.11 : 0.05 }]} />
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <View key={`r${i}`} style={[styles.hLine, { top: i * GRID, opacity: i % 4 === 0 ? 0.11 : 0.05 }]} />
      ))}
      <Animated.View style={[styles.beam, { transform: [{ translateY }] }]}>
        <LinearGradient
          colors={['transparent', alpha(colors.cyan, 0.05), alpha(colors.cyan, 0.09), 'transparent']}
          locations={[0, 0.6, 0.97, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  vLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.cyan,
  },
  hLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.cyan,
  },
  beam: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: BEAM_HEIGHT,
  },
});
