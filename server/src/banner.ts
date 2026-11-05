import { PROTOCOL_VERSION } from '../../shared/protocol';
import { displayHost, type LanAddress } from './network';

export interface BannerInput {
  host: string;
  port: number;
  lan: readonly LanAddress[];
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '']);

/** The startup banner. The LAN URLs are what the user types into the phone. */
export function formatBanner({ host, port, lan }: BannerInput): string {
  const local = displayHost(host);
  const lines = [
    '',
    `  SquadHQ relay · protocol v${PROTOCOL_VERSION} · listening on ${host}:${port}`,
    '',
  ];
  if (!WILDCARD_HOSTS.has(host)) {
    lines.push(`  Bound to ${host} only. Use --host 0.0.0.0 to accept phones on the LAN.`);
  } else if (lan.length === 0) {
    lines.push('  No LAN IPv4 address found. Connect this machine to Wi-Fi so the phone can reach it.');
  } else {
    lines.push('  Enter one of these in the SquadHQ dashboard (phone on the same Wi-Fi):');
    const width = Math.max(...lan.map((a) => `ws://${a.address}:${port}`.length));
    for (const a of lan) lines.push(`    ws://${a.address}:${port}`.padEnd(width + 4) + `  (${a.interfaceName})`);
  }
  lines.push(
    '',
    `  Game on this machine:  ws://${local}:${port}/?role=game`,
    `  Health check:          http://${local}:${port}/health`,
    '',
    '  Ctrl+C to stop.',
    '',
  );
  return lines.join('\n');
}
