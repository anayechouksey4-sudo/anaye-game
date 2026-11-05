import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { assessBigJump, mapSquadControlsToPhysics, squadControlsEqual } from '../../../shared/protocol';
import { playHaptic } from '../lib/haptics';
import { PRESETS } from '../squad/presets';
import { useControls, useSquad } from '../squad/SquadContext';
import { colors } from '../theme';
import { NeonButton } from '../ui/NeonButton';
import { Panel } from '../ui/Panel';
import { Txt } from '../ui/Txt';

const VERDICT_COLOR = { READY: colors.green, 'TOO SLOW': colors.yellow, 'NOSE LIFT': colors.magenta } as const;

const PRESET_INFO = PRESETS.map((preset) => ({
  preset,
  verdict: assessBigJump(mapSquadControlsToPhysics(preset.controls)).verdict,
  summary: `${preset.controls.frontWingAero}% · T${preset.controls.engineTier} · ${preset.controls.chassisBalance > 0 ? '+' : ''}${preset.controls.chassisBalance}`,
}));

export const PresetsCard = memo(function PresetsCard() {
  const { controller } = useSquad();
  const values = useControls((s) => s.values);

  return (
    <Panel title="PRESETS" tag="04" accent={colors.yellow} testID="presets-card">
      <View style={styles.grid}>
        {PRESET_INFO.map(({ preset, verdict, summary }) => {
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
                  <Txt style={[styles.verdict, { color: VERDICT_COLOR[verdict] }]}>{`JUMP: ${verdict}`}</Txt>
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
