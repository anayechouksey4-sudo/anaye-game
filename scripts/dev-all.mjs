#!/usr/bin/env node
// SquadHQ one-command launcher.
//
//   npm run dev:all     install whatever is missing, then run relay + game + dashboard in this terminal
//   npm run start:all   same, but skip the install check
//   npm run setup       install only
//
// Flags: --fresh (delete node_modules and reinstall every package)  --only=relay,game,dashboard  --no-install  --setup-only
//
// Built to run unattended on a phone (Termux) as well as on a laptop:
//   - installs packages one at a time (three parallel npm installs can exhaust a phone's memory); the dashboard's
//     install, by far the slowest, runs inside the dashboard's own command so the relay and game start without it
//   - a failed server or game install skips that service instead of stopping everything
//   - preloads scripts/termux-netfix.cjs into every child so a blocked os.networkInterfaces() can't crash them
//   - finds the LAN address without netlink (UDP route lookup) and hands it to Expo
//   - spawns through a shell that exists on Android (there is no /bin/sh there)
//   - prints a summary of every URL as soon as the relay and game answer, and one more line when the dashboard does

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NETFIX = path.join(ROOT, 'scripts', 'termux-netfix.cjs');
const INSTALL_STAMP = '.squadhq-install-stamp';
const READY_TIMEOUT_MS = 5 * 60_000; // Metro's first start on a phone can be slow.
// Restarts per service for the whole session. A deferred install that fails is a failed run of its command like
// any other: it is retried (enough for a dropped connection) and then left down, never looped.
const RESTART_TRIES = 2;
const RESTART_DELAY_MS = 3000;
// How long the summary waits for an installed `slow` service once the others answer. On a phone Metro takes far longer
// than that to start, so the summary goes out at once there and the dashboard gets its own follow-up line.
const SLOW_GRACE_MS = process.platform === 'android' ? 0 : 10_000;
const STOP_GRACE_MS = 3000; // how long npm may take to stop after a signal before it is killed

// `slow`: Expo's install and Metro's first start can take many minutes on a phone. While another service is
// selected too, its install runs inside its own command (see installThenStart) and the summary doesn't wait for it.
/** @typedef {{ key: string, dir: string, port: number, color: string, npmArgs: string[], probePath: string, expect?: string, slow?: boolean }} Service */
/** @type {Service[]} */
const SERVICES = [
  {
    key: 'relay',
    dir: 'server',
    port: 8787,
    color: 'magenta',
    npmArgs: ['run', 'start', '--', '--port', '8787'],
    probePath: '/health',
  },
  {
    key: 'game',
    dir: 'game',
    port: 5173,
    color: 'cyan',
    npmArgs: ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173', '--strictPort'],
    probePath: '/',
  },
  {
    key: 'dashboard',
    dir: 'dashboard',
    port: 8081,
    color: 'yellow',
    npmArgs: ['run', 'start', '--', '--port', '8081'],
    probePath: '/status',
    expect: 'packager-status:running',
    slow: true,
  },
];
const ALIASES = { server: 'relay', dash: 'dashboard', expo: 'dashboard' };

const log = (message = '') => process.stdout.write(`\x1b[35m[dev:all]\x1b[0m ${message}\n`);
const warn = (message) => process.stderr.write(`\x1b[31m[dev:all] ${message}\x1b[0m\n`);
const fail = (message) => {
  warn(message);
  process.exit(1);
};

// ── npm ────────────────────────────────────────────────────────────────────────────────────

/** Run npm through the current Node binary when possible: no PATH, shebang or shell lookups involved. */
const npmCli = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : null;
const npmCommand = npmCli ? [process.execPath, npmCli] : [process.platform === 'win32' ? 'npm.cmd' : 'npm'];

/**
 * Runs npm while this process keeps handling signals: Ctrl+C, SIGTERM and SIGHUP are passed on, so npm never
 * outlives it. npm install takes the first signal as "roll back once idle", which can wait minutes for a stalled
 * download, so after a signal npm gets STOP_GRACE_MS to finish and is then killed. Resolves with npm's exit code,
 * or with the signal that stopped it.
 */
