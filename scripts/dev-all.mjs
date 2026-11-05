#!/usr/bin/env node
// SquadHQ one-command launcher.
//
//   npm run dev:all     install whatever is missing, then run relay + game + dashboard in this terminal
//   npm run start:all   same, but skip the install check
//   npm run setup       install only
//
// Flags: --fresh (reinstall every package)  --only=relay,game,dashboard  --no-install  --setup-only
//
// Built to run unattended on a phone (Termux) as well as on a laptop:
//   - installs packages one at a time (three parallel npm installs can exhaust a phone's memory)
//   - preloads scripts/termux-netfix.cjs into every child so a blocked os.networkInterfaces() can't crash them
//   - finds the LAN address without netlink (UDP route lookup) and hands it to Expo
//   - spawns through a shell that exists on Android (there is no /bin/sh there)
//   - prints one summary of every URL once all services answer

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NETFIX = path.join(ROOT, 'scripts', 'termux-netfix.cjs');
const INSTALL_STAMP = '.squadhq-install-stamp';
const READY_TIMEOUT_MS = 5 * 60_000; // Metro's first start on a phone can be slow.

/** @typedef {{ key: string, dir: string, port: number, color: string, npmArgs: string[], probePath: string, expect?: string }} Service */
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
  },
];
const ALIASES = { server: 'relay', dash: 'dashboard', expo: 'dashboard' };

const log = (message = '') => process.stdout.write(`\x1b[35m[dev:all]\x1b[0m ${message}\n`);
const fail = (message) => {
  process.stderr.write(`\x1b[31m[dev:all] ${message}\x1b[0m\n`);
  process.exit(1);
};

// ── npm ────────────────────────────────────────────────────────────────────────────────────

/** Run npm through the current Node binary when possible: no PATH, shebang or shell lookups involved. */
const npmCli = process.env.npm_execpath && /npm-cli\.[cm]?js$/.test(process.env.npm_execpath) ? process.env.npm_execpath : null;
const npmCommand = npmCli ? [process.execPath, npmCli] : [process.platform === 'win32' ? 'npm.cmd' : 'npm'];

function runNpm(args, cwd, env) {
  const [file, ...prefix] = npmCommand;
  const result = spawnSync(file, [...prefix, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32' && !npmCli,
  });
  return result.status === 0;
}

function manifestHash(dir) {
  const hash = createHash('sha256');
  for (const file of ['package.json', 'package-lock.json']) {
    const full = path.join(dir, file);
    hash.update(file).update(existsSync(full) ? readFileSync(full) : '');
  }
  return hash.digest('hex');
}

/** Why `dir` needs an install, or null when node_modules matches its manifests. */
function installReason(dir) {
  const stamp = path.join(dir, 'node_modules', INSTALL_STAMP);
  if (!existsSync(path.join(dir, 'node_modules'))) return 'no node_modules yet';
  if (!existsSync(stamp)) return 'first run of dev:all here';
  return readFileSync(stamp, 'utf8').trim() === manifestHash(dir) ? null : 'package.json / lockfile changed';
}

function ensureInstalled(dir, label, env, force) {
  const reason = force ? '--fresh' : installReason(dir);
  if (!reason) {
    log(`${label}: dependencies up to date`);
    return;
  }
  log(`${label}: installing dependencies (${reason}) …`);
  if (!runNpm(['install', '--no-audit', '--no-fund'], dir, env)) fail(`npm install failed in ${label}/ — fix the error above and rerun.`);
  writeFileSync(path.join(dir, 'node_modules', INSTALL_STAMP), manifestHash(dir));
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

function printSummary(services, lan, notReady) {
  const lanHost = lan.ip ?? '127.0.0.1';
  const rows = {
    relay: [`ws://localhost:8787`, lan.ip ? `ws://${lan.ip}:8787` : ''],
    game: [`http://localhost:5173`, lan.ip ? `http://${lan.ip}:5173` : ''],
    dashboard: [`exp://${lanHost}:8081`, `web: http://localhost:8081`],
  };
  const line = '─'.repeat(72);
  const out = ['', line, notReady.size ? ' SQUADHQ // PARTIALLY UP' : ' SQUADHQ // ALL SYSTEMS LIVE'];
  for (const service of services) {
    const [local, lanUrl] = rows[service.key];
    const state = notReady.has(service) ? '  (not answering yet — check its log above)' : '';
    out.push(`   ${service.key.toUpperCase().padEnd(10)} ${local.padEnd(28)} ${lanUrl}${state}`);
  }
  out.push('');
  out.push(' Game + dashboard connect to the relay on port 8787 of whichever host served them.');
  if (services.some((s) => s.key === 'dashboard')) {
    out.push(` Dashboard on a phone: Expo Go → "Enter URL manually" → exp://${lanHost}:8081`);
  }
  if (process.platform === 'android') {
    out.push(' Same phone: open http://localhost:5173 in Chrome; the dashboard can use ws://127.0.0.1:8787.');
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
  },
});

if (flags.help) {
  process.stdout.write(
    [
      'Usage: node scripts/dev-all.mjs [--fresh] [--only=relay,game,dashboard] [--no-install] [--setup-only]',
      '  npm run dev:all     install whatever is missing, then run everything in this terminal',
      '  npm run start:all   run everything without the install check',
      '  npm run setup       install only',
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

if (!flags['no-install']) {
  ensureInstalled(ROOT, 'root', env, flags.fresh);
  for (const service of selected) ensureInstalled(path.join(ROOT, service.dir), service.dir, env, flags.fresh);
}
if (flags['setup-only']) {
  log('setup complete. Start everything with: npm run start:all');
  process.exit(0);
}

const busy = [];
for (const service of selected) if (!(await portIsFree(service.port))) busy.push(service);
if (busy.length) {
  fail(
    `port(s) already in use: ${busy.map((s) => `${s.port} (${s.key})`).join(', ')}.\n` +
      '  An earlier dev:all may still be running — stop it (Ctrl+C in its terminal, or `pkill -f dev-all`) and retry.',
  );
}

const { concurrently } = await import('concurrently');
const npmPrefix = npmCommand.map(quote).join(' ');
const { result } = concurrently(
  selected.map((service) => ({
    name: service.key,
    command: `${npmPrefix} ${service.npmArgs.map(quote).join(' ')}`,
    cwd: path.join(ROOT, service.dir),
    env,
    prefixColor: service.color,
  })),
  {
    prefix: 'name',
    padPrefix: true,
    restartTries: 2,
    restartDelay: 3000,
    shell: pickShell(),
  },
);

log(`starting ${selected.map((s) => s.key).join(' + ')} …`);
const pending = new Set(selected);
const deadline = Date.now() + READY_TIMEOUT_MS;
let stopped = false;
const markStopped = () => {
  stopped = true;
};
result.then(markStopped, markStopped);
while (pending.size && !stopped && Date.now() < deadline) {
  for (const service of [...pending]) {
    if (await isAnswering(service)) {
      pending.delete(service);
      log(`${service.key} is up on port ${service.port}`);
    }
  }
  if (pending.size) await new Promise((resolve) => setTimeout(resolve, 1500));
}
if (!stopped) printSummary(selected, lan, pending);

result.then(
  () => process.exit(0),
  () => process.exit(process.exitCode ?? 1),
);
