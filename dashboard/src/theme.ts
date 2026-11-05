import { Platform, type TextStyle } from 'react-native';

export const colors = {
  bg: '#05060A',
  panel: '#0B0F1A',
  panelRaised: '#101629',
  line: '#1A2238',
  lineBright: '#26324F',
  text: '#D8E4FF',
  textDim: '#7D8AA8',
  textFaint: '#4A5572',
  cyan: '#00F0FF',
  magenta: '#FF2A6D',
  yellow: '#F5E663',
  green: '#39FF88',
  white: '#F4F8FF',
} as const;

export type NeonColor = typeof colors.cyan | typeof colors.magenta | typeof colors.yellow | typeof colors.green;

/** Hex colour → rgba() with alpha, for borders, fills and glows. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Font families registered in App.tsx. Until they load (or if loading fails) the platform fallback is
 * used, so every style keeps a sensible generic family.
 */
export const fonts = {
  display: 'Orbitron_700Bold',
  displayBlack: 'Orbitron_900Black',
  displayMedium: 'Orbitron_500Medium',
  mono: 'ShareTechMono_400Regular',
} as const;

const monoFallback = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

export function fontFamily(family: string, loaded: boolean): string {
  return loaded ? family : (monoFallback ?? 'monospace');
}

/** Neon text glow. textShadow is supported on iOS, Android and web. */
export function glow(color: string, radius = 10): TextStyle {
  return {
    textShadowColor: alpha(color, 0.85),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: radius,
  };
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
