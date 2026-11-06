import Slider from '@react-native-community/slider';
import { memo, useCallback, useMemo, useRef } from 'react';
import { Platform, StyleSheet, View, type KeyDownEvent, type KeyUpEvent } from 'react-native';

import {
  DEFAULT_SQUAD_CONTROLS,
  SQUAD_CONTROL_SPECS,
  balanceToSuspensionStiffness,
  describeChassisBalance,
  driveForceN,
  getCarClass,
  mapSquadControlsToPhysics,
  snapToSpec,
  type CarClass,
  type RangeSpec,
  type SquadControlKey,
} from '../../../shared/protocol';
import { formatBalance, formatNumber, formatSigned } from '../lib/format';
import { hapticForChange, playHaptic } from '../lib/haptics';
import type { SliderPhase } from '../squad/controller';
import { useControls, useGameLink, useSquad } from '../squad/SquadContext';
import { alpha, colors, glow } from '../theme';
import { Badge } from '../ui/Badge';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

/** Horizontal distance from the slider's edge to the thumb centre at min/max, per platform. */
const TRACK_INSET = Platform.select({ ios: 15, android: 16, default: 10 });
const TICK_LABEL_WIDTH = 56;
/**
 * @react-native-community/slider treats a falsy `value` as "not set": natively the thumb may stay put,
 * and on web a 0 initial value falls back to minimumValue (Chassis Balance would render at −50).
 * A sub-step nudge is rounded back to exactly 0 by both implementations.
 */
const sliderValue = (v: number) => (v === 0 ? 1e-9 : v);

/** Aero % at which the car's front wing exactly cancels its body lift (below it the nose nets lift at speed). */
function aeroLiftThreshold(car: Readonly<CarClass>): number {
  const full = mapSquadControlsToPhysics({ ...DEFAULT_SQUAD_CONTROLS, frontWingAero: 100 }, car).frontDownforce;
  return full > 0 ? Math.min(100, (car.frontBodyLift / full) * 100) : 100;
}

/** The car class of the current session (a stable CAR_CLASSES reference, so it is a safe selector result). */
const useSessionCar = (): Readonly<CarClass> => useGameLink((s) => getCarClass(s.session.carId));

interface Mark {
  value: number;
  label: string;
  major?: boolean;
  color?: string;
}

const MARKS: { readonly [K in SquadControlKey]: readonly Mark[] } = {
  frontWingAero: [
    { value: 0, label: '0' },
    { value: 25, label: '25' },
    { value: 50, label: '50' },
    { value: 75, label: '75' },
    { value: 100, label: '100' },
  ],
  engineTier: [1, 2, 3, 4, 5].map((t) => ({ value: t, label: `T${t}`, major: true })),
  chassisBalance: [
    { value: -50, label: 'F50' },
    { value: -25, label: '25' },
    { value: 0, label: '0', major: true, color: colors.yellow },
    { value: 25, label: '25' },
    { value: 50, label: 'R50' },
  ],
};

const pct = (value: number, spec: RangeSpec) => ((value - spec.min) / (spec.max - spec.min)) * 100;

function Ticks({ marks, spec, value, accent }: { marks: readonly Mark[]; spec: RangeSpec; value: number; accent: string }) {
  return (
    <View style={styles.ticks} pointerEvents="none">
      {marks.map((mark) => {
        const active = spec.step >= 1 && marks.length <= 5 && mark.major && mark.value === value;
        const color = active ? accent : (mark.color ?? colors.textFaint);
        return (
          <View key={mark.value} style={[styles.tick, { left: `${pct(mark.value, spec)}%` }]}>
            <Txt
              font={mark.major ? 'display' : 'mono'}
              style={[styles.tickLabel, { color }, active ? glow(accent, 8) : null, mark.major ? styles.tickMajor : null]}
            >
              {mark.label}
            </Txt>
            <View style={[styles.tickLine, { backgroundColor: color, height: mark.major ? 8 : 5 }]} />
          </View>
        );
      })}
    </View>
  );
}

/** Below-track zone marking where the front wing loses to body lift. */
function LiftZone({ car }: { car: Readonly<CarClass> }) {
  const spec = SQUAD_CONTROL_SPECS.frontWingAero;
  const threshold = aeroLiftThreshold(car);
  // The label sits left of the threshold, over the zone; a short zone (the formula car's 13 %) puts it to the right.
  const labelRight = threshold < 35;
  return (
    <View style={styles.zoneRow} pointerEvents="none" testID="lift-zone">
      <View style={[styles.zone, { width: `${pct(threshold, spec)}%` }]} />
      <Txt style={[styles.zoneLabel, labelRight ? styles.zoneLabelRight : null, { left: `${pct(threshold, spec)}%` }]}>
        {`◂ NET LIFT < ${Math.round(threshold)}%`}
      </Txt>
    </View>
  );
}

