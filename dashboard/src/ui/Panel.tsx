import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { alpha, colors, glow } from '../theme';
import { Txt } from './Txt';

const NOTCH = 14;
const NOTCH_SQUARE = NOTCH * Math.SQRT2;

interface PanelProps {
  title?: string;
  /** Small index tag in the header, e.g. "01". */
  tag?: string;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Panel with cut (notched) top-left and bottom-right corners. RN has no clip-path, so each notch is a
 * page-coloured square rotated 45° and centred on the corner; the panel clips it to a triangle whose
 * long edge carries the neon border. The border lives on an inner layer so the notches can cover it.
 */
export function Panel({ title, tag, accent = colors.cyan, right, children, style, testID }: PanelProps) {
  return (
    <View style={[styles.panel, style]} testID={testID}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.border, { borderColor: alpha(accent, 0.32) }]} />
      <View pointerEvents="none" style={[styles.topHighlight, { backgroundColor: accent }]} />
      {title ? (
        <View style={styles.header}>
          <View style={[styles.headerPip, { backgroundColor: accent }]} />
          <Txt font="display" style={[styles.title, { color: accent }, glow(accent, 6)]} numberOfLines={1}>
            {title}
          </Txt>
          {tag ? <Txt style={styles.tag}>{`//${tag}`}</Txt> : null}
          <View style={styles.spacer} />
          {right}
        </View>
      ) : null}
      {children}
      <View pointerEvents="none" style={[styles.notch, styles.notchTopLeft, { borderColor: alpha(accent, 0.75) }]} />
      <View pointerEvents="none" style={[styles.notch, styles.notchBottomRight, { borderColor: alpha(accent, 0.75) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.panel,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  border: {
    borderWidth: 1,
  },
  topHighlight: {
    position: 'absolute',
    top: 0,
    right: 22,
    width: 56,
    height: 2,
    opacity: 0.9,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingLeft: 6,
    minHeight: 22,
  },
  headerPip: {
    width: 4,
    height: 12,
    marginRight: 8,
    transform: [{ skewX: '-20deg' }],
  },
  title: {
    fontSize: 12,
    letterSpacing: 2.4,
    flexShrink: 1,
  },
  tag: {
    marginLeft: 8,
    fontSize: 11,
    color: colors.textFaint,
    letterSpacing: 1,
  },
  spacer: {
    flex: 1,
    minWidth: 8,
  },
  notch: {
    position: 'absolute',
    width: NOTCH_SQUARE,
    height: NOTCH_SQUARE,
    backgroundColor: colors.bg,
    borderWidth: 1,
    transform: [{ rotate: '45deg' }],
  },
  notchTopLeft: {
    top: -NOTCH_SQUARE / 2,
    left: -NOTCH_SQUARE / 2,
  },
  notchBottomRight: {
    bottom: -NOTCH_SQUARE / 2,
    right: -NOTCH_SQUARE / 2,
  },
});
