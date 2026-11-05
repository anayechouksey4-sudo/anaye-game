import { parseArgs, type ParseArgsConfig } from 'node:util';
import { DEFAULT_TOOL_URL } from './client';

type Options = NonNullable<ParseArgsConfig['options']>;

const COMMON = {
  url: { type: 'string', default: DEFAULT_TOOL_URL },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies Options;

/** parseArgs with the shared `--url` / `--help` flags; prints usage and exits on bad input. */
export function parseToolArgs<const O extends Options>(usage: string, extra: O, allowPositionals = false) {
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      options: { ...COMMON, ...extra },
      strict: true,
      allowPositionals,
    });
    if ((parsed.values as { help?: boolean }).help) {
      console.log(usage);
      process.exit(0);
    }
    return parsed;
  } catch (err) {
    console.error(`error: ${(err as Error).message}\n\n${usage}`);
    process.exit(2);
  }
}

export function numberArg(raw: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    console.error(`error: --${name} must be a number between ${min} and ${max} (got "${raw}")`);
    process.exit(2);
  }
  return value;
}

/** Ends the process on Ctrl+C / SIGTERM or after `durationSec` (0 = run forever). */
export function onStop(durationSec: number, stop: (reason: string) => void): void {
  let stopping = false;
  const once = (reason: string): void => {
    if (stopping) process.exit(1);
    stopping = true;
    stop(reason);
  };
  process.on('SIGINT', () => once('SIGINT'));
  process.on('SIGTERM', () => once('SIGTERM'));
  if (durationSec > 0) setTimeout(() => once(`${durationSec}s elapsed`), durationSec * 1000).unref();
}