function Readout({ controlKey, value, accent }: { controlKey: SquadControlKey; value: number; accent: string }) {
  let main: string;
  let suffix = '';
  if (controlKey === 'engineTier') {
    main = `T${value}`;
    suffix = '/5';
  } else if (controlKey === 'chassisBalance') {
    main = formatBalance(value);
    suffix = value < 0 ? 'FRONT' : value > 0 ? 'REAR' : 'NEUTRAL';
  } else {
    main = String(value);
    suffix = '%';
  }
  return (
    <View style={styles.readout}>
      <Txt font="display" style={[styles.readoutValue, { color: colors.white }, glow(accent, 16)]} testID={`readout-${controlKey}`}>
        {main}
      </Txt>
      <Txt font="display" style={[styles.readoutSuffix, { color: accent }]}>
        {suffix}
      </Txt>
    </View>
  );
}

function Detail({ items }: { items: { k: string; v: string; color?: string }[] }) {
  return (
    <View style={styles.detail}>
      {items.map((item) => (
        <View key={item.k} style={styles.detailCell}>
          <Txt style={styles.detailK}>{item.k}</Txt>
          <Txt style={[styles.detailV, item.color ? { color: item.color } : null]}>{item.v}</Txt>
        </View>
      ))}
    </View>
  );
}

function detailFor(key: SquadControlKey, value: number, car: Readonly<CarClass>): { k: string; v: string; color?: string }[] {
  const physics = mapSquadControlsToPhysics({ ...DEFAULT_SQUAD_CONTROLS, [key]: value }, car);
  switch (key) {
    case 'frontWingAero': {
      const net = physics.frontDownforce - car.frontBodyLift;
      return [
        { k: 'WING k', v: formatNumber(physics.frontDownforce, 2) },
        { k: 'NET FRONT', v: `${formatSigned(net, 2)} ${net < 0 ? 'LIFT' : 'DOWN'}`, color: net < 0 ? colors.magenta : colors.green },
        { k: 'DRAG k', v: formatNumber(physics.drag, 2) },
      ];
    }
    case 'engineTier':
      return [
        { k: car.frontDriveShare > 0 ? 'AWD TORQUE' : 'REAR TORQUE', v: `${formatNumber(physics.engineTorque)} N·m` },
        { k: 'DRIVE', v: `${formatNumber(driveForceN(physics, car))} N` },
        { k: 'MASS', v: `${formatNumber(physics.mass)} kg` },
      ];
    case 'chassisBalance': {
      const split = describeChassisBalance(value, car);
      const springs = balanceToSuspensionStiffness(physics.balance, car);
      return [
        { k: 'WEIGHT F/R', v: `${split.front} / ${split.rear} %` },
        { k: 'SPRINGS F/R', v: `${formatNumber(springs.front, 1)} / ${formatNumber(springs.rear, 1)}` },
      ];
    }
  }
}

/** Keyboard support for the web build (the community slider's web component has none). */
function keyTarget(key: string, current: number, spec: RangeSpec): number | null {
  const big = Math.max(spec.step, (spec.max - spec.min) / 10);
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return current + spec.step;
    case 'ArrowLeft':
    case 'ArrowDown':
      return current - spec.step;
    case 'PageUp':
      return current + big;
    case 'PageDown':
      return current - big;
    case 'Home':
      return spec.min;
    case 'End':
      return spec.max;
    default:
      return null;
  }
}

interface ControlSliderCardProps {
  controlKey: SquadControlKey;
  index: number;
  accent: string;
}

