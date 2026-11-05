import { parseArgs, type ParseArgsConfig } from 'node:util';
import { DEFAULT_TOOL_URL } from './client';

type Options = NonNullable<ParseArgsConfig['options']>;

const COMMON = {
  url: { type: 'string', default: DEFAULT_TOOL_URL },
  help: { type: 'boolean', short: 'h', default: false },
} as const satisfies Options;

const NEGATIVE_NUMBER = /^-(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * parseArgs reads `-10` as a short flag, but `send controls 80 4 -10` must work. Move every
 * positional (negative numbers included) behind a `--`, keeping flags and their values in front.
 */
function separatePositionals(args: readonly string[], options: Options): string[] {
  const flags: string[] = [];
  const positionals: string[] = [];
  const takesValue = (arg: string): boolean => {
    if (arg.includes('=')) return false;
    const option = arg.startsWith('--')
      ? options[arg.slice(2)]
      : Object.values(options).find((o) => o.short === arg.slice(1));
    return option?.type === 'string';
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('-') && arg !== '-' && !NEGATIVE_NUMBER.test(arg)) {
      flags.push(arg);
      const value = args[i + 1];
      if (takesValue(arg) && value !== undefined) {
        flags.push(value);
        i += 1;
      }
      continue;
    }
    positionals.push(arg);
  }
  return [...flags, '--', ...positionals];
}

/** parseArgs with the shared `--url` / `--help` flags; prints usage and exits on bad input. */
export function parseToolArgs<const O extends Options>(usage: string, extra: O, allowPositionals = false) {
  const options = { ...COMMON, ...extra };
  const argv = process.argv.slice(2);
  try {
    const parsed = parseArgs({
      args: allowPositionals ? separatePositionals(argv, options) : argv,
      options,
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
