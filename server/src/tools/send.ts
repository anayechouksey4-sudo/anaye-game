// One-shot sender: connect, send one frame, confirm the relay processed it (ping/pong), exit.
import {
  CAR_PHYSICS_KEYS,
  SQUAD_CONTROL_KEYS,
  isClientRole,
  sanitizePhysicsPatch,
  sanitizeSquadControls,
  type ClientMessage,
  type ClientRole,
  type OutgoingMessage,
} from '../../../shared/protocol';
import { formatControls, formatPeers, formatPhysics } from '../format';
import { parseToolArgs } from './args';
import { connectToolClient } from './client';

const USAGE = `One-shot sender for the SquadHQ relay.

Usage: npm run send -- [--url ws://localhost:8787] [--role observer] <command> [args]

Commands:
  controls <aero 0-100> <tier 1-5> <balance -50..50>   squad:controls, e.g.  controls 80 4 -10
  physics <key=value>...                               physics:set,    e.g.  physics traction=0.6 drag=8
                                                       keys: ${CAR_PHYSICS_KEYS.join(', ')}
  ping                                                 round-trip time to the relay

Options:
  --role       Role to connect as: observer (default), dashboard or game
  --timeout    Give up after this many ms (default 3000)
`;

const { values, positionals } = parseToolArgs(
  USAGE,
  { role: { type: 'string', default: 'observer' }, timeout: { type: 'string', default: '3000' } },
  true,
);

function fail(message: string, exitCode = 2): never {
  console.error(`error: ${message}`);
  if (exitCode === 2) console.error(`\n${USAGE}`);
  process.exit(exitCode);
}

const [command, ...args] = positionals;
const role: ClientRole = isClientRole(values.role) ? values.role : fail(`unknown role "${values.role}"`);
const timeoutMs = Number(values.timeout);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('--timeout must be a positive number of ms');

function buildMessage(): OutgoingMessage<ClientMessage> | null {
  switch (command) {
    case 'controls': {
      if (args.length !== SQUAD_CONTROL_KEYS.length) fail('controls needs exactly three numbers: aero tier balance');
      const raw = Object.fromEntries(SQUAD_CONTROL_KEYS.map((key, i) => [key, Number(args[i])]));
      const controls = sanitizeSquadControls(raw) ?? fail(`controls values must be numbers (got ${args.join(' ')})`);
      if (SQUAD_CONTROL_KEYS.some((key) => controls[key] !== raw[key])) {
        console.log(`note: snapped/clamped to ${formatControls(controls)}`);
      }
      return { type: 'squad:controls', controls };
    }
    case 'physics': {
      if (args.length === 0) fail('physics needs at least one key=value');
      const raw: Record<string, number> = {};
      for (const arg of args) {
        const match = /^(\w+)=(.+)$/.exec(arg);
        if (!match?.[1] || !match[2]) fail(`expected key=value, got "${arg}"`);
        if (!(CAR_PHYSICS_KEYS as readonly string[]).includes(match[1])) fail(`unknown physics key "${match[1]}"`);
        raw[match[1]] = Number(match[2]);
      }
      const params = sanitizePhysicsPatch(raw) ?? fail('physics values must be finite numbers');
      return { type: 'physics:set', params };
    }
    case 'ping':
      return null;
    default:
      return fail(command ? `unknown command "${command}"` : 'missing command');
  }
}

const message = buildMessage();
const nonce = Math.floor(Math.random() * 1e9);
let pingSentAt = 0;
let sent = false;

const timeout = setTimeout(() => {
  console.error(`error: no answer from ${client.url} within ${timeoutMs} ms`);
  client.close();
  process.exit(1);
}, timeoutMs);

const client = connectToolClient({
  url: values.url,
  role,
  name: 'send',
  reconnect: false,
  onError: (err) => console.error(`socket error: ${err.message}`),
  onClose: (code) => {
    clearTimeout(timeout);
    if (code !== 1000) fail(`connection closed (${code}) before the relay confirmed`, 1);
  },
  onMessage: (msg) => {
    switch (msg.type) {
      case 'server:welcome':
        // The relay welcomes us on connect (role from ?role=) and again after our hello; act once.
        if (sent || msg.role !== role) return;
        sent = true;
        console.log(`connected to ${client.url} as ${msg.clientId} (${formatPeers(msg.peers)})`);
        if (message) {
          client.send(message);
          console.log(
            `sent ${message.type}: ` +
              (message.type === 'squad:controls'
                ? formatControls(message.controls)
                : message.type === 'physics:set'
                  ? formatPhysics(message.params)
                  : ''),
          );
        }
        pingSentAt = performance.now();
        client.send({ type: 'ping', nonce });
        return;
      case 'server:error':
        console.error(`server error ${msg.code}: ${msg.message}`);
        process.exitCode = 1;
        return;
      case 'pong': {
        if (msg.nonce !== nonce) return;
        const rtt = performance.now() - pingSentAt;
        console.log(message ? `relay confirmed (rtt ${rtt.toFixed(1)} ms)` : `pong: rtt ${rtt.toFixed(1)} ms`);
        clearTimeout(timeout);
        void client.flush().then(() => client.close());
        return;
      }
      default:
        return;
    }
  },
});
