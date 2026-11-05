import { memo, useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, View } from 'react-native';

import type { GameTelemetry } from '../../../shared/protocol';
import { formatLapTime, formatNumber, formatSigned } from '../lib/format';
import { useNow } from '../lib/useNow';
import { useConnection, useGameLink, useTelemetry } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Badge } from '../ui/Badge';
import { Meter } from '../ui/Meter';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

const STALE_AFTER_MS = 2500;
const SMOKE_THRESHOLD = 0.5;
const useNativeDriver = Platform.OS !== 'web';

function NoseLiftWarning() {
  const blink = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0.2, duration: 220, useNativeDriver }),
        Animated.timing(blink, { toValue: 1, duration: 220, useNativeDriver }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);
  return (
    <Animated.View style={[styles.liftBanner, { opacity: blink }]} testID="nose-lift-warning" accessibilityLiveRegion="assertive">
      <Txt font="displayBlack" style={[styles.liftText, glow(colors.magenta, 14)]}>
        ▲ NOSE LIFT ▲
      </Txt>
    </Animated.View>
  );
}

function PedalBar({ label, value, color, testID }: { label: string; value: number; color: string; testID: string }) {
  return (
    <View style={styles.pedal}>
      <Txt style={styles.pedalLabel}>{label}</Txt>
      <Meter value={value} color={color} height={10} segments={16} style={styles.pedalMeter} testID={testID} />
      <Txt style={styles.pedalValue}>{`${Math.round(value * 100)}%`}</Txt>
    </View>
  );
}

function Wheels({ grounded }: { grounded: number }) {
  return (
    <View style={styles.wheels} accessibilityLabel={`${grounded} of 4 wheels grounded`}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[styles.wheel, i < grounded ? { backgroundColor: colors.green, borderColor: colors.green } : { borderColor: colors.magenta }]}
        />
      ))}
    </View>
  );
}

function Stat({ k, v, color, testID }: { k: string; v: string; color?: string; testID?: string }) {
  return (
    <View style={styles.stat}>
      <Txt style={styles.k}>{k}</Txt>
      <Txt style={[styles.statValue, color ? { color } : null]} testID={testID}>
        {v}
      </Txt>
    </View>
  );
}

function Readouts({ t }: { t: GameTelemetry }) {
  const frontLift = t.frontAeroN < 0;
  const smoking = t.rearSlip >= SMOKE_THRESHOLD;
  return (
    <View>
      <View style={styles.speedRow}>
        <View>
          <Txt style={styles.k}>SPEED</Txt>
          <Txt font="display" style={[styles.speed, glow(colors.cyan, 16)]} testID="telemetry-speed">
            {formatNumber(t.speedKmh)}
            <Txt font="display" style={styles.speedUnit}>
              {' KM/H'}
            </Txt>
          </Txt>
        </View>
        {t.finished ? <Badge label="FINISHED" color={colors.green} filled /> : null}
      </View>

      <PedalBar label="THR" value={t.throttle} color={colors.green} testID="telemetry-throttle" />
      <PedalBar label="BRK" value={t.brake} color={colors.magenta} testID="telemetry-brake" />

      {t.noseLift ? <NoseLiftWarning /> : null}

      <View style={styles.grid}>
        <Stat
          k={frontLift ? 'FRONT AERO · LIFT' : 'FRONT AERO'}
          v={`${formatSigned(t.frontAeroN)} N`}
          color={frontLift ? colors.magenta : colors.green}
          testID="telemetry-front-aero"
        />
        <Stat k="REAR AERO" v={`${formatSigned(t.rearAeroN)} N`} testID="telemetry-rear-aero" />
      </View>

      <View style={styles.slipRow}>
        <Txt style={styles.k}>REAR SLIP</Txt>
        <Meter value={t.rearSlip} color={smoking ? colors.yellow : colors.cyan} height={10} segments={16} style={styles.slipMeter} testID="telemetry-slip" />
        <Txt style={[styles.slipValue, smoking ? { color: colors.yellow } : null]}>
          {smoking ? 'TYRE SMOKE' : `${Math.round(t.rearSlip * 100)}%`}
        </Txt>
      </View>

      <View style={styles.grid}>
        <View style={styles.stat}>
          <Txt style={styles.k}>WHEELS DOWN</Txt>
          <View style={styles.wheelRow}>
            <Wheels grounded={t.wheelsGrounded} />
            <Txt style={styles.statValue} testID="telemetry-wheels">{`${t.wheelsGrounded}/4`}</Txt>
          </View>
        </View>
        <Stat k="CHECKPOINT" v={`${t.checkpoint}/${t.totalCheckpoints}`} testID="telemetry-checkpoint" />
        <Stat k="FALLS" v={String(t.falls)} color={t.falls > 0 ? colors.magenta : undefined} testID="telemetry-falls" />
      </View>
      <View style={styles.grid}>
        <Stat k="RUN" v={formatLapTime(t.elapsedMs)} testID="telemetry-run" />
        <Stat k="BEST" v={formatLapTime(t.bestMs)} color={t.bestMs !== null ? colors.yellow : undefined} testID="telemetry-best" />
      </View>
    </View>
  );
}

