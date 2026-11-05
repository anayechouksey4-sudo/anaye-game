// Per-weight subpath imports so only the four faces in use get bundled.
import { Orbitron_500Medium } from '@expo-google-fonts/orbitron/500Medium';
import { Orbitron_700Bold } from '@expo-google-fonts/orbitron/700Bold';
import { Orbitron_900Black } from '@expo-google-fonts/orbitron/900Black';
import { ShareTechMono_400Regular } from '@expo-google-fonts/share-tech-mono/400Regular';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { defaultServerUrl } from './net/serverUrl';
import { loadLinkPrefs, saveLinkPrefs, type LinkPrefs } from './lib/storage';
import { ControlPanelScreen } from './screens/ControlPanelScreen';
import { SquadController } from './squad/controller';
import { SquadProvider } from './squad/SquadContext';
import { colors } from './theme';
import { FontsReadyContext } from './ui/Txt';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Don't hold the splash forever if a font download stalls (e.g. phone offline from the internet). */
const FONT_TIMEOUT_MS = 4000;

function guessServerUrl(): string {
  const webHostname = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.hostname : null;
  return defaultServerUrl({ hostUri: Constants.expoConfig?.hostUri ?? null, webHostname });
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Orbitron_500Medium,
    Orbitron_700Bold,
    Orbitron_900Black,
    ShareTechMono_400Regular,
  });
  const [fontTimedOut, setFontTimedOut] = useState(false);
  const [prefs, setPrefs] = useState<LinkPrefs | null>(null);
  const [controller] = useState(() => new SquadController({ clientName: `SquadHQ ${Platform.OS}` }));

  useEffect(() => {
    let alive = true;
    loadLinkPrefs().then((loaded) => alive && setPrefs(loaded));
    const timer = setTimeout(() => setFontTimedOut(true), FONT_TIMEOUT_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  const initialUrl = useMemo(() => prefs?.url ?? guessServerUrl(), [prefs]);

  // Auto-connect unless the user's last action was Disconnect. dispose() on cleanup closes the socket
  // and timers; connect() revives the same controller if the effect runs again (fast refresh).
  useEffect(() => {
    if (!prefs) return;
    if (prefs.autoConnect) controller.connect(initialUrl);
    return () => controller.dispose();
  }, [controller, prefs, initialUrl]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') controller.wake();
    });
    return () => sub.remove();
  }, [controller]);

  const contextValue = useMemo(
    () => ({
      controller,
      initialUrl,
      rememberLink: (url: string, autoConnect: boolean) => {
        void saveLinkPrefs({ url, autoConnect });
      },
    }),
    [controller, initialUrl],
  );

  const fontsReady = fontsLoaded && !fontError;
  const ready = prefs !== null && (fontsLoaded || fontError !== null || fontTimedOut);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return (
    <SafeAreaProvider style={styles.root}>
      <StatusBar style="light" />
      {ready ? (
        <FontsReadyContext.Provider value={fontsReady}>
          <SquadProvider value={contextValue}>
            <ControlPanelScreen />
          </SquadProvider>
        </FontsReadyContext.Provider>
      ) : (
        <View style={styles.root} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
