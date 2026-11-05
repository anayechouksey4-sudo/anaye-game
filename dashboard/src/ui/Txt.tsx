import { createContext, useContext } from 'react';
import { Platform, Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '../theme';

export type FontKey = keyof typeof fonts;

/** True once the Orbitron / Share Tech Mono files are registered. */
export const FontsReadyContext = createContext(false);

const FALLBACK_FAMILY = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const FALLBACK_WEIGHT: Record<FontKey, TextStyle['fontWeight']> = {
  display: '700',
  displayBlack: '900',
  displayMedium: '500',
  mono: '400',
};

export interface TxtProps extends TextProps {
  font?: FontKey;
}

/**
 * All text goes through here so a failed font download degrades to the platform monospace instead of
 * an "unrecognized font family" warning (custom families must not also get a fontWeight on Android).
 */
export function Txt({ font = 'mono', style, maxFontSizeMultiplier = 1.25, ...rest }: TxtProps) {
  const ready = useContext(FontsReadyContext);
  const base: TextStyle = ready
    ? { fontFamily: fonts[font], color: colors.text }
    : { fontFamily: FALLBACK_FAMILY, fontWeight: FALLBACK_WEIGHT[font], color: colors.text };
  return <Text {...rest} maxFontSizeMultiplier={maxFontSizeMultiplier} style={[base, style]} />;
}