export const TelemetryPanel = memo(function TelemetryPanel() {
  const online = useConnection((s) => s.status === 'online');
  const games = useGameLink((s) => s.peers?.game ?? 0);
  const telemetry = useTelemetry((s) => s.telemetry);
  const receivedAt = useTelemetry((s) => s.receivedAt);
  const fromSnapshot = useTelemetry((s) => s.fromSnapshot);
  const linked = online && games > 0;
  const now = useNow(1000, linked);
  const stale = linked && (receivedAt === null || fromSnapshot || now - receivedAt > STALE_AFTER_MS);

  const right = !linked ? (
    <Badge label="NO GAME LINKED" color={colors.magenta} />
  ) : stale ? (
    <Badge label="NO SIGNAL" color={colors.yellow} />
  ) : (
    <Badge label="LIVE 10 HZ" color={colors.green} filled />
  );

  return (
    <Panel title="F1 TELEMETRY" tag="07" accent={colors.magenta} right={right} testID="telemetry-panel">
      {linked && telemetry ? (
        <View style={stale ? styles.dim : null}>
          <Readouts t={telemetry} />
        </View>
      ) : (
        <View style={styles.empty} testID="telemetry-empty">
          <Txt font="display" style={[styles.emptyTitle, glow(colors.magenta, 10)]}>
            {linked ? 'WAITING FOR TELEMETRY' : 'NO GAME LINKED'}
          </Txt>
          <Txt style={styles.emptyText}>
            {online
              ? 'Open the racer on a computer on this relay (npm run dev:game). It streams speed, aero load, slip and lap times here at 10 Hz.'
              : 'Connect to the relay to see the racer’s live telemetry.'}
          </Txt>
        </View>
      )}
    </Panel>
  );
});

const styles = StyleSheet.create({
  dim: {
    opacity: 0.45,
  },
  k: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textDim,
  },
  speedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  speed: {
    fontSize: 44,
    lineHeight: 52,
    color: colors.white,
  },
  speedUnit: {
    fontSize: 12,
    color: colors.cyan,
    letterSpacing: 2,
  },
  pedal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pedalLabel: {
    width: 30,
    fontSize: 11,
    color: colors.textDim,
    letterSpacing: 1,
  },
  pedalMeter: {
    flex: 1,
  },
  pedalValue: {
    width: 40,
    textAlign: 'right',
    fontSize: 12,
    color: colors.text,
  },
  liftBanner: {
    marginVertical: 8,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.magenta,
    backgroundColor: alpha(colors.magenta, 0.16),
  },
  liftText: {
    fontSize: 18,
    letterSpacing: 4,
    color: colors.magenta,
  },
  grid: {
    flexDirection: 'row',
    marginTop: 10,
    gap: 8,
  },
  stat: {
    flex: 1,
  },
  statValue: {
    fontSize: 16,
    color: colors.text,
    marginTop: 2,
  },
  slipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  slipMeter: {
    flex: 1,
  },
  slipValue: {
    minWidth: 76,
    textAlign: 'right',
    fontSize: 12,
    color: colors.text,
  },
  wheelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  wheels: {
    flexDirection: 'row',
    gap: 3,
  },
  wheel: {
    width: 7,
    height: 14,
    borderWidth: 1,
  },
  empty: {
    paddingVertical: 18,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    letterSpacing: 3,
    color: colors.magenta,
  },
  emptyText: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
    textAlign: 'center',
    maxWidth: 320,
  },
});