export const ControlSliderCard = memo(function ControlSliderCard({ controlKey, index, accent }: ControlSliderCardProps) {
  const { controller } = useSquad();
  const spec = SQUAD_CONTROL_SPECS[controlKey];
  const value = useControls((s) => s.values[controlKey]);
  const position = useControls((s) => s.positions[controlKey]);
  const dragging = useControls((s) => s.dragging[controlKey]);
  const car = useSessionCar();
  const inGesture = useRef(false);

  const change = useCallback(
    (raw: number, phase: SliderPhase) => {
      const next = snapToSpec(raw, spec);
      if (phase === 'move' || phase === 'step') {
        const haptic = hapticForChange(controlKey, controller.controls.getState().values[controlKey], next);
        if (haptic) playHaptic(haptic);
      }
      controller.setControl(controlKey, next, phase);
    },
    [controller, controlKey, spec],
  );

  const webKeyboard = useMemo(() => {
    if (Platform.OS !== 'web') return null;
    return {
      focusable: true,
      onKeyDown: (event: KeyDownEvent) => {
        const target = keyTarget(event.nativeEvent.key, controller.controls.getState().values[controlKey], spec);
        if (target === null) return;
        event.preventDefault();
        change(target, 'step');
      },
      onKeyUp: (event: KeyUpEvent) => {
        if (keyTarget(event.nativeEvent.key, 0, spec) === null) return;
        change(controller.controls.getState().values[controlKey], 'commit');
      },
    };
  }, [change, controller, controlKey, spec]);

  const display =
    controlKey === 'engineTier' ? `Tier ${value}` : controlKey === 'chassisBalance' ? formatBalance(value) : `${value} percent`;

  return (
    <Panel
      title={spec.label.toUpperCase()}
      tag={String(index).padStart(2, '0')}
      accent={accent}
      testID={`card-${controlKey}`}
      right={dragging ? <Badge label="TX LIVE" color={accent} filled /> : null}
    >
      <View style={styles.top}>
        <Readout controlKey={controlKey} value={value} accent={accent} />
        <Txt style={styles.range}>{`${spec.min}…${spec.max}${spec.unit}`}</Txt>
      </View>

      <View style={styles.sliderBlock}>
        <View style={{ marginHorizontal: TRACK_INSET }}>
          <Ticks marks={MARKS[controlKey]} spec={spec} value={value} accent={accent} />
        </View>
        {controlKey === 'chassisBalance' ? (
          <View pointerEvents="none" style={[styles.centerNotch, { left: TRACK_INSET, right: TRACK_INSET }]}>
            <View style={styles.centerNotchLine} />
          </View>
        ) : null}
        <Slider
          testID={`slider-${controlKey}`}
          accessibilityLabel={spec.label}
          accessibilityHint={spec.description}
          accessibilityValue={{ min: spec.min, max: spec.max, now: value, text: display }}
          style={styles.slider}
          minimumValue={spec.min}
          maximumValue={spec.max}
          step={spec.step}
          value={sliderValue(position)}
          minimumTrackTintColor={accent}
          maximumTrackTintColor={alpha(colors.lineBright, 0.9)}
          thumbTintColor={accent}
          tapToSeek
          onSlidingStart={(v) => {
            inGesture.current = true;
            change(v, 'start');
          }}
          onValueChange={(v) => change(v, inGesture.current ? 'move' : 'step')}
          onSlidingComplete={(v) => {
            inGesture.current = false;
            change(v, 'commit');
          }}
          {...webKeyboard}
        />
        {controlKey === 'frontWingAero' ? (
          <View style={{ marginHorizontal: TRACK_INSET }}>
            <LiftZone car={car} />
          </View>
        ) : null}
      </View>

      <Txt style={styles.description}>{spec.description}</Txt>
      <Detail items={detailFor(controlKey, value, car)} />
    </Panel>
  );
});

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  readout: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  readoutValue: {
    fontSize: 46,
    lineHeight: 54,
    letterSpacing: 1,
  },
  readoutSuffix: {
    fontSize: 13,
    letterSpacing: 2,
  },
  range: {
    fontSize: 11,
    color: colors.textFaint,
    marginBottom: 10,
  },
  sliderBlock: {
    marginTop: 6,
  },
  ticks: {
    height: 26,
  },
  tick: {
    position: 'absolute',
    width: TICK_LABEL_WIDTH,
    marginLeft: -TICK_LABEL_WIDTH / 2,
    bottom: 0,
    alignItems: 'center',
  },
  tickLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  tickMajor: {
    fontSize: 11,
    letterSpacing: 1,
  },
  tickLine: {
    width: 1,
  },
  centerNotch: {
    position: 'absolute',
    top: 18,
    height: 56,
    alignItems: 'center',
  },
  centerNotchLine: {
    width: 2,
    height: '100%',
    backgroundColor: alpha(colors.yellow, 0.55),
  },
  slider: {
    height: 44,
    width: '100%',
  },
  zoneRow: {
    height: 18,
    marginTop: 2,
  },
  zone: {
    height: 3,
    backgroundColor: alpha(colors.magenta, 0.55),
  },
  zoneLabel: {
    position: 'absolute',
    top: 5,
    marginLeft: -96,
    width: 160,
    fontSize: 10,
    color: colors.magenta,
    letterSpacing: 0.5,
  },
  zoneLabelRight: {
    marginLeft: 4,
  },
  description: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
  },
  detail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lineBright,
    rowGap: 8,
  },
  detailCell: {
    minWidth: '33%',
    flexGrow: 1,
  },
  detailK: {
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 1.2,
  },
  detailV: {
    fontSize: 15,
    color: colors.text,
    marginTop: 2,
  },
});
