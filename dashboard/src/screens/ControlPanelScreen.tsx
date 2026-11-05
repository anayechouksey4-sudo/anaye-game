import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BigJumpCard } from '../features/BigJumpCard';
import { ConnectionCard } from '../features/ConnectionCard';
import { ControlSliderCard } from '../features/ControlSliderCard';
import { PresetsCard } from '../features/PresetsCard';
import { TelemetryPanel } from '../features/TelemetryPanel';
import { TunePreviewCard } from '../features/TunePreviewCard';
import { colors } from '../theme';
import { Background } from '../ui/Background';
import { Header } from '../ui/Header';
import { Txt } from '../ui/Txt';

const TWO_COLUMN_MIN_WIDTH = 900;
const GAP = 14;

function Controls() {
  return (
    <>
      <ControlSliderCard controlKey="frontWingAero" index={1} accent={colors.cyan} />
      <ControlSliderCard controlKey="engineTier" index={2} accent={colors.magenta} />
      <ControlSliderCard controlKey="chassisBalance" index={3} accent={colors.yellow} />
      <PresetsCard />
    </>
  );
}

function Readouts() {
  return (
    <>
      <BigJumpCard />
      <TunePreviewCard />
      <TelemetryPanel />
    </>
  );
}

/**
 * The single SquadHQ screen. Phone: one column (link → sliders → presets → jump → preview → telemetry).
 * Tablet landscape / desktop web: controls left, readouts right.
 */
export function ControlPanelScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= TWO_COLUMN_MIN_WIDTH;

  return (
    <View style={styles.root}>
      <Background />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 },
          ]}
          keyboardShouldPersistTaps="handled"
          indicatorStyle="white"
        >
          <View style={[styles.frame, wide ? styles.frameWide : styles.frameNarrow]}>
            <Header />
            <ConnectionCard />
            {wide ? (
              <View style={styles.columns}>
                <View style={styles.column}>
                  <Controls />
                </View>
                <View style={styles.column}>
                  <Readouts />
                </View>
              </View>
            ) : (
              <>
                <Controls />
                <Readouts />
              </>
            )}
            <Txt style={styles.footer}>SQUADHQ · GAMERFLEET RACING DIVISION · ALL VALUES BROADCAST LIVE</Txt>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: 'center',
  },
  frame: {
    width: '100%',
    gap: GAP,
  },
  frameNarrow: {
    maxWidth: 560,
  },
  frameWide: {
    maxWidth: 1180,
  },
  columns: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: GAP,
  },
  column: {
    flex: 1,
    gap: GAP,
  },
  footer: {
    marginTop: 8,
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.textFaint,
    textAlign: 'center',
  },
});
