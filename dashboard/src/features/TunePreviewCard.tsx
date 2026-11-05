import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  FRONT_BODY_LIFT,
  balanceToSuspensionStiffness,
  describeChassisBalance,
  driveForceN,
  estimateFrontLiftOffKmh,
  estimateTopSpeedKmh,
  frontAeroForceN,
  mapSquadControlsToPhysics,
  squadControlsEqual,
  type CarPhysicsParams,
} from '../../../shared/protocol';
import { formatKmh, formatNumber, formatSigned } from '../lib/format';
import { physicsEqual } from '../squad/controller';
import { useControls, useGameLink } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Badge } from '../ui/Badge';
import { Meter } from '../ui/Meter';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

/** Reference speed for the "front aero at speed" readout, km/h. */
const REF_KMH = 200;

function Row({ k, v, sub, color, testID }: { k: string; v: string; sub?: string; color?: string; testID?: string }) {
  return (
    <View style={styles.row}>
      <Txt style={styles.k}>{k}</Txt>
      <View style={styles.vBlock}>
        <Txt style={[styles.v, color ? { color } : null]} testID={testID}>
          {v}
        </Txt>
        {sub ? <Txt style={styles.sub}>{sub}</Txt> : null}
      </View>
    </View>
  );
}

/** Front wing k vs the fixed body lift, as two bars on a shared scale. */
function WingVsLift({ physics }: { physics: CarPhysicsParams }) {
  const scale = 7;
  const net = physics.frontDownforce - FRONT_BODY_LIFT;
  const wingColor = net < 0 ? colors.magenta : colors.cyan;
  return (
    <View style={styles.versus}>
      <View style={styles.versusRow}>
        <Txt style={styles.versusLabel}>WING</Txt>
        <Meter value={physics.frontDownforce / scale} color={wingColor} segments={14} style={styles.versusMeter} />
        <Txt style={[styles.versusValue, { color: wingColor }]}>{formatNumber(physics.frontDownforce, 2)}</Txt>
      </View>
      <View style={styles.versusRow}>
        <Txt style={styles.versusLabel}>LIFT</Txt>
        <Meter value={FRONT_BODY_LIFT / scale} color={alpha(colors.magenta, 0.7)} segments={14} style={styles.versusMeter} />
        <Txt style={[styles.versusValue, { color: colors.magenta }]}>{formatNumber(FRONT_BODY_LIFT, 2)}</Txt>
      </View>
    </View>
  );
}

function AppliedSection({ preview }: { preview: CarPhysicsParams }) {
  const values = useControls((s) => s.values);
  const applied = useGameLink((s) => s.appliedPhysics);
  const appliedControls = useGameLink((s) => s.appliedControls);
  const fromSnapshot = useGameLink((s) => s.appliedFromSnapshot);
  const games = useGameLink((s) => s.peers?.game ?? 0);

  let badge: { label: string; color: string };
  if (!applied) badge = { label: 'AWAITING GAME', color: colors.textDim };
  else if (games === 0) badge = { label: 'LAST KNOWN', color: colors.textDim };
  else if (fromSnapshot) badge = { label: 'UNCONFIRMED', color: colors.yellow };
  else if (squadControlsEqual(appliedControls, values)) {
    badge = physicsEqual(applied, preview)
      ? { label: 'SYNCED', color: colors.green }
      : { label: 'OVERRIDE', color: colors.yellow };
  } else badge = { label: 'SYNCING', color: colors.yellow };

  return (
    <View style={styles.applied} testID="applied-physics">
      <View style={styles.appliedHeader}>
        <Txt font="display" style={styles.appliedTitle}>
          APPLIED IN GAME
        </Txt>
        <Badge label={badge.label} color={badge.color} filled={badge.label === 'SYNCED'} testID="sync-badge" />
      </View>
      {applied ? (
        <View style={styles.appliedGrid}>
          {(
            [
              ['MASS', `${formatNumber(applied.mass)} kg`, applied.mass !== preview.mass],
              ['WING k', formatNumber(applied.frontDownforce, 2), applied.frontDownforce !== preview.frontDownforce],
              ['DRAG k', formatNumber(applied.drag, 2), applied.drag !== preview.drag],
              ['TORQUE', `${formatNumber(applied.engineTorque)} N·m`, applied.engineTorque !== preview.engineTorque],
              ['BALANCE', formatSigned(applied.balance, 2), applied.balance !== preview.balance],
              ['GRIP μ', formatNumber(applied.traction, 2), applied.traction !== preview.traction],
            ] as const
          ).map(([k, v, differs]) => (
            <View key={k} style={styles.appliedCell}>
              <Txt style={styles.k}>{k}</Txt>
              <Txt style={[styles.appliedValue, differs ? { color: colors.yellow } : null]}>{v}</Txt>
            </View>
          ))}
        </View>
      ) : (
        <Txt style={styles.sub}>The racer reports the physics it is running once it joins the relay.</Txt>
      )}
    </View>
  );
}

