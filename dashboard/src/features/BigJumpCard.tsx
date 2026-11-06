import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { BigJumpAssessment, CarClass } from '../../../shared/protocol';
import { formatKmh, formatNumber, formatSigned } from '../lib/format';
import { bigJumpHint, judgeSpeedTrap, landingSpeedFor, speedTrapNote } from '../squad/bigJump';
import { BIG_JUMP_MAPS, describeMap } from '../squad/garage';
import { previewSetup, type PlaySession } from '../squad/session';
import { useControls, usePlaySession, useTelemetry } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';
import { SessionLine } from './SessionInfo';

const VERDICT_COLOR: Record<BigJumpAssessment['verdict'], string> = {
  READY: colors.green,
  'TOO SLOW': colors.yellow,
  'NOSE LIFT': colors.magenta,
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

/**
 * The game's measured lip speed vs the lip speed that actually lands this map's jump with this car
 * (measured in the sim; see squad/bigJump.ts landingSpeedFor), not vs the estimate's target.
 */
function SpeedTrap({ session }: { session: PlaySession }) {
  const trap = useTelemetry((s) => s.telemetry?.speedTrapKmh ?? null);
  const landing = landingSpeedFor(session);
  if (!landing || session.bigJumpKmh === null) return null;
  if (trap === null) {
    return <Txt style={styles.trapIdle}>SPEED TRAP · waiting for the first run at the lip</Txt>;
  }
  const reading = judgeSpeedTrap(trap, landing);
  const color = reading.cleared ? colors.green : colors.magenta;
  return (
    <View style={[styles.trap, { borderColor: alpha(color, 0.5) }]} testID="speed-trap">
      <Txt style={styles.k}>LAST LIP SPEED (GAME)</Txt>
      <View style={styles.trapRow}>
        <Txt font="display" style={[styles.trapValue, { color }, glow(color, 10)]} testID="speed-trap-value">
          {`${formatNumber(trap, 1)} KM/H`}
        </Txt>
        <Txt font="display" style={[styles.trapVerdict, { color }]} testID="speed-trap-verdict">
          {reading.label}
        </Txt>
      </View>
      <Txt style={styles.sub} testID="speed-trap-note">
        {speedTrapNote(landing, session.bigJumpKmh, session.carId)}
      </Txt>
    </View>
  );
}

/** The current map has no speed-gated jump: no verdict, just the speeds and where to find a jump. */
function NoJump({ topSpeedKmh, liftOffKmh, mapName }: { topSpeedKmh: number; liftOffKmh: number | null; mapName: string }) {
  const where = BIG_JUMP_MAPS.map((m) => `${m.name} (${m.bigJumpKmh} km/h lip)`).join(' or ');
  return (
    <>
      <Txt font="displayBlack" style={[styles.verdict, styles.noJumpVerdict]} testID="jump-verdict">
        NO BIG JUMP
      </Txt>
      <Txt style={styles.noJumpText} testID="jump-none">
        {`${mapName} has no speed-gated jump, so there is no verdict here. To test a jump setup, pick ${where} in the game's ☰ menu.`}
      </Txt>
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Txt style={styles.k}>EST. TOP SPEED</Txt>
          <Txt style={styles.v} testID="jump-speeds">{`${formatKmh(topSpeedKmh)} km/h`}</Txt>
        </View>
        <View style={styles.statCell}>
          <Txt style={styles.k}>NOSE LIFT</Txt>
          <Txt style={[styles.v, { color: liftOffKmh === null ? colors.green : colors.text }]} testID="jump-lift">
            {liftOffKmh === null ? 'NEVER' : `${formatKmh(liftOffKmh)} km/h`}
          </Txt>
        </View>
      </View>
    </>
  );
}

function Verdict({ jump, lipKmh, car, session }: { jump: BigJumpAssessment; lipKmh: number; car: Readonly<CarClass>; session: PlaySession }) {
  const color = VERDICT_COLOR[jump.verdict];
  const scaled = Math.abs(jump.requiredKmh - lipKmh) >= 0.5;
  const markers: Marker[] = [
    { kmh: jump.requiredKmh, label: `${scaled ? 'NEED' : 'LIP'} ${formatKmh(jump.requiredKmh)}`, color: colors.yellow },
  ];
  if (jump.liftOffKmh !== null) {
    markers.push({ kmh: jump.liftOffKmh, label: `LIFT ${formatKmh(jump.liftOffKmh)}`, color: colors.magenta, below: true });
  }
  return (
    <>
      <Txt font="displayBlack" style={[styles.verdict, { color }, glow(color, 14)]} testID="jump-verdict">
        {jump.verdict}
      </Txt>
      <View style={styles.statsRow}>
        <View style={styles.statCell}>
          <Txt style={styles.k}>EST. TOP / NEEDED</Txt>
          <Txt style={styles.v} testID="jump-speeds">
            {`${formatKmh(jump.topSpeedKmh)} / ${formatKmh(jump.requiredKmh)} km/h`}
          </Txt>
          <Txt style={styles.sub} testID="jump-lip">
            {`map lip ${formatKmh(lipKmh)} km/h${scaled ? ` · ${formatSigned(jump.requiredKmh - lipKmh)} for this car` : ''}`}
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
      <Txt style={[styles.hint, { color }]} testID="jump-hint">
        {bigJumpHint(jump, car)}
      </Txt>
      <SpeedTrap session={session} />
    </>
  );
}

export const BigJumpCard = memo(function BigJumpCard() {
  const values = useControls((s) => s.values);
  const session = usePlaySession();
  const preview = useMemo(() => previewSetup(values, session), [values, session]);
  const accent = preview.jump ? VERDICT_COLOR[preview.jump.verdict] : colors.cyan;

  return (
    <Panel title="BIG JUMP READINESS" tag="06" accent={accent} testID="big-jump">
      <SessionLine testID="jump-session" />
      {preview.jump && session.bigJumpKmh !== null ? (
        <Verdict jump={preview.jump} lipKmh={session.bigJumpKmh} car={preview.car} session={session} />
      ) : (
        <NoJump topSpeedKmh={preview.topSpeedKmh} liftOffKmh={preview.liftOffKmh} mapName={describeMap(session.trackId).name} />
      )}
    </Panel>
  );
});

const styles = StyleSheet.create({
  verdict: {
    fontSize: 34,
    lineHeight: 42,
    letterSpacing: 3,
  },
  noJumpVerdict: {
    fontSize: 28,
    lineHeight: 36,
    color: colors.textDim,
  },
  noJumpText: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
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