function runNpm(args, cwd, env = process.env) {
  const [file, ...prefix] = npmCommand;
  return new Promise((resolve) => {
    const child = spawn(file, [...prefix, ...args], { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' && !npmCli });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    let forwarded = null;
    let killTimer = null;
    const forward = (signal) => {
      forwarded = signal;
      child.kill(signal);
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
    };
    let settled = false;
    const done = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      for (const s of signals) process.off(s, forward);
      // A stop this process passed on, or a terminal stop signal, ends the launcher the way the user meant. Any other
      // death (SIGKILL from Android's low-memory or phantom-process killer) is a failed run the caller reports.
      const stop = forwarded ?? (signals.includes(signal) ? signal : null);
      resolve(stop ? { code, signal: stop } : { code: code ?? 1, signal: null, killedBy: signal ?? null });
    };
    for (const signal of signals) process.on(signal, forward);
    child.once('error', () => done(1, null));
    child.once('close', done);
  });
}

/** Ends this process the way a runNpm child ended: same exit code, or killed by the same signal. Never resolves. */
function exitLike({ code, signal }) {
  if (!signal) process.exit(code ?? 1);
  process.kill(process.pid, signal);
  setTimeout(() => process.exit(1), 1000); // only reached if the signal didn't end this process
  return new Promise(() => {});
}

function manifestHash(dir) {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'package-lock.json']) {
    const full = path.join(dir, file);
    hash.update(file).update(existsSync(full) ? readFileSync(full) : '');
  }
  return hash.digest('hex');
}

const stampPath = (dir) => path.join(dir, 'node_modules', INSTALL_STAMP);

/** Why `dir` needs an install, or null when node_modules matches its manifests. */
function installReason(dir) {
  const stamp = stampPath(dir);
  if (!existsSync(path.join(dir, 'node_modules'))) return 'no node_modules yet';
  if (!existsSync(stamp)) return 'first run of dev:all here';
  return readFileSync(stamp, 'utf8').trim() === manifestHash(dir) ? null : 'package.json / lockfile changed';
}

/** Installs `dir`'s dependencies if they are missing or stale. Resolves like runNpm (code 0 when up to date). */
async function ensureInstalled(dir, label, env, force) {
  const reason = force ? '--fresh' : installReason(dir);
  if (!reason) {
    log(`${label}: dependencies up to date`);
    return { code: 0, signal: null };
  }
  log(`${label}: installing dependencies (${reason}) …`);
  // A plain `npm install` keeps whatever is there, including a half-extracted tree from an interrupted install.
  if (force) rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
  const outcome = await runNpm(['install', '--no-audit', '--no-fund'], dir, env);
  if (outcome.killedBy) {
    warn(`npm was killed (${outcome.killedBy}) while installing ${label}/ — on Android usually the low-memory or phantom-process killer`);
  }
  if (outcome.code === 0 && !outcome.signal) {
    mkdirSync(path.join(dir, 'node_modules'), { recursive: true }); // a package with no dependencies gets none
    writeFileSync(stampPath(dir), manifestHash(dir));
  }
  return outcome;
}

/**
 * Hidden `--install-then-start=<dir>` mode: the whole command of a `slow` service whose install was deferred.
 * Installs if needed, then runs the service's start command as a child. It is that command's root process (the
 * shell `exec`s it) and stops whichever npm is running however the stop signal arrives: at the root only, at the
 * whole tree (concurrently's kill) or at the terminal's process group (Ctrl+C, closing the session).
 * A restart reruns it, but it only installs while the stamp is missing or stale: a restart after a failed install
 * retries it, a restart after a good one goes straight to the service. With --fresh the launcher deletes the stamp
 * before starting, so node_modules is deleted here, inside the service's own command, until a fresh install is done.
 */
async function installThenStart(dirName, fresh) {
  const service = SERVICES.find((s) => s.dir === dirName);
  if (!service) fail(`--install-then-start: unknown package ${dirName}`);
  const dir = path.join(ROOT, service.dir);
  const install = await ensureInstalled(dir, dirName, process.env, fresh && !existsSync(stampPath(dir)));
  if (install.signal) return install; // stopped by Ctrl+C or the launcher's shutdown
  if (install.code !== 0) {
    warn(`npm install failed in ${dirName}/ — see the error above.`);
    return install;
  }
  return runNpm(service.npmArgs, dir);
}

