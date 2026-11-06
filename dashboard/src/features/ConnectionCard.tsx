import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { parseServerUrlInput } from '../net/serverUrl';
import { useNow } from '../lib/useNow';
import { useConnection, useGameLink, useSquad } from '../squad/SquadContext';
import { describeLinkStatus } from '../squad/linkStatus';
import { alpha, colors, glow } from '../theme';
import { Badge } from '../ui/Badge';
import { NeonButton } from '../ui/NeonButton';
import { Panel } from '../ui/Panel';
import { Txt, useFontStyle } from '../ui/Txt';
import { NowPlaying } from './SessionInfo';

function StatusReadout() {
  const status = useConnection((s) => s.status);
  const retryAt = useConnection((s) => s.retryAt);
  const latency = useConnection((s) => s.latencyMs);
  const now = useNow(250, status === 'retrying');
  const look = describeLinkStatus(status, retryAt, now);
  return (
    <View style={styles.statusCell}>
      <Txt style={styles.k}>STATUS</Txt>
      <Txt font="display" style={[styles.status, { color: look.color }, glow(look.color, 8)]} testID="link-status" numberOfLines={1}>
        {look.label}
      </Txt>
      <Txt style={styles.latency} testID="link-latency">
        {status === 'online' && latency !== null ? `${latency} ms` : '—'}
      </Txt>
    </View>
  );
}

function PeersReadout() {
  const online = useConnection((s) => s.status === 'online');
  const clientId = useConnection((s) => s.clientId);
  const games = useGameLink((s) => s.peers?.game ?? 0);
  const dashboards = useGameLink((s) => s.peers?.dashboard ?? 0);
  if (!online) return null;
  return (
    <View style={styles.peers}>
      {games > 0 ? (
        <Badge label={`GAME LINKED ×${games}`} color={colors.green} filled testID="game-linked" />
      ) : (
        <Badge label="NO GAME LINKED" color={colors.magenta} testID="game-linked" />
      )}
      <Txt style={styles.peerNote}>{`DASHBOARDS ×${dashboards}${clientId ? ` · NODE ${clientId}` : ''}`}</Txt>
    </View>
  );
}

export function ConnectionCard() {
  const { controller, initialUrl, rememberLink } = useSquad();
  const status = useConnection((s) => s.status);
  const url = useConnection((s) => s.url);
  const error = useConnection((s) => s.error);
  const serverError = useConnection((s) => s.serverError);
  const [draft, setDraft] = useState(url ?? initialUrl);
  const [inputError, setInputError] = useState<string | null>(null);
  const monoFont = useFontStyle('mono');

  // Show the normalized form once a connect goes through (e.g. "192.168.1.5" → "ws://192.168.1.5:8787").
  useEffect(() => {
    if (url) setDraft(url);
  }, [url]);

  const parsed = parseServerUrlInput(draft);
  const draftUrl = 'url' in parsed ? parsed.url : null;
  const showConnect = status === 'offline' || draftUrl !== url;

  const connect = () => {
    const result = parseServerUrlInput(draft);
    if ('error' in result) {
      setInputError(result.error);
      return;
    }
    setInputError(null);
    setDraft(result.url);
    rememberLink(result.url, true);
    controller.connect(result.url);
  };

  const disconnect = () => {
    if (url) rememberLink(url, false);
    controller.disconnect();
  };

  const transportError = status !== 'online' ? error : null;

  return (
    <Panel title="CONNECTION" tag="00" accent={colors.cyan} testID="connection-card">
      <Txt style={styles.k}>RELAY ADDRESS</Txt>
      <TextInput
        testID="server-url"
        value={draft}
        onChangeText={(text) => {
          setDraft(text);
          if (inputError) setInputError(null);
        }}
        onSubmitEditing={connect}
        placeholder="ws://192.168.1.23:8787"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="url"
        returnKeyType="go"
        inputMode="url"
        selectionColor={colors.cyan}
        accessibilityLabel="Relay server URL"
        style={[styles.input, monoFont]}
      />
      {inputError ? <Txt style={styles.error}>{inputError}</Txt> : null}
      <View style={styles.statusRow}>
        <StatusReadout />
        <NeonButton
          testID="connect-button"
          label={showConnect ? 'CONNECT' : 'DISCONNECT'}
          color={showConnect ? colors.cyan : colors.magenta}
          primary={showConnect}
          onPress={showConnect ? connect : disconnect}
          style={styles.connectButton}
        />
      </View>
      <PeersReadout />
      {transportError ? (
        <Txt style={styles.error} testID="link-error">
          {`! ${transportError}`}
        </Txt>
      ) : null}
      {serverError && status === 'online' ? <Txt style={styles.error}>{`! relay: ${serverError}`}</Txt> : null}
      <NowPlaying />
    </Panel>
  );
}

const styles = StyleSheet.create({
  k: {
    fontSize: 10,
    letterSpacing: 1.6,
    color: colors.textDim,
    marginBottom: 4,
  },
  v: {
    fontSize: 14,
    color: colors.text,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: alpha(colors.cyan, 0.35),
    backgroundColor: alpha(colors.bg, 0.85),
    color: colors.cyan,
    fontSize: 15,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    gap: 10,
  },
  statusCell: {
    flex: 1,
    minWidth: 0,
  },
  latency: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 2,
  },
  connectButton: {
    minWidth: 128,
  },
  status: {
    fontSize: 15,
    letterSpacing: 1.6,
  },
  peers: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  peerNote: {
    fontSize: 11,
    color: colors.textDim,
    letterSpacing: 1,
  },
  error: {
    marginTop: 8,
    fontSize: 12,
    color: colors.magenta,
  },
});
