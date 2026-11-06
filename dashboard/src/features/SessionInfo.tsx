import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatKmh, formatNumber } from '../lib/format';
import { DEFAULT_CAR_LOOK, describeCar, describeMap } from '../squad/garage';
import { useConnection, useGameLink, usePlaySession } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Badge } from '../ui/Badge';
import { Txt } from '../ui/Txt';

function AccentBar({ color, tall = false }: { color: string; tall?: boolean }) {
  return <View style={[tall ? styles.barTall : styles.bar, { backgroundColor: color, shadowColor: color }]} />;
}

/**
 * Connection card's "ON TRACK" block: the car and map the game reports, which every preview and
 * verdict on the screen is computed for.
 */
export const NowPlaying = memo(function NowPlaying() {
  const session = usePlaySession();
  const online = useConnection((s) => s.status === 'online');
  const games = useGameLink((s) => s.peers?.game ?? 0);
  const car = describeCar(session.carId);
  const map = describeMap(session.trackId);

  let status: { label: string; color: string; filled: boolean };
  if (session.source === 'default') status = { label: 'DEFAULT', color: colors.textDim, filled: false };
  else if (online && games > 0) status = { label: 'LIVE', color: colors.green, filled: true };
  else status = { label: 'LAST KNOWN', color: colors.textDim, filled: false };

  const carSub = car.known
    ? `${car.drive} · GRIP ${formatNumber(car.carClass.traction, 2)} μ`
    : `UNKNOWN CAR · PREVIEWED AS ${DEFAULT_CAR_LOOK.name.toUpperCase()}`;
  const mapNotes: string[] = [];
  mapNotes.push(session.bigJumpKmh === null ? 'NO BIG JUMP' : `BIG JUMP · LIP ${formatKmh(session.bigJumpKmh)} KM/H`);
  if (map.surfaceGrip !== undefined) mapNotes.push(`ICE · ${Math.round(map.surfaceGrip * 100)} % GRIP`);

  return (
    <View style={styles.block} testID="now-playing">
      <View style={styles.header}>
        <Txt style={styles.k}>ON TRACK</Txt>
        <Badge label={status.label} color={status.color} filled={status.filled} testID="session-status" />
      </View>
      <View style={styles.rows}>
        <View style={styles.row}>
          <AccentBar color={car.accent} tall />
          <View style={styles.text}>
            <Txt
              font="display"
              style={[styles.carName, { color: car.accent }, glow(car.accent, 8)]}
              numberOfLines={1}
              testID="session-car"
            >
              {car.name.toUpperCase()}
            </Txt>
            <Txt style={styles.sub} numberOfLines={1}>
              {carSub}
            </Txt>
          </View>
        </View>
        <View style={styles.row}>
          <AccentBar color={map.accent} tall />
          <View style={styles.text}>
            <Txt font="display" style={styles.mapName} numberOfLines={1} testID="session-map">
              {map.name.toUpperCase()}
            </Txt>
            <Txt
              style={[styles.sub, { color: session.bigJumpKmh === null ? colors.textDim : colors.yellow }]}
              numberOfLines={1}
              testID="session-jump"
            >
              {mapNotes.join(' · ')}
            </Txt>
          </View>
        </View>
      </View>
      {session.source === 'default' ? (
        <Txt style={styles.note}>No game has reported yet: previews use the Neon Hypercar on GamerFleet Chaos.</Txt>
      ) : null}
    </View>
  );
});

/** One-line "car · map" reminder at the top of a readout card. */
export const SessionLine = memo(function SessionLine({ testID }: { testID?: string }) {
  const session = usePlaySession();
  const car = describeCar(session.carId);
  const map = describeMap(session.trackId);
  return (
    <View style={styles.line} testID={testID}>
      <AccentBar color={car.accent} />
      <Txt font="display" style={[styles.lineCar, { color: car.accent }]} numberOfLines={1}>
        {car.name.toUpperCase()}
      </Txt>
      <Txt style={styles.lineOn}>ON</Txt>
      <AccentBar color={map.accent} />
      <Txt font="display" style={styles.lineMap} numberOfLines={1}>
        {map.name.toUpperCase()}
      </Txt>
    </View>
  );
});

const styles = StyleSheet.create({
  block: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineBright,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  k: {
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.textDim,
  },
  /** Car above map on a phone; side by side once the card is wide enough (tablet / desktop). */
  rows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    columnGap: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexGrow: 1,
    flexBasis: 280,
  },
  bar: {
    width: 3,
    height: 12,
    shadowOpacity: 0.9,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  barTall: {
    width: 4,
    height: 32,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  carName: {
    fontSize: 16,
    letterSpacing: 1.6,
  },
  mapName: {
    fontSize: 13,
    letterSpacing: 1.4,
    color: colors.white,
  },
  sub: {
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textDim,
    marginTop: 2,
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.textFaint,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: alpha(colors.lineBright, 0.9),
    backgroundColor: alpha(colors.bg, 0.5),
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  lineCar: {
    fontSize: 10,
    letterSpacing: 1.2,
    flexShrink: 1,
  },
  lineOn: {
    fontSize: 10,
    color: colors.textFaint,
    letterSpacing: 1,
  },
  lineMap: {
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.text,
    flexShrink: 1,
  },
});
