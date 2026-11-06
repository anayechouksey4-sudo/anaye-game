import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { squadControlsEqual } from '../../../shared/protocol';
import { formatKmh } from '../lib/format';
import { playHaptic } from '../lib/haptics';
import { presetsFor, type Preset } from '../squad/presets';
import { previewSetup, type PlaySession } from '../squad/session';
import { useControls, usePlaySession, useSquad } from '../squad/SquadContext';
import { colors } from '../theme';
import { NeonButton } from '../ui/NeonButton';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

const VERDICT_COLOR = { READY: colors.green, 'TOO SLOW': colors.yellow, 'NOSE LIFT': colors.magenta } as const;

interface PresetInfo {
  preset: Preset;
  summary: string;
  /** 'JUMP: READY', or the estimated top speed on a map without a big jump. */
  label: string;
  color: string;
}

/** The car's presets with their verdict on the current map. */
function presetInfoFor(session: Pick<PlaySession, 'carId' | 'bigJumpKmh'>): PresetInfo[] {
  return presetsFor(session.carId).map((preset) => {
    const { jump, topSpeedKmh } = previewSetup(preset.controls, session);
    const { frontWingAero, engineTier, chassisBalance } = preset.controls;
    return {
      preset,
      summary: `${frontWingAero}% · T${engineTier} · ${chassisBalance > 0 ? '+' : ''}${chassisBalance}`,
      label: jump ? `JUMP: ${jump.verdict}` : `TOP ~${formatKmh(topSpeedKmh)} KM/H`,
      color: jump ? VERDICT_COLOR[jump.verdict] : colors.cyan,
    };
  });
}

export const PresetsCard = memo(function PresetsCard() {
  const { controller } = useSquad();
  const values = useControls((s) => s.values);
  const session = usePlaySession();
  const presetInfo = useMemo(() => presetInfoFor(session), [session]);

  return (
    <Panel title="PRESETS" tag="04" accent={colors.yellow} testID="presets-card">
      <View style={styles.grid}>
        {presetInfo.map(({ preset, summary, label, color }) => {
          const active = squadControlsEqual(values, preset.controls);
          return (
            <NeonButton
              key={preset.id}
              testID={`preset-${preset.id}`}
              label={preset.name}
              color={colors.yellow}
              active={active}
              accessibilityLabel={`Preset ${preset.name}: ${summary}`}
              accessibilityHint={preset.blurb}
              onPress={() => {
                playHaptic('confirm');
                controller.applyPreset(preset.controls);
              }}
              style={styles.preset}
              labelStyle={styles.presetLabel}
              sublabel={
                <View style={styles.sub}>
                  <Txt style={styles.summary}>{summary}</Txt>
                  <Txt style={[styles.verdict, { color }]} testID={`preset-${preset.id}-verdict`}>
                    {label}
                  </Txt>
                </View>
              }
            />
          );
        })}
      </View>
      <NeonButton
        testID="reset-button"
        label="RESET TO DEFAULTS"
        color={colors.magenta}
        accessibilityHint="Front Wing Aero 50, Engine Tier 3, Chassis Balance 0"
        onPress={() => {
          playHaptic('notch');
          controller.reset();
        }}
        style={styles.reset}
      />
    </Panel>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  preset: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  presetLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
  },
  sub: {
    marginTop: 4,
    gap: 2,
  },
  summary: {
    fontSize: 12,
    color: colors.text,
  },
  verdict: {
    fontSize: 10,
    letterSpacing: 1,
  },
  reset: {
    marginTop: 10,
  },
});
