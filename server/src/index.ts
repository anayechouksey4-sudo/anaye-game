import { formatBanner } from './banner';
import { lanIPv4Addresses } from './network';
import { USAGE, UsageError, resolveCliOptions, type CliOptions } from './options';
import { createRelayServer, type RelayLogger } from './relay';

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function consoleLogger(quiet: boolean): RelayLogger {
  return {
    info: quiet ? () => {} : (line) => console.log(`${timestamp()} ${line}`),
    warn: (line) => console.warn(`${timestamp()} ${line}`),
  };
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = resolveCliOptions(process.argv.slice(2), process.env);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  let relay;
  try {
    relay = await createRelayServer({
      port: options.port,
      host: options.host,
      heartbeatMs: options.heartbeatMs,
      logger: consoleLogger(options.quiet),
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      console.error(`error: port ${options.port} is already in use. Is another relay running? Try --port <n>.`);
    } else if (e.code === 'EACCES') {
      console.error(`error: not allowed to listen on port ${options.port}. Pick a port above 1024.`);
    } else {
      console.error(`error: could not start the relay: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(formatBanner({ host: relay.host, port: relay.port, lan: lanIPv4Addresses() }));

  let stopping = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (stopping) {
      console.warn(`${timestamp()} second ${signal}, exiting immediately`);
      process.exit(1);
    }
    stopping = true;
    console.log(`${timestamp()} ${signal} received, closing connections…`);
    relay.close().then(
      () => {
        console.log(`${timestamp()} relay stopped`);
        process.exit(0);
      },
      (err: unknown) => {
        console.error(`${timestamp()} error during shutdown: ${(err as Error).message}`);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
