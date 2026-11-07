# SquadHQ relay (`server/`)

A small Node WebSocket relay that links the **SquadHQ dashboard** (React Native app on a phone) to the
**racer** (React Three Fiber game in a browser). The dashboard broadcasts its three sliders; the game applies
them to the car instantly and streams its state and telemetry back. The relay validates every frame against
[`shared/protocol.ts`](../shared/protocol.ts), routes it, and remembers the latest state so late joiners sync
immediately.

```
 phone: SquadHQ ──squad:controls──▶  relay :8787  ──squad:controls──▶  browser: racer
                ◀─game:state / game:telemetry──   ◀─game:state / game:telemetry──
```

## Quick start

```bash
cd server
npm install
npm start                 # ws://0.0.0.0:8787
```

On startup the relay prints the address to type into the phone:

```
  SquadHQ relay · protocol v1 · listening on 0.0.0.0:8787

  Enter one of these in the SquadHQ dashboard (phone on the same Wi-Fi):
    ws://192.168.1.23:8787  (en0)

  Game on this machine:  ws://localhost:8787/?role=game
  Health check:          http://localhost:8787/health
```

Requires Node ≥ 20. TypeScript runs directly through `tsx`, so there is no build step.

### Options

| Flag / env | Default | Meaning |
| --- | --- | --- |
| `--port <n>`, `SQUAD_PORT`, `PORT` | `8787` | TCP port. Precedence: `--port`, then `SQUAD_PORT`, then `PORT`. |
| `--host <addr>` | `0.0.0.0` | Bind address. Keep `0.0.0.0` so phones on the LAN can connect. |
| `--heartbeat <ms>` | `10000` | Ping interval. A client that misses one pong is dropped. |
| `-q`, `--quiet` | off | Only the banner, warnings and errors (no connect or control lines). |

`npm run dev` restarts on file changes. Ctrl+C (SIGINT) or SIGTERM closes every client with code 1001 and exits 0.

## Connecting from a phone (LAN tips)

- **Same network.** Phone and computer must be on the same Wi-Fi. Guest networks and many office or hotel
  networks block device-to-device traffic ("client isolation"). A phone hotspot with the laptop joined to it
  works well as a fallback.
- **Use the LAN IP, not `localhost`.** On the phone, `localhost` means the phone itself. Use one of the
  `ws://<ip>:8787` lines from the banner (usually `192.168.x.x` or `10.x.x.x`).
- **Firewall.**
  - macOS: allow "node" when asked to accept incoming connections (System Settings → Network → Firewall).
  - Windows: allow Node.js on *Private* networks in the Defender Firewall prompt, and make sure the Wi-Fi
    network profile is set to Private.
  - Linux: for example `sudo ufw allow 8787/tcp`.
- **Check reachability.** Open `http://<ip>:8787/health` in the phone's browser. If JSON appears, the
  dashboard can connect. If it times out, the problem is the network or the firewall, not the app.
- **VPNs** on either device often hijack LAN routes. Pause them if the health check fails.

## HTTP endpoints

All on the same port as the WebSocket.

| Path | Response |
| --- | --- |
| `GET /health` | `{ ok, protocolVersion, peers: {game, dashboard, observer}, snapshot: {controls, physics, telemetry, session?}, uptimeSec }` (CORS `*`) |
| `GET /` | Short HTML info page |
| any path, `Upgrade: websocket` | The relay socket. Role comes from `?role=game\|dashboard\|observer` (default `observer`). |

## Protocol summary

JSON text frames, one object each, `{ "type": …, "v": 1, … }`. [`shared/protocol.ts`](../shared/protocol.ts) is
the source of truth for shapes, ranges and the slider-to-physics mapping.

| Frame | Sent by | Relay action | Stored in snapshot |
| --- | --- | --- | --- |
| `hello {role, name?}` | any client | Updates the sender's role, re-sends `server:welcome` to it, broadcasts `server:presence` | – |
| `squad:controls {controls}` | dashboard | Relayed to **every other** client | `snapshot.controls` |
| `physics:set {params}` | anyone (debug) | Relayed to **every other** client | – |
| `game:state {physics, controls, carId?, trackId?, bigJumpKmh?}` | game | Relayed to every **non-game** client | `snapshot.physics`; the optional car / map fields (when present) in `snapshot.session` |
| `game:telemetry {telemetry}` | game, 10 Hz | Relayed to every **non-game** client (skipped for a client with > 1 MB unsent) | `snapshot.telemetry` |
| `ping {nonce}` | anyone | `pong {nonce, serverTime}` to the sender only | – |
| `server:welcome` | relay | On connect and after every `hello`: `clientId`, `role`, `protocolVersion`, `snapshot`, `peers` | – |
| `server:presence {peers}` | relay | Broadcast to everyone on join, leave or role change | – |
| `server:error {code, message}` | relay | To the offending client only | – |

