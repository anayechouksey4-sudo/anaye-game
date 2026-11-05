import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { BIG_JUMP_LIP_KMH, assessBigJump, mapSquadControlsToPhysics, type BigJumpAssessment } from '../../../shared/protocol';
import { formatKmh, formatSigned } from '../lib/format';
import { useControls, useTelemetry } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

const VERDICT_LOOK: Record<BigJumpAssessment['verdict'], { color: string; hint: string }> = {
  READY: { color: colors.green, hint: 'Carries lip speed with the nose planted. Send it.' },
  'TOO SLOW': { color: colors.yellow, hint: 'Not enough top speed: raise Engine Tier or trim the front wing (less drag).' },
  'NOSE LIFT': { color: colors.magenta, hint: 'Front lifts before the lip: add front wing or shift Chassis Balance forward.' },
};

interface Marker {
  kmh: number;
  label: string;
  color: string;
  below?: boolean;
}

function SpeedGauge({ topSpeed, markers, ready }: { topSpeed: number; markers: Marker[]; ready: boolean }) {
  const finiteTop = Number.isFinite(topSpeed) ? topSpeed : 400;
  const scale = Math.max(260, ...markers.map((m) => m.kmh + 20), Math.min(finiteTop, 400) + 15);
  const at = (kmh: number) => `${Math.min(100, Math.max(0, (kmh / scale) * 100))}%` as const;
  // Labels are 80 px wide and centred on their marker; keep them inside the card near the ends.
  const labelAt = (kmh: number) => `${Math.min(86, Math.max(14, (kmh / scale) * 100))}%` as const;
  const fillColor = ready ? colors.green : colors.cyan;
  return (
    <View style={styles.gauge}>
      <View style={styles.markerLabels}>
        {markers
          .filter((m) => !m.below)
          .map((m) => (
            <Txt key={m.label} style={[styles.markerLabel, { left: labelAt(m.kmh), color: m.color }]}>
              {m.label}
            </Txt>
          ))}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: at(finiteTop), backgroundColor: alpha(fillColor, 0.85), shadowColor: fillColor }]} />
        {markers.map((m) => (
          <View key={m.label} style={[styles.marker, { left: at(m.kmh), backgroundColor: m.color }]} />
        ))}
      </View>
      <View style={styles.markerLabels}>
        {markers
          .filter((m) => m.below)
          .map((m) => (
            <Txt key={m.label} style={[styles.markerLabel, { left: labelAt(m.kmh), color: m.color }]}>
              {m.label}
            </Txt>
          ))}
      </View>
    </View>
  );
}

function SpeedTrap() {
  const trap = useTelemetry((s) => s.telemetry?.speedTrapKmh ?? null);
  if (trap === null) {
    return <Txt style={styles.trapIdle}>SPEED TRAP · waiting for the first run at the lip</Txt>;
  }
  const margin = trap - BIG_JUMP_LIP_KMH;
  const cleared = margin >= 0;
  const color = cleared ? colors.green : colors.magenta;
  return (
    <View style={[styles.trap, { borderColor: alpha(color, 0.5) }]} testID="speed-trap">
      <Txt style={styles.k}>LAST LIP SPEED (GAME)</Txt>
      <View style={styles.trapRow}>
        <Txt font="display" style={[styles.trapValue, { color }, glow(color, 10)]} testID="speed-trap-value">
          {`${formatKmh(trap)} KM/H`}
        </Txt>
        <Txt font="display" style={[styles.trapVerdict, { color }]}>
          {cleared ? `CLEARED ${formatSigned(margin)}` : `SHORT ${formatSigned(margin)}`}
        </Txt>
      </View>
      <Txt style={styles.sub}>{`required ${BIG_JUMP_LIP_KMH} km/h at the lip`}</Txt>
    </View>
  );
}

export const BigJumpCard = memo(function BigJumpCard() {
  const values = useControls((s) => s.values);
  const jump = useMemo(() => assessBigJump(mapSquadControlsToPhysics(values)), [values]);
  const look = VERDICT_LOOK[jump.verdict];

  const markers: Marker[] = [{ kmh: jump.requiredKmh, label: `LIP ${jump.requiredKmh}`, color: colors.yellow }];
  if (jump.liftOffKmh !== null) {
    markers.push({ kmh: jump.liftOffKmh, label: `LIFT ${formatKmh(jump.liftOffKmh)}`, color: colors.magenta, below: true });
  }

  return (
    <Panel title="BIG JUMP READINESS" tag="06" accent={look.color} testID="big-jump">
      <Txt font="displayBlack" style={[styles.verdict, { color: look.color }, glow(look.color, 14)]} testID="jump-verdict">
        {jump.verdict}
      </Txt>
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Txt style={styles.k}>EST. TOP / NEEDED</Txt>
          <Txt style={styles.v} testID="jump-speeds">
            {`${formatKmh(jump.topSpeedKmh)} / ${jump.requiredKmh} km/h`}
          </Txt>
        </View>
        <View style={styles.statCell}>
          <Txt style={styles.k}>NOSE LIFT</Txt>
          <Txt style={[styles.v, { color: jump.liftOffKmh === null ? colors.green : colors.text }]} testID="jump-lift">
            {jump.liftOffKmh === null ? 'NEVER' : `${formatKmh(jump.liftOffKmh)} km/h`}
          </Txt>
        </View>
      </View>
      <SpeedGauge topSpeed={jump.topSpeedKmh} markers={markers} ready={jump.ready} />
      <Txt style={[styles.hint, { color: look.color }]}>{look.hint}</Txt>
      <SpeedTrap />
    </Panel>
  );
});

const styles = StyleSheet.create({
  verdict: {
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: 3,
  },
  statsRow: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 12,
  },
  statCell: {
    flex: 1,
  },
  k: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textDim,
    marginTop: 2,
  },
  v: {
    fontSize: 14,
    color: colors.text,
  },
  gauge: {
    marginTop: 14,
  },
  markerLabels: {
    height: 16,
  },
  markerLabel: {
    position: 'absolute',
    width: 80,
    marginLeft: -40,
    textAlign: 'center',
    fontSize: 10,
    letterSpacing: 0.6,
  },
  track: {
    height: 12,
    backgroundColor: alpha(colors.lineBright, 0.5),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(colors.cyan, 0.3),
  },
  fill: {
    height: '100%',
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  marker: {
    position: 'absolute',
    top: -4,
    width: 2,
    marginLeft: -1,
    height: 20,
  },
  hint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
  },
  trapIdle: {
    marginTop: 10,
    fontSize: 11,
    color: colors.textFaint,
    letterSpacing: 0.6,
  },
  trap: {
    marginTop: 12,
    borderWidth: 1,
    padding: 10,
    backgroundColor: alpha(colors.bg, 0.6),
  },
  trapRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  trapValue: {
    fontSize: 22,
  },
  trapVerdict: {
    fontSize: 12,
    letterSpacing: 1.4,
  },
  sub: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 2,
  },
});
