import { memo, useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import { PROTOCOL_VERSION } from '../../../shared/protocol';
import { useNow } from '../lib/useNow';
import { useConnection, useGameLink } from '../squad/SquadContext';
import { describeLinkStatus } from '../squad/linkStatus';
import { alpha, colors, glow } from '../theme';
import { Led } from './Led';
import { Txt } from './Txt';

const useNativeDriver = Platform.OS !== 'web';
const TITLE = 'SQUAD//HQ';

/** Chromatic-split title that glitches every few seconds. */
const GlitchTitle = memo(function GlitchTitle() {
  const jitter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const step = (toValue: number, duration: number) =>
      Animated.timing(jitter, { toValue, duration, useNativeDriver });
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(2600),
        step(1, 40),
        step(-0.7, 50),
        step(0.4, 40),
        step(-1, 30),
        step(0, 60),
        Animated.delay(900),
        step(0.6, 30),
        step(0, 50),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [jitter]);

  const magentaX = jitter.interpolate({ inputRange: [-1, 0, 1], outputRange: [-6, -1.5, 4] });
  const cyanX = jitter.interpolate({ inputRange: [-1, 0, 1], outputRange: [5, 1.5, -5] });
  const slice = jitter.interpolate({ inputRange: [-1, 0, 1], outputRange: [1, 0, 1] });

  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Squad HQ">
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: magentaX }] }]}>
        <Txt font="displayBlack" style={[styles.title, styles.ghostMagenta]}>
          {TITLE}
        </Txt>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: cyanX }] }]}>
        <Txt font="displayBlack" style={[styles.title, styles.ghostCyan]}>
          {TITLE}
        </Txt>
      </Animated.View>
      <Txt font="displayBlack" style={[styles.title, styles.main]}>
        {TITLE}
      </Txt>
      <Animated.View style={[styles.slice, { opacity: slice, transform: [{ translateX: cyanX }] }]} />
    </View>
  );
});

function LinkLed() {
  const status = useConnection((s) => s.status);
  const retryAt = useConnection((s) => s.retryAt);
  const latency = useConnection((s) => s.latencyMs);
  const games = useGameLink((s) => s.peers?.game ?? 0);
  const now = useNow(500, status === 'retrying');
  const look = describeLinkStatus(status, retryAt, now);
  return (
    <View style={styles.ledBlock} testID="header-link">
      <Led color={look.color} pulse={look.pulse} />
      <View style={styles.ledText}>
        <Txt font="display" style={[styles.ledLabel, { color: look.color }, glow(look.color, 6)]} testID="header-status">
          {`LINK ${look.label}`}
        </Txt>
        <Txt style={styles.ledSub}>
          {status === 'online'
            ? `${latency === null ? '··' : latency} ms · ${games > 0 ? `GAME ×${games}` : 'NO GAME'}`
            : 'RELAY :8787'}
        </Txt>
      </View>
    </View>
  );
}

export function Header() {
  return (
    <View style={styles.header}>
      <View pointerEvents="none" style={styles.scanlines}>
        {Array.from({ length: 18 }, (_, i) => (
          <View key={i} style={styles.scanline} />
        ))}
      </View>
      <View style={styles.row}>
        <View style={styles.titleBlock}>
          <GlitchTitle />
          <Txt style={styles.subtitle}>{`PIT WALL · LIVE TUNING LINK · PROTOCOL v${PROTOCOL_VERSION}`}</Txt>
        </View>
        <LinkLed />
      </View>
      <View style={styles.rule}>
        <View style={[styles.ruleSeg, { flex: 5, backgroundColor: colors.cyan }]} />
        <View style={[styles.ruleSeg, { flex: 1, backgroundColor: colors.magenta }]} />
        <View style={[styles.ruleSeg, { flex: 0.4, backgroundColor: colors.yellow }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: 8,
    paddingBottom: 4,
    marginBottom: 4,
  },
  scanlines: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'space-between',
    opacity: 0.5,
  },
  scanline: {
    height: 1,
    backgroundColor: alpha(colors.cyan, 0.05),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  titleBlock: {
    flexShrink: 1,
  },
  title: {
    fontSize: 34,
    letterSpacing: 3,
    lineHeight: 42,
  },
  main: {
    color: colors.white,
    ...glow(colors.cyan, 14),
  },
  ghostMagenta: {
    color: alpha(colors.magenta, 0.75),
  },
  ghostCyan: {
    color: alpha(colors.cyan, 0.7),
  },
  slice: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 18,
    height: 3,
    backgroundColor: alpha(colors.bg, 0.9),
  },
  subtitle: {
    fontSize: 11,
    letterSpacing: 1.6,
    color: colors.textDim,
    marginTop: 2,
  },
  ledBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: alpha(colors.cyan, 0.2),
    backgroundColor: alpha(colors.panel, 0.8),
  },
  ledText: {
    alignItems: 'flex-start',
  },
  ledLabel: {
    fontSize: 10,
    letterSpacing: 1.4,
  },
  ledSub: {
    fontSize: 10,
    color: colors.textDim,
    marginTop: 1,
  },
  rule: {
    flexDirection: 'row',
    height: 2,
    marginTop: 10,
    gap: 4,
  },
  ruleSeg: {
    height: 2,
    opacity: 0.85,
  },
});