export const TunePreviewCard = memo(function TunePreviewCard() {
  const values = useControls((s) => s.values);
  const physics = useMemo(() => mapSquadControlsToPhysics(values), [values]);
  const topSpeed = estimateTopSpeedKmh(physics);
  const liftOff = estimateFrontLiftOffKmh(physics);
  const liftWarn = liftOff !== null && liftOff < topSpeed;
  const frontAtRef = frontAeroForceN(physics, REF_KMH / 3.6);
  const split = describeChassisBalance(values.chassisBalance);
  const springs = balanceToSuspensionStiffness(physics.balance);

  return (
    <Panel title="TUNE PREVIEW" tag="05" accent={colors.cyan} testID="tune-preview">
      <View style={styles.hero}>
        <View>
          <Txt style={styles.k}>EST. TOP SPEED</Txt>
          <Txt font="display" style={[styles.heroValue, glow(colors.cyan, 12)]} testID="preview-top-speed">
            {formatKmh(topSpeed)}
            <Txt font="display" style={styles.heroUnit}>
              {' KM/H'}
            </Txt>
          </Txt>
        </View>
        <View style={styles.heroRight}>
          <Txt style={styles.k}>NOSE LIFTS AT</Txt>
          <Txt
            font="display"
            style={[styles.liftValue, { color: liftWarn ? colors.magenta : liftOff === null ? colors.green : colors.text }, liftWarn ? glow(colors.magenta, 8) : null]}
            testID="preview-lift-off"
          >
            {liftOff === null ? 'NEVER' : `${formatKmh(liftOff)} KM/H`}
          </Txt>
        </View>
      </View>
      {liftWarn ? (
        <Txt style={styles.warn} testID="preview-lift-warning">
          ▲ NOSE LIFTS BELOW TOP SPEED — add front wing or shift balance forward
        </Txt>
      ) : null}

      <WingVsLift physics={physics} />

      <Row k="MASS" v={`${formatNumber(physics.mass)} kg`} testID="preview-mass" />
      <Row
        k="FRONT AERO"
        v={`${formatSigned(frontAtRef)} N`}
        sub={`net k ${formatSigned(physics.frontDownforce - FRONT_BODY_LIFT, 2)} · at ${REF_KMH} km/h`}
        color={frontAtRef < 0 ? colors.magenta : colors.green}
        testID="preview-front-aero"
      />
      <Row k="DRAG" v={`k ${formatNumber(physics.drag, 2)}`} sub="F = −k·v·|v|" testID="preview-drag" />
      <Row
        k="REAR TORQUE"
        v={`${formatNumber(physics.engineTorque)} N·m`}
        sub={`${formatNumber(driveForceN(physics))} N at the contact patch`}
        testID="preview-torque"
      />
      <Row
        k="WEIGHT / SPRINGS"
        v={`F ${split.front}% · R ${split.rear}%`}
        sub={`springs F ${formatNumber(springs.front, 1)} · R ${formatNumber(springs.rear, 1)}`}
      />

      <AppliedSection preview={physics} />
    </Panel>
  );
});

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 6,
  },
  heroRight: {
    alignItems: 'flex-end',
  },
  heroValue: {
    fontSize: 38,
    lineHeight: 46,
    color: colors.white,
  },
  heroUnit: {
    fontSize: 12,
    color: colors.cyan,
    letterSpacing: 2,
  },
  liftValue: {
    fontSize: 18,
    letterSpacing: 1,
    marginBottom: 6,
  },
  warn: {
    fontSize: 11,
    color: colors.magenta,
    marginBottom: 6,
  },
  versus: {
    marginVertical: 8,
    gap: 6,
  },
  versusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  versusLabel: {
    width: 38,
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 1.2,
  },
  versusMeter: {
    flex: 1,
  },
  versusValue: {
    width: 44,
    textAlign: 'right',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    gap: 12,
  },
  k: {
    fontSize: 10,
    letterSpacing: 1.4,
    color: colors.textDim,
    paddingTop: 2,
  },
  vBlock: {
    alignItems: 'flex-end',
    flexShrink: 1,
  },
  v: {
    fontSize: 15,
    color: colors.text,
  },
  sub: {
    fontSize: 11,
    color: colors.textFaint,
    marginTop: 1,
  },
  applied: {
    marginTop: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: alpha(colors.cyan, 0.18),
    backgroundColor: alpha(colors.bg, 0.6),
  },
  appliedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  appliedTitle: {
    fontSize: 11,
    letterSpacing: 2,
    color: colors.text,
  },
  appliedGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
  },
  appliedCell: {
    width: '33.33%',
  },
  appliedValue: {
    fontSize: 13,
    color: colors.text,
    marginTop: 1,
  },
});
