import { parseArgs } from 'node:util';
import { DEFAULT_SERVER_PORT, HEARTBEAT_INTERVAL_MS } from '../../shared/protocol';
import { RELAY_DEFAULTS } from './relay';

export interface CliOptions {
  port: number;
  host: string;
  heartbeatMs: number;
  quiet: boolean;
  help: boolean;
}

export const USAGE = `SquadHQ relay: WebSocket bridge between the SquadHQ dashboard and the racer.

Usage: npm start -- [options]

Options:
  --port <n>          TCP port (default: $SQUAD_PORT, then $PORT, then ${DEFAULT_SERVER_PORT})
  --host <addr>       Bind address (default: ${RELAY_DEFAULTS.host}, i.e. reachable over the LAN)
  --heartbeat <ms>    WebSocket ping interval (default: ${HEARTBEAT_INTERVAL_MS})
  -q, --quiet         Only print the banner, warnings and errors
  -h, --help          Show this help
`;

export class UsageError extends Error {
  override name = 'UsageError';
}

function parsePort(raw: string, source: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new UsageError(`${source} must be an integer between 0 and 65535 (got "${raw}")`);
  }
  return port;
}

/** Precedence for the port: --port, then SQUAD_PORT, then PORT, then DEFAULT_SERVER_PORT. */
export function resolveCliOptions(argv: readonly string[], env: NodeJS.ProcessEnv): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        port: { type: 'string' },
        host: { type: 'string' },
        heartbeat: { type: 'string' },
        quiet: { type: 'boolean', short: 'q', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    throw new UsageError((err as Error).message);
  }

  let port = DEFAULT_SERVER_PORT;
  if (values.port !== undefined) port = parsePort(values.port, '--port');
  else if (env.SQUAD_PORT) port = parsePort(env.SQUAD_PORT, 'SQUAD_PORT');
  else if (env.PORT) port = parsePort(env.PORT, 'PORT');

  let heartbeatMs = HEARTBEAT_INTERVAL_MS;
  if (values.heartbeat !== undefined) {
    heartbeatMs = Number(values.heartbeat);
    if (!Number.isInteger(heartbeatMs) || heartbeatMs < 100) {
      throw new UsageError(`--heartbeat must be an integer ≥ 100 ms (got "${values.heartbeat}")`);
    }
  }

  const host = values.host?.trim() || RELAY_DEFAULTS.host;
  return { port, host, heartbeatMs, quiet: values.quiet, help: values.help };
}