Relay guarantees:

- **Sanitized relaying.** Every frame goes through `parseMessage`: values are clamped and snapped, unknown
  fields are dropped, and missing telemetry channels are filled with defaults. The relay re-encodes that clean
  copy with `from` set to the sender's `clientId`. Raw client bytes are never forwarded, and a client cannot
  spoof `from`.
- **Snapshots outlive their sender.** A game that connects after the dashboard left still gets the last
  `controls` in its welcome.
- **Errors keep the socket open.** Invalid JSON, a bad shape, an unknown type or a binary frame gets
  `bad_message`; `server:*` or `pong` from a client gets `forbidden`. After 20 consecutive bad frames the
  socket is closed with **1008**. Frames larger than 16 KB (`MAX_MESSAGE_BYTES`) close it with **1009**.
- **Rate limit.** Each client has a token bucket (120 frames/s sustained, burst 240). Frames over the limit
  are dropped, and the client gets `rate_limited` at most once per second. A dashboard sending at the
  recommended 30 Hz never comes close.
- **Heartbeat.** WebSocket pings every `--heartbeat` ms. Browsers, React Native and `ws` answer them
  automatically. A client that has not answered the previous ping is terminated, and presence is broadcast.

## Rooms — play with friends (`room.v1`)

The same relay hosts the game's multiplayer rooms (☰ MENU → **FRIENDS**). A game joins a room on the socket it
already keeps open for the dashboard, so `squad:controls` / `game:state` keep working: the dashboard still tunes
every car in the room. Shapes and rules live in [`shared/protocol.ts`](../shared/protocol.ts) ("Rooms"); the
bookkeeping is `src/rooms.ts`, the routing `src/relay.ts`.

| Frame | Sent by | Relay action |
| --- | --- | --- |
| `room:create {name, carId, look, plate, avatar}` | game | New room (4-letter code from `BCDFGHJKLMNPQRSTVWXZ`), sender is host → `room:joined {code, you, players, race, serverNow}` |
| `room:join {code, …identity}` | game | Adds the sender (≤ 8 players) → `room:joined` to it, `room:players` to the others; `room:error` `not_found` / `full` / `already_in_room` |
| `room:update {…identity}` / `room:ready {ready}` | game | `room:players` to everyone in the room (only when something changed) |
| `room:pose {t, p, q, s, st, g, pm}` | game, 15 Hz | Fanned out to the **other** members with `id` + `from` = sender; dropped above 30 Hz per sender (token bucket, burst 6) |
| `room:race {phase, track, startAt}` | host only | Stored and broadcast; `results` are the relay's own: `countdown` resets them to the present members, `room:finish` fills a row |
| `room:finish {finishMs, falls}` | game | Fills the sender's results row → `room:race` to everyone (ignored without a row: late joiners race next time) |
| `room:ping {t, rtt?}` | game | `room:pong {t, serverNow}` to the sender (the relay clock every member times its start lights to); the reported `rtt` shows as `ping` in `room:players` (≤ one broadcast per 4 s) |
| `room:leave` | game | `room:left {reason: 'left'}` to the sender, `room:players` to the rest; a disconnect does the same silently |
| `room:left {reason: 'expired'}` | relay | The room was idle for 2 h (swept every 60 s) |

Rules: a client is in at most one room; the creator is host and the earliest-joined member takes over when the
host leaves; an empty room is deleted at once; at most 64 rooms per relay (`rooms_full`); `/health` reports
`rooms: {rooms, players, posesIn, posesDropped, expired}` and `memory`. Tests: `test/rooms.test.ts` (18 cases:
codes, identities, poses and fan-out, the rate limit with an injected clock, host migration, race ordering, expiry).

## Host the relay online

Friends on the same Wi-Fi need nothing but `npm run dev:all`. Over the internet the relay needs a public `wss://`
address (a https page can only open TLS sockets). Two recipes are in the repository:

- **Render (free plan):** [`render.yaml`](../render.yaml) at the repository root is a Blueprint: Render dashboard →
  New → Blueprint → this repository → one web service `gamerfleet-relay` built from
  [`server/Dockerfile`](Dockerfile) (health check `/health`, `PORT` set by Render). The service answers at
  `wss://gamerfleet-relay.onrender.com` (free instances sleep after 15 min idle; the first connection wakes them in
  about 30 s). The blueprint picks the Singapore region, the closest to central India; change `region` in `render.yaml` if
  your friends are elsewhere.