// ── network ────────────────────────────────────────────────────────────────────────────────

/** Address of the interface holding the default route. Uses no netlink, so it works where networkInterfaces() is blocked. */
function routedAddress() {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    let settled = false;
    const done = (ip) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      resolve(ip);
    };
    const timer = setTimeout(() => done(null), 1500);
    socket.on('error', () => done(null));
    try {
      // connect() on UDP only selects a route; nothing is sent.
      socket.connect(53, '8.8.8.8', () => {
        try {
          const { address } = socket.address();
          done(address && address !== '0.0.0.0' ? address : null);
        } catch {
          done(null);
        }
      });
    } catch {
      done(null);
    }
  });
}

async function detectLan() {
  let restricted = false;
  const candidates = [];
  try {
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) if (info.family === 'IPv4' && !info.internal) candidates.push(info.address);
    }
  } catch {
    restricted = true;
  }
  const routed = await routedAddress();
  const ip = routed && (restricted || candidates.includes(routed)) ? routed : (candidates[0] ?? routed ?? null);
  return { ip, restricted };
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function isAnswering(service) {
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}${service.probePath}`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return false;
    return service.expect ? (await response.text()).includes(service.expect) : true;
  } catch {
    return false;
  }
}

/** A POSIX shell that actually exists here — Android has no /bin/sh. */
function pickShell() {
  if (process.platform === 'win32') return undefined;
  const candidates = ['/bin/sh', process.env.PREFIX && path.join(process.env.PREFIX, 'bin', 'sh'), '/system/bin/sh'];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const quote = (value) => (/^[\w./:=@+-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`);

// ── output ─────────────────────────────────────────────────────────────────────────────────

/** [local URL, LAN URL] of a service, as shown in the summary. */
function serviceUrls(service, lan) {
  const lanHost = lan.ip ?? '127.0.0.1';
  const rows = {
    relay: [`ws://localhost:8787`, lan.ip ? `ws://${lan.ip}:8787` : ''],
    game: [`http://localhost:5173`, lan.ip ? `http://${lan.ip}:5173` : ''],
    dashboard: [`exp://${lanHost}:8081`, `web: http://localhost:8081`],
  };
  return rows[service.key];
}

const STATE_NOTES = {
  up: '',
  installing: '  (installing… it starts on its own when done)',
  starting: '  (starting…)',
  late: '  (not answering yet — check its log above)',
  stopped: '  (stopped — check its log above)',
  'install-failed': '  (npm install failed — see the error above)',
};

/** `states` maps each listed service to a STATE_NOTES key, or to 'skipped' when its install failed before start. */
function printSummary(services, lan, states) {
  const lanHost = lan.ip ?? '127.0.0.1';
  const waiting = services.filter((s) => states.get(s) === 'installing' || states.get(s) === 'starting');
  const live = services.filter((s) => states.get(s) === 'up');
  let title = 'ALL SYSTEMS LIVE';
  if (services.some((s) => !waiting.includes(s) && !live.includes(s))) title = 'PARTIALLY UP';
  else if (waiting.length) {
    const doing = waiting.some((s) => states.get(s) === 'installing') ? 'INSTALLING' : 'STARTING';
    title = `${live.map((s) => s.key).join(' + ')} LIVE — ${waiting.map((s) => s.key).join(' + ')} STILL ${doing}`.toUpperCase();
  }
  const line = '─'.repeat(72);
  const out = ['', line, ` SQUADHQ // ${title}`];
  for (const service of services) {
    const name = service.key.toUpperCase().padEnd(10);
    if (states.get(service) === 'skipped') {
      out.push(`   ${name} skipped: npm install failed — see the error above`);
      continue;
    }
    const [local, lanUrl] = serviceUrls(service, lan);
    out.push(`   ${name} ${local.padEnd(28)} ${lanUrl}${STATE_NOTES[states.get(service)]}`);
  }
  out.push('');
  out.push(' Game + dashboard connect to the relay on port 8787 of whichever host served them.');
  for (const service of waiting) {
    out.push(` The ${service.key} is still ${states.get(service)}: one more line with its URLs follows when it answers.`);
  }
  if (services.some((s) => s.key === 'dashboard' && states.get(s) !== 'skipped' && states.get(s) !== 'install-failed')) {
    out.push(` Dashboard on a phone: Expo Go → "Enter URL manually" → exp://${lanHost}:8081`);
  }
  const game = services.find((s) => s.key === 'game');
  if (process.platform === 'android' && game && ['up', 'starting', 'late'].includes(states.get(game))) {
    out.push(' Same phone: open http://localhost:5173 in Chrome; the dashboard can use ws://127.0.0.1:8787.');
  } else if (process.platform === 'android' && game) {
    out.push(' The game is not running (see above), so http://localhost:5173 would say "refused to connect".');
  }
  out.push(' Ctrl+C stops everything.');
  out.push(line, '');
  process.stdout.write(`\x1b[36m${out.join('\n')}\x1b[0m\n`);
}

