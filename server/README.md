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
| `/admin/api/*` | The owner's admin API (milestone 6, below): sessions, stats, rooms, announcements, settings, audit. Off without `ADMIN_KEY`. |
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
| `room:create {name, carId, look, plate, avatar, token?, size?}` | game | New room (4-letter code from `BCDFGHJKLMNPQRSTVWXZ`) of `size` seats (2–8; 8 without one), sender is host → `room:joined {code, you, players, race, serverNow, size}` |
| `room:join {code, …identity, token?}` | game | Adds the sender → `room:joined` to it, `room:players` to the others; the same `token` as a seat in the room takes that seat back (`room:joined {restored: true}`, same `you`); `room:error` `not_found` / `full` (`ROOM FULL (2/2)`; with away seats `ROOM FULL (2/2) · 1 RECONNECTING: ask the host to REMOVE that seat, or try again in 2 min`) / `removed` / `already_in_room` |
| `room:size {size}` | host only | New size (never below the seats taken) → `room:players {…, size}` |
| `room:remove {id}` | host only | Frees that seat; the device gets `room:left {reason: 'removed'}` (`'closed'` for an old, untokened client) and its token / socket cannot come back into this room |
| `room:host {id}` | host only | Hands the host role to a present member → `room:players` |
| `room:update {…identity}` / `room:ready {ready}` | game | `room:players` to everyone in the room (only when something changed) |
| `room:pose {t, p, q, s, st, g, pm}` | game, 15 Hz | Fanned out to the **other** members with `id` + `from` = sender; dropped above 30 Hz per sender (token bucket, burst 6) |
| `room:race {phase, track, startAt}` | host only | Stored and broadcast; `results` are the relay's own: `countdown` resets them to the present members, `room:finish` fills a row |
| `room:finish {finishMs, falls}` | game | Fills the sender's results row → `room:race` to everyone (ignored without a row: late joiners race next time) |
| `room:ping {t, rtt?}` | game | `room:pong {t, serverNow}` to the sender (the relay clock every member times its start lights to); the reported `rtt` shows as `ping` in `room:players` (≤ one broadcast per 4 s) |
| `room:leave {to?}` | game | `room:left {reason: 'left'}` to the sender, `room:players` to the rest; a host hands the room to `to` (when present) or the earliest present member |
| `room:left {reason}` | relay | `expired` (idle 2 h, swept every 60 s), `removed` (the host removed you), `replaced` (the same device opened the room on a newer socket) |

**Seats.** The game sends a random per-device `token` (never shown). The relay keys that member by it: when its
socket drops (a phone switching apps to share the link, a Wi-Fi → data switch) the seat stays for **120 s**
(`ROOM_SEAT_GRACE_MS`), shown as `away: true` in `room:players` (FRIENDS: RECONNECTING…, car hidden), with its host
role, member id and results row; the device's automatic re-join takes it back. A second socket with the same token
replaces the first, so a device never shows up twice. The host role moves only on the host's LEAVE, `room:host`, or
when the host's seat expires. Names are de-duplicated per room (`Anaye`, `Anaye 2`; ≤ 16 characters).

**Old clients** (no `token`, no `size`) keep the old behaviour: they create rooms of 8, join any room with a free
seat, are removed the moment their socket closes (the earliest present member takes over if they were host), and
only receive error codes and leave reasons the previous parser knows. A game that predates seats ignores the new
optional fields; a new game on a relay that predates seats sees no `size` in `room:joined` and hides sizes, REMOVE
and MAKE HOST.

Rules: a socket is in at most one room and a token holds one seat; an empty room is deleted at once; at most 64
rooms per relay (`rooms_full`); `/health` reports `rooms: {rooms, players, away, posesIn, posesDropped, expired,
seatsExpired, seatsRestored}` and `memory`. Tests: `test/rooms.test.ts` (18 cases: codes, identities, poses and
fan-out, the rate limit with an injected clock, host migration, race ordering, expiry) and `test/seats.test.ts`
(15 cases: token seats, grace restore, duplicate-socket replace, host kept through the grace, LEAVE / MAKE HOST /
expiry hand-over, size limits and changes, REMOVE with no way back, name de-dup, old clients, bounded memory).

## Sign-in, the owner's console and live stats (milestone 6)

Everything here is additive: a game that predates it keeps working unchanged (it never sends the new fields, the
relay never sends it a code or reason it does not know, and it ignores `server:announce`).