- **Any Docker host:** `docker build -f server/Dockerfile -t gamerfleet-relay .` from the repository root (the
  context must include `shared/`), then `docker run -p 8787:8787 gamerfleet-relay` behind your TLS terminator
  (Caddy, nginx, a platform's edge). The relay itself speaks plain `ws://`; the terminator forwards the upgrade.

Then open the public game link with the relay address: `https://…/anaye-game/?ws=wss://gamerfleet-relay.onrender.com`
→ ☰ MENU → FRIENDS → HOST A ROOM; the tab's COPY button gives friends a link that carries both `ws=` and `room=`.
Locally the same path is exercised with a self-signed TLS front (`https` + `ws` bridging to the relay) and the
production game loaded with `?ws=wss://127.0.0.1:<port>`: two browser contexts host and join a room over `wss://`
and finish a race with identical results.

## Tools

All tools take `--url` (default `ws://localhost:8787`; a bare `host` or `host:port` also works) and `--help`.

### `npm run sim:dashboard`

Behaves like the phone. It sweeps Front Wing Aero, Engine Tier and Chassis Balance smoothly at about 30 Hz,
sends a `squad:controls` frame whenever a value changes, and prints what the game reports back: the game's
physics turned into a jump verdict, plus live telemetry.

```bash
npm run sim:dashboard -- --url ws://localhost:8787 [--hz 30] [--duration 10]
```

### `npm run sim:game`

Behaves like the racer, so you can test the dashboard without a browser. It drives one car class
(`--car`, default `hypercar`; see `CAR_CLASSES` in `shared/protocol.ts`), applies `squad:controls` through
`mapSquadControlsToPhysics(controls, car)` and patches `physics:set` on top (until the next controls frame). It
emits `game:state` (with `carId`, `trackId: 'chaos'`, `bigJumpKmh`) whenever the physics change, and plausible
`game:telemetry` at 10 Hz from a 1-D car model that uses the protocol's own formulas for that car:

- speed follows the drive-force, drag and rolling-resistance curve, so it never exceeds `estimateTopSpeedKmh`;
- `frontAeroN` comes from `frontAeroForceN` and `rearAeroN` from the class's `rearDownforce · v²`;
- `noseLift` turns on (and wheels drop to 2) above `estimateFrontLiftOffKmh`;
- `rearSlip` spikes on launch when `engineTorque` beats rear grip (tier 4–5);
- checkpoints follow a 1.6 km track. Collapsing tiles and pendulums are dice rolls. At the big jump,
  `speedTrapKmh` is recorded, and the car falls (`falls` +1, respawn at the last checkpoint) unless it carries
  `requiredJumpKmh(BIG_JUMP_LIP_KMH, car)` with its nose down. After three failed jumps in a row the car is respawned past the gap,
  so every run eventually finishes and sets `bestMs`.

If the relay already has `controls` in its snapshot, the sim applies them as soon as it is welcomed.

```bash
npm run sim:game -- --url ws://localhost:8787 [--hz 10] [--duration 10] [--car rally]
```

### `npm run send`

One-shot sender. It connects, sends one frame, waits for a ping round trip (which proves the relay processed
it), and exits non-zero on any `server:error` or timeout.

```bash
npm run send -- controls 80 4 -10                 # aero 80 %, tier 4, balance −10
npm run send -- physics traction=0.6 drag=8       # physics:set patch
npm run send -- physics balance=-0.5 engineTorque=4000
npm run send -- ping                              # round-trip time
npm run send -- --url 192.168.1.23 --role dashboard controls 30 5 0
```

## Development

```bash
npm test          # node:test suites in test/*.test.ts (ephemeral ports)
npm run typecheck # tsc --noEmit over src/, test/ and ../shared
```

Programmatic use (what the tests do):

```ts
import { createRelayServer } from './src/relay';

const relay = await createRelayServer({ port: 0, host: '127.0.0.1', heartbeatMs: 10_000 });
console.log(relay.url, relay.port, relay.stats());
await relay.close();
```

Layout:

| File | Role |
| --- | --- |
| `src/relay.ts` | `createRelayServer`: HTTP and WebSocket server, routing, snapshot, limits, heartbeat |
| `src/index.ts` | CLI entry: options, banner, logging, graceful shutdown |
| `src/options.ts` | CLI flag and env parsing |
| `src/banner.ts`, `src/network.ts` | Startup banner and LAN IPv4 discovery |
| `src/format.ts`, `src/throttled-log.ts` | One-line summaries and the ≤ 1 line/s log throttle |
| `src/tools/*` | `sim-dashboard`, `sim-game` (and its `fake-car` model), `send`, and the shared tool client |