// ── main ───────────────────────────────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    fresh: { type: 'boolean', default: false },
    only: { type: 'string' },
    'no-install': { type: 'boolean', default: false },
    'setup-only': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    'install-then-start': { type: 'string' }, // internal, see installThenStart
  },
});

if (flags['install-then-start']) await exitLike(await installThenStart(flags['install-then-start'], flags.fresh));

if (flags.help) {
  process.stdout.write(
    [
      'Usage: node scripts/dev-all.mjs [--fresh] [--only=relay,game,dashboard] [--no-install] [--setup-only]',
      '  npm run dev:all     install whatever is missing, then run everything in this terminal',
      '  npm run start:all   run everything without the install check',
      '  npm run setup       install only',
      '  --fresh             delete node_modules and reinstall every package (repairs an interrupted install)',
      '  --only=relay,game   run only some services, e.g. skip the dashboard on a slow phone',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

let selected = SERVICES;
if (flags.only) {
  const wanted = flags.only.split(',').map((name) => ALIASES[name.trim()] ?? name.trim());
  const unknown = wanted.filter((name) => !SERVICES.some((s) => s.key === name));
  if (unknown.length) fail(`unknown service(s) in --only: ${unknown.join(', ')} (use relay, game, dashboard)`);
  selected = SERVICES.filter((s) => wanted.includes(s.key));
}
selected = selected.filter((service) => {
  if (existsSync(path.join(ROOT, service.dir, 'package.json'))) return true;
  log(`skipping ${service.key}: ${service.dir}/package.json not found`);
  return false;
});
if (!selected.length) fail('nothing to run.');

const lan = await detectLan();
const env = {
  ...process.env,
  FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
  BROWSER: 'none',
  NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${quote(NETFIX)}`].filter(Boolean).join(' '),
};
if (lan.ip) env.SQUAD_LAN_IP = lan.ip;
if (lan.restricted && !env.REACT_NATIVE_PACKAGER_HOSTNAME) env.REACT_NATIVE_PACKAGER_HOSTNAME = lan.ip ?? '127.0.0.1';
if (lan.restricted) log(`network interface listing is blocked here (normal on Android); using ${lan.ip ?? '127.0.0.1'}`);

// Check the ports before installing: a busy port means an earlier dev:all is probably still running, and
// `--fresh` must not delete the node_modules those live services are using.
if (!flags['setup-only']) {
  const busy = [];
  for (const service of selected) if (!(await portIsFree(service.port))) busy.push(service);
  if (busy.length) {
    const ports = busy.map((s) => s.port);
    const freeCommand =
      process.platform === 'darwin'
        ? `pkill -f dev-all; lsof -t ${ports.map((p) => `-i tcp:${p}`).join(' ')} | xargs kill`
        : `pkill -f dev-all; fuser -k ${ports.map((p) => `${p}/tcp`).join(' ')}    (no fuser? ${
            process.platform === 'android' ? 'pkg install psmisc' : 'install psmisc'
          })`;
    fail(
      `port(s) already in use: ${busy.map((s) => `${s.port} (${s.key})`).join(', ')}.\n` +
        '  An earlier dev:all may still be running — stop it (Ctrl+C in its terminal) and retry.\n' +
        '  If its terminal is gone, or the launcher was killed and left its services behind, free the port(s) with:\n' +
        `    ${freeCommand}`,
    );
  }
}

const skipped = new Set(); // services whose own install failed: dropped before anything starts
const deferred = new Set(); // `slow` services whose install runs inside their own command (see installThenStart)
if (!flags['no-install']) {
  const root = await ensureInstalled(ROOT, 'root', env, flags.fresh);
  if (root.signal) await exitLike(root); // Ctrl+C or SIGTERM during an install: stop here
  if (root.code !== 0) fail('npm install failed in root/ — fix the error above and rerun.');
  // `selected` keeps the SERVICES order, so the slow dashboard comes last and knows whether anything else is left.
  for (const service of selected) {
    const dir = path.join(ROOT, service.dir);
    if (service.slow && !flags['setup-only'] && selected.some((s) => !s.slow && !skipped.has(s))) {
      const reason = flags.fresh ? '--fresh' : installReason(dir);
      if (!reason) {
        log(`${service.dir}: dependencies up to date`);
        continue;
      }
      if (flags.fresh) rmSync(stampPath(dir), { force: true });
      deferred.add(service);
      log(`${service.dir}: needs an install (${reason}); it runs in the ${service.key}'s own process, so the others start first`);
      continue;
    }
    const outcome = await ensureInstalled(dir, service.dir, env, flags.fresh);
    if (outcome.signal) await exitLike(outcome);
    if (outcome.code === 0) continue;
    skipped.add(service);
    const next = flags['setup-only'] ? 'continuing with the rest' : `skipping the ${service.key}; the rest still start`;
    warn(`npm install failed in ${service.dir}/ — ${next}. Fix the error above and rerun.`);
  }
}
if (flags['setup-only']) {
  if (skipped.size) fail(`setup finished with errors: npm install failed in ${[...skipped].map((s) => `${s.dir}/`).join(', ')}`);
  log('setup complete. Start everything with: npm run start:all');
  process.exit(0);
}
const listed = selected;
selected = selected.filter((service) => !skipped.has(service));
if (!selected.length) fail('nothing left to run — fix the npm install error(s) above and rerun.');
if (selected.some((s) => s.key === 'game')) {
  log('the game opens at http://localhost:5173 once the SQUADHQ summary appears below (until then the browser says "refused to connect") — keep this terminal open');
}

const { concurrently } = await import('concurrently');
const npmPrefix = npmCommand.map(quote).join(' ');
const { result, commands } = concurrently(
  selected.map((service) => {
    let command = `${npmPrefix} ${service.npmArgs.map(quote).join(' ')}`;
    let commandEnv = env;
    if (deferred.has(service)) {
      // Install, then start, inside the same command (see installThenStart): one concurrently instance keeps a single
      // shutdown path, and a failed install is retried like any failed run (RESTART_TRIES). This file is loaded
      // through an env var so that "dev-all" is on no service's command line: `pkill -f dev-all` must reach only the
      // launcher, which then stops every command.
      const step = [process.execPath, '-e', 'import(process.env.SQUADHQ_LAUNCHER)', '--', `--install-then-start=${service.dir}`];
      if (flags.fresh) step.push('--fresh');
      command = `${process.platform === 'win32' ? '' : 'exec '}${step.map(quote).join(' ')}`;
      commandEnv = { ...env, SQUADHQ_LAUNCHER: import.meta.url };
    }
    return { name: service.key, command, cwd: path.join(ROOT, service.dir), env: commandEnv, prefixColor: service.color };
  }),
  {
    prefix: 'name',
    padPrefix: true,
    restartTries: RESTART_TRIES,
    restartDelay: RESTART_DELAY_MS,
    shell: pickShell(),
  },
);

// concurrently only treats SIGINT as a deliberate stop: after SIGTERM (`pkill`) or SIGHUP (closing the Termux
// session) it sees the services' non-zero exits and restarts them. Route both through the SIGINT path, and stop
// anything a restart that was already pending brings back once shutdown has begun.
let shuttingDown = false;
process.on('SIGINT', () => {
  shuttingDown = true;
});
for (const signal of ['SIGTERM', 'SIGHUP']) {
  process.removeAllListeners(signal);
  process.on(signal, () => process.emit('SIGINT', 'SIGINT'));
}
for (const command of commands) {
  command.stateChange.subscribe((state) => {
    // start() reports 'started' before it records the child's pid, so kill once it has.
    if (shuttingDown && state === 'started') queueMicrotask(() => command.kill('SIGINT'));
  });
}

let stopped = false;
const markStopped = () => {
  stopped = true;
};
result.then(markStopped, markStopped);

/** @type {Map<Service, { state: 'installing' | 'starting' | 'up' | 'late' | 'stopped' | 'install-failed', since: number }>} */
const status = new Map(selected.map((s) => [s, { state: deferred.has(s) ? 'installing' : 'starting', since: Date.now() }]));
const installDone = (service) => installReason(path.join(ROOT, service.dir)) === null;
for (const service of selected) {
  const command = commands.find((c) => c.name === service.key);
  const entry = status.get(service);
  // This `close` only fires once concurrently is done with the command: a clean exit, or its last failed restart.
  command.close.subscribe(() => {
    if (shuttingDown) return;
    if (!deferred.has(service) || installDone(service)) {
      entry.state = 'stopped';
      return;
    }
    entry.state = 'install-failed';
    warn(
      `the ${service.key}'s npm install failed ${RESTART_TRIES + 1} times, so the ${service.key} is skipped; the rest keep running.\n` +
        `  Fix the error above, then start it from a second session with: node scripts/dev-all.mjs --only=${service.key}`,
    );
  });
  if (!deferred.has(service)) continue;
  let failures = 0;
  command.stateChange.subscribe((state) => {
    if (state !== 'exited' && state !== 'errored') return;
    // Give a Ctrl+C that arrived together with this exit time to register before calling it a failed install.
    setTimeout(() => {
      if (shuttingDown || stopped || installDone(service)) return;
      failures += 1;
      if (failures > RESTART_TRIES) return; // the close handler above reports the last one
      log(`${service.key}: install attempt ${failures} of ${RESTART_TRIES + 1} failed; retrying in ${RESTART_DELAY_MS / 1000} s (the rest keep running)`);
    }, 250);
  });
}

log(`starting ${selected.map((s) => s.key).join(' + ')} …`);
// The summary waits for the fast services (or, with nothing else selected, the slow one) to answer or time out. A
// slow service that is already installed gets SLOW_GRACE_MS more; one that is still installing doesn't hold it up.
const awaited = selected.some((s) => !s.slow) ? selected.filter((s) => !s.slow) : selected;
const isBusy = (service) => ['installing', 'starting'].includes(status.get(service).state);
let awaitedSince = null;
let summaryPrinted = false;
while (!stopped && !shuttingDown) {
  for (const [service, entry] of status) {
    if (entry.state === 'installing' && installDone(service)) {
      entry.state = 'starting';
      entry.since = Date.now(); // the readiness timeout starts once it is actually starting
    }
    if (entry.state !== 'starting' && entry.state !== 'late') continue;
    if (await isAnswering(service)) {
      entry.state = 'up';
      if (!summaryPrinted) log(`${service.key} is up on port ${service.port}`);
      else log(`\x1b[36m${service.key} is up: ${serviceUrls(service, lan).filter(Boolean).join('   ')}\x1b[0m`);
    } else if (entry.state === 'starting' && Date.now() - entry.since >= READY_TIMEOUT_MS) {
      entry.state = 'late';
      if (summaryPrinted) warn(`${service.key} is still not answering after ${READY_TIMEOUT_MS / 60_000} minutes — check its log above`);
    }
  }
  if (stopped || shuttingDown) break;
  if (!summaryPrinted && !awaited.some(isBusy)) {
    awaitedSince ??= Date.now();
    if (selected.every((s) => status.get(s).state !== 'starting') || Date.now() - awaitedSince >= SLOW_GRACE_MS) {
      const states = new Map(listed.map((s) => [s, status.get(s)?.state ?? 'skipped']));
      printSummary(listed, lan, states);
      summaryPrinted = true;
    }
  }
  if (summaryPrinted && ![...status.values()].some((e) => ['installing', 'starting', 'late'].includes(e.state))) break;
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

result.then(
  () => process.exit(0),
  // A deliberate stop is a success even if a command failed earlier (e.g. a dashboard whose install gave up).
  () => process.exit(shuttingDown ? 0 : (process.exitCode ?? 1)),
);