### Environment variables

Set the values in the Render dashboard (service → Environment). [`render.yaml`](../render.yaml) only declares the
names (`sync: false`): no value ever goes into the repository, the build, `docs/` or a log.

| Variable | Meaning |
| --- | --- |
| `ADMIN_KEY` | The owner's admin passphrase, **at least 24 characters**. Missing or shorter = the admin API is off (login answers `503 admin not configured`). |
| `ADMIN_EMAILS` | Comma-separated Google accounts allowed into the console (compared case-insensitively with the token's verified `email`). |
| `GOOGLE_CLIENT_ID` | The game's Google OAuth client id (public). Players' ID tokens must be issued to it; it also enables the console's Google factor. |
| `TRUST_PROXY` | `"1"` on Render (a plain value in `render.yaml`): the visitor's IP is the **last** `X-Forwarded-For` entry; in production the admin API then also insists on `X-Forwarded-Proto: https`. Unset = the socket's address. Set it **only** behind a proxy that appends the visitor's real address (Render's does): without one, a client chooses that last entry itself and can spread its failed logins over made-up addresses to dodge the per-IP limit (the global 20-per-hour lockout still holds). |
| `NODE_ENV` | `production` on Render: localhost origins are refused by the admin API and `GOOGLE_JWKS_FILE` is ignored. |
| `GOOGLE_JWKS_FILE` | Local testing only (ignored in production): a JWKS file used instead of Google's keys, so a local relay accepts tokens signed by a test key. |
| `RELAY_VERSION`, `RENDER_GIT_COMMIT` | Version shown in the console (Render sets `RENDER_GIT_COMMIT`; 40-character shas are cut to 12). Default `unknown`. |

Login is **two-factor** (a Google ID token for an `ADMIN_EMAILS` account **and** the key) when both `GOOGLE_CLIENT_ID`
and `ADMIN_EMAILS` are set; otherwise it is **key-only**, the weaker interim mode, reported as `mode: 'key-only'` with a
`warning` so the console can show it. The startup log says which mode is on, never a value.

### Players on the wire

| Addition | Where | Meaning |
| --- | --- | --- |
| `tz?: string` | `hello`, `room:create`, `room:join`, `room:update` | The device's IANA time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`). The relay keeps only the country it maps to (`countryFromTimeZone` in `shared/protocol.ts`; unknown zones → no country). Never geolocated from the IP. |
| `idToken?: string \| null` | same frames | A Google ID token. With `GOOGLE_CLIENT_ID` set the relay verifies it (RS256 against Google's JWKS, `iss`, `aud` = the client id, `exp`, `iat`, 60 s skew) and marks the socket verified, keeping only the sanitized `given_name` (≤ 16 characters). `null` = signed out. The latest frame carrying `idToken` decides; sending it once on `hello` is enough. The token is never stored, logged or relayed; emails and Google ids are never kept. |
| `verified?: true`, `givenName?: string`, `country?: string` | each player in `room:joined` / `room:players` | Present only when known, so rooms without sign-in look exactly as before. |
| `signedInOnly?: boolean` | `room:create` | Host option: only verified players may join. The host must be verified; a relay without `GOOGLE_CLIENT_ID` answers `bad_state`. |
| `room:settings {signedInOnly}` | new, host only | Switch SIGNED-IN PLAYERS ONLY on/off in the lobby → `room:players` to everyone. Seats taken before it went on stay; a device taking back its own seat (same token) is let in. |
| `signedInOnly?: true` | `room:joined`, `room:players` | The room admits verified players only. |
| `room:error {code: 'sign_in_required'}` | relay → client | A non-verified player joined (or tried to create / switch on) a signed-in-only room. Sent only to a socket that sent a milestone 6 field (`tz`, `idToken` or `signedInOnly`); any other client gets `bad_state` with "SIGNED-IN PLAYERS ONLY: this room needs Google sign-in. Reload the game to get the newest version, then sign in." |
| `signIn?: boolean` | `server:welcome` | Whether this relay verifies Google tokens (hide sign-in and the signed-in-only toggle when it is not `true`). |
| `server:announce {id, text, until, serverNow}` | relay → game clients | The owner's banner until `until` (relay clock, epoch ms; `until - serverNow` = time left). `text` is plain text (≤ 120 characters, no control characters) and must be rendered as text. `text: ''` = hide now. Re-sent after every welcome while active: show each `id` once. |
| `room:error {code: 'rooms_full', message: 'New rooms are paused by the owner'}` | relay → client | `room:create` while the owner has paused new rooms (joins keep working). |
| `room:left {reason: 'closed'}` | relay → client | The owner closed the room. The owner removing a player sends what the host's REMOVE sends: `removed` (tokened) or `closed` (untokened). |

A frame carrying an `idToken` is verified before it is handled, and the frames behind it wait (≤ 64), so the order is
kept. Keys are cached for the JWKS response's `Cache-Control` max-age and refetched for an unknown `kid` at most once
a minute; RSA keys shorter than 2048 bits, `alg` other than `RS256` (`none`, `HS256` …) and audience lists are refused.

### Admin API (`/admin/api/`)

On the relay's own origin (`https://gamerfleet-relay.onrender.com/admin/api/…`). Every response is JSON with
`Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Vary: Origin`; no cookies.

- **CORS**: a request with an `Origin` header must come from exactly `https://anayechouksey4-sudo.github.io` (plus
  `http://localhost`, `127.0.0.1` and `[::1]` on any port when `NODE_ENV` is not `production`); it then gets
  `Access-Control-Allow-Origin: <that origin>` and `Access-Control-Expose-Headers: X-Session-Expires-At, Retry-After`.
  Any other origin (including `null`) gets `403 {error: 'origin not allowed'}`. Preflight `OPTIONS` → `204` with
  `Allow-Methods: GET, POST, OPTIONS`, `Allow-Headers: Authorization, Content-Type`, `Max-Age: 600`. No credentials mode.
- **HTTPS**: with `TRUST_PROXY=1` in production, a request whose last `X-Forwarded-Proto` is not `https` gets `403 {error: 'https required'}`.
- **Bodies**: JSON objects only (`Content-Type: application/json` when there is a body, else `415`), ≤ 8 KB (`413
  {error: 'body too large', limitBytes: 8192}`), strict schemas (unknown keys, wrong types → `400 {error: 'bad request', detail?}`).
- **Sessions**: every route except `login` needs `Authorization: Bearer <session>`; missing, malformed, unknown or
  expired → `401 {error: 'unauthorized'}` (no detail; unknown paths also answer 401 until authenticated, then 404).
  A session is 32 random bytes (base64url, 43 characters), valid 30 minutes after its last use and 12 hours at most,
  held in memory only (logout or a relay restart revokes it). Authenticated responses carry `X-Session-Expires-At` (epoch ms).
- **Login limits**: 5 failed logins per client IP per 15 minutes → `429 {error: 'too many attempts', retryAfterSec}` +
  `Retry-After` for that IP (even with the right key); 20 failed logins in total in an hour → login locked for everyone
  for 30 minutes (`429 {error: 'admin locked', retryAfterSec}`); sessions from before keep working, and the next
  successful login returns `lastLockout`. Malformed and not-configured logins count as failures.

| Method, path | Request body | Success response |
| --- | --- | --- |
| `POST login` | `{key: string, idToken?: string}` (`idToken` required in two-factor mode) | `200 {session, expiresAt, maxExpiresAt, mode: 'two-factor' \| 'key-only', warning?, lastLockout?: {at, until, failures}}`; failures `400` / `401 {error: 'unauthorized'}` / `429` / `503 {error: 'admin not configured'}` |
| `POST logout` | none or `{}` | `200 {ok: true}` |
| `GET stats` | – | live numbers, see below |
| `GET rooms` | – | `200 {rooms: [{code, size, players, phase, map, ageSec, signedInOnly, members: [{id, name, verified, givenName, country, car, host, away}]}], settings: {newRoomsAllowed}}` |
| `POST rooms/:code/close` | none or `{}` | `200 {ok: true, code, members}` (members = sockets told `room:left 'closed'`); `404 {error: 'no such room'}` |
| `POST rooms/:code/remove` | `{memberId}` (an `id` from `GET rooms`) | `200 {ok: true, code, memberId, roomClosed}`; `404 {error: 'no such room' \| 'no such player'}` |
| `POST announce` | `{text: 1–120 characters, minutes: integer 1–60}` | `200 {ok: true, announce: {id, text, until}}` → `server:announce` to every game |
| `POST announce/clear` | none or `{}` | `200 {ok: true, cleared: boolean}` → `server:announce {text: ''}` |
| `GET settings` / `POST settings` | – / `{newRoomsAllowed: boolean}` | `200 {settings: {newRoomsAllowed}}` / `200 {ok: true, settings}` |
| `GET audit` | – | `200 {entries: [{at, action, ok, ipHash, detail?}]}` newest first, last 200 (actions `login`, `logout`, `lockout`, `close-room`, `remove-player`, `announce`, `announce-clear`, `settings`). `ipHash` is 12 hex characters of SHA-256 over a per-process random salt + the IP; the audit never holds an IP, the key, a token or an email. |

`GET stats` (all counts start when the relay starts — the free plan sleeps and restarts it; "today" is the UTC day):

```
{ now, startedAt, uptimeSec, version, memory: {rss, heapUsed, heapTotal}, note, labels: {...},
  online: {players, dashboards, observers, signedIn},     // players = game clients connected now (offline mode is not counted)
  rooms: {total, playersInRooms, away, byPhase: {lobby, countdown, racing, results}, racesRunning, signedInOnly},
  maps: [{id, players}], mapsOther, cars: [{id, players}], carsOther,      // current players (room race track / game:state)
  countries: [{code, name, players}], countriesOther, countriesUnknown,    // from the device time zone
  peak: {today, todayAt, sinceStart, sinceStartAt, day}, sessions: {today, sinceStart},
  races: {finishedToday, finishedSinceStart}, settings: {newRoomsAllowed}, announce: {id, text, until} | null,
  signIn, admin: {enabled, mode, warning, sessions, lockedUntil, lastLockout, failedLoginsLastHour, blockedAttempts} }
```

### A local relay with test keys (no Google account needed)

```bash
cd server
npm run test-google -- keys --out /tmp/m6-keys            # jwks.json + private-key.pem + kid.txt (keep out of the repo)
GOOGLE_CLIENT_ID=local-test-client.example.com GOOGLE_JWKS_FILE=/tmp/m6-keys/jwks.json \
ADMIN_KEY='a local test passphrase of 24+ chars' ADMIN_EMAILS=owner@example.com \
npm start -- --host 127.0.0.1 --port 19601
npm run test-google -- token --dir /tmp/m6-keys --aud local-test-client.example.com --email owner@example.com --given Owner
```

The token command prints an ID token the local relay accepts (made-up `example.com` addresses only; `--ttl=-60` makes an
expired one, `--unverified` sets `email_verified: false`). Programmatic use: `generateTestKey`, `mintIdToken` and
`testJwks` in `src/auth/testKeys.ts`, and `createRelayServer({ google: new GoogleTokenVerifier({ clientId, source:
staticJwksSource(jwks) }), admin: { key }, now })`.

Tests: `test/google.test.ts` (14 cases: good token, wrong aud / iss, expired, future iat, bad signature, `alg` none /
HS256 key confusion, unknown-kid refetch and its throttle, Cache-Control caching, key-source outages, unusable keys,
given-name sanitizing, the admin email check), `test/admin.test.ts` (27 cases: disabled / key-only / two-factor login,
every route, bearer failures, per-IP 429, the global lockout, sliding / capped sessions, logout and restart, CORS,
HTTPS behind the proxy, malformed request targets (400, no crash), body limits and schemas, stats counters and the UTC day, the audit's privacy, environment
parsing) and `test/signin.test.ts` (13 cases: time-zone countries, parsing, badges, sign-out, refused tokens, frame
order while verifying, signed-in-only rooms and `room:settings`, codes that reach old games).

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
| `src/rooms.ts` | Room bookkeeping: seats, host role, size, removal, race state, badges, signed-in-only, owner close / remove |
| `src/auth/google.ts` | Google ID-token verification (RS256 / JWKS cache, iss, aud, exp, iat) with Node's crypto only |
| `src/auth/testKeys.ts` | A local RSA key standing in for Google's (tests, local relays, headless sign-in checks) |
| `src/admin.ts` | `/admin/api/`: login (two-factor / key-only), sessions, limits, CORS, body limits, routes, audit |
| `src/stats.ts` | Live counters (peaks, sessions, races; UTC day) |
| `src/config.ts` | Milestone 6 environment variables → relay options (startup notes never contain a value) |
| `src/tools/*` | `sim-dashboard`, `sim-game` (and its `fake-car` model), `send`, `test-google`, and the shared tool client |
