# SquadHQ dashboard (`dashboard/`)

SquadHQ is the squad's tuning console for the GamerFleet racer. It's a dark cyberpunk control panel built with
React Native and Expo (SDK 58). It has three sliders: **Front Wing Aero**, **Engine Tier** and **Chassis
Balance**. Every slider movement goes out live over WebSocket to the local relay (`server/`). The game
(`game/`) picks the values up and changes its car physics straight away, then sends its applied physics and F1
style telemetry back to this screen.

<p align="center">
  <img src="docs/screenshot.png" width="390" alt="SquadHQ on a 390×844 phone: link online, game linked, Front Wing Aero at 20 %" />
</p>

Full-length phone view: [`docs/screenshot-full.png`](docs/screenshot-full.png) · tablet and desktop layout:
[`docs/screenshot-wide.png`](docs/screenshot-wide.png)

```
 phone: SquadHQ ──squad:controls (≤30 Hz)──▶ relay :8787 ──▶ racer (browser)
                ◀── game:state · game:telemetry (10 Hz) ──
```

## Run it on your phone (Expo Go)

You need Node 22+, the free **Expo Go** app (SDK 58) on the phone, and the phone and computer on the **same
Wi‑Fi**.

```bash
# from the repo root: relay + game + dashboard together
npm run dev:all

# …or just the pieces you need, each in its own terminal
cd server && npm install && npm start          # relay on ws://0.0.0.0:8787
cd dashboard && npm install && npx expo start  # Metro + QR code
```

1. Scan the QR code. On iOS use the Camera app, on Android use Expo Go. SquadHQ opens in Expo Go. No
   development build is needed, because every native module used here ships inside Expo Go.
2. The **Relay address** box is pre-filled with `ws://<IP of the computer running Metro>:8787`, and the app
   connects by itself. If the relay runs on a different machine, type the address that machine's relay prints
   at startup:
   ```
   Enter one of these in the SquadHQ dashboard (phone on the same Wi-Fi):
     ws://192.168.1.23:8787  (en0)
   ```
   A bare `192.168.1.23` or `192.168.1.23:8787` also works; it is normalized to `ws://…:8787`.
3. The header LED turns green with **LINK ONLINE**. Once the racer is open in a browser, the connection card
   shows **GAME LINKED ×1**.

The last address you connected to is saved. On the next launch the app reconnects to it automatically, unless
you pressed **Disconnect** last time.

## Web mode

```bash
npx expo start --web            # dev server; open http://localhost:8081
npm run export:web              # static build in dist/ (serve it with any static file server)
```

On the web, the default relay is `ws://<page hostname>:8787`. The sliders also work from the keyboard: focus
one with Tab, then use ←/→ or ↑/↓ for one step, PageUp/PageDown for a tenth of the range (one tier
on Engine Tier), and Home/End for min/max.

## What's on the screen

| Panel | What it shows |
| --- | --- |
| **Connection** | Relay URL, Connect/Disconnect, `CONNECTING` / `ONLINE` / `OFFLINE` / `RETRY IN Ns`, round-trip latency (ping every ~2 s), `GAME LINKED ×n` or `NO GAME LINKED`, count of other squad dashboards. |
| **Front Wing Aero** 0–100 % | Front-wing downforce factor vs the body lift (2.7). The magenta zone below ~42 % is where the front nets **lift** at speed. |
| **Engine Tier** T1–T5 | Rear-axle torque (700→3500 N·m), contact-patch drive force, mass (+60 kg per tier). |
| **Chassis Balance** −50…+50 | Front/rear weight split (`describeChassisBalance`) and spring split (`balanceToSuspensionStiffness`). Has a centre notch at 0. |
| **Presets** | BALANCED 50/3/0 · MAX DOWNFORCE 100/2/−10 · TOP SPEED 0/5/+10 · JUMP ATTEMPT 20/5/−20 (READY), plus RESET. Each preset shows its big-jump verdict. |
| **Big Jump Readiness** | `assessBigJump`: **READY** / **TOO SLOW** / **NOSE LIFT**, estimated top speed vs the 183 km/h lip, and the nose-lift speed. After the game reports `speedTrapKmh`, it also shows the real lip speed, e.g. `CLEARED +7` or `SHORT −5`. |
| **Tune Preview** | `mapSquadControlsToPhysics` applied to your sliders: top speed, nose-lift speed (`NEVER` when the wing beats body lift; warns if the nose lifts below top speed), front aero at 200 km/h, drag, torque, weight and springs. **Applied in game** shows what the racer reports in `game:state`, with a badge: `SYNCED` / `SYNCING` / `OVERRIDE` (physics:set on top) / `UNCONFIRMED` / `LAST KNOWN`. |
| **F1 Telemetry** | Speed, throttle and brake bars, front and rear aero load (front turns magenta **LIFT** when negative), flashing **NOSE LIFT** warning, rear slip meter (**TYRE SMOKE** at ≥ 50 %), wheels down, checkpoint, falls, run timer, best lap. Shows `NO SIGNAL` if telemetry stops for 2.5 s and `NO GAME LINKED` with no game on the relay. |

Haptics: a tick on every Engine Tier step, a tick every 10 units on the other two sliders, a firmer bump when
Chassis Balance lands on 0, and a confirmation buzz on presets. Web has no haptics.

## Networking behaviour

All of this lives in `src/net/squadLink.ts`, `src/net/controlsThrottle.ts`, `src/squad/controller.ts` and
`src/squad/sync.ts`.

- **Role and hello.** The app connects to `ws://host:8787/?role=dashboard` and sends
  `hello {role:'dashboard', name:'SquadHQ <platform>'}` as soon as the socket opens. Every inbound frame goes
  through `parseMessage` from [`shared/protocol.ts`](../shared/protocol.ts).
- **What is sent.** `squad:controls` always carries **all three exact slider values**, snapped to
  `SQUAD_CONTROL_SPECS`.
  - **While dragging**, sends are throttled to one per `CONTROLS_SEND_INTERVAL_MS` (33 ms, about 30 frames/s).
    The newest value always goes out when the window ends: the trailing send is guaranteed.
  - **On release** (`onSlidingComplete`, or key-up on web), the final value is sent **immediately**.
  - **Presets and Reset** are sent immediately.
- **Sync rule on (re)connect.** The relay's `server:welcome` carries `snapshot.controls`.
  - If the snapshot has controls **and you haven't touched a slider, preset or reset since launch**, the app
    **adopts** them and sends nothing. You see the squad's current tune.
  - Otherwise it **pushes** its own three values. This covers an empty relay, or you tuning while the link
    was down.
- **Other dashboards.** An incoming `squad:controls` from another dashboard updates your sliders, **except
  a slider you are holding right now**. When you let go, your full set is broadcast.
- **Reconnects.**
  - Exponential backoff from 500 ms to 8 s, with ±25 % jitter.
  - A socket stuck connecting is dropped after 8 s.
  - An "open" socket that has received nothing (not even pongs) for 7 s is treated as dead. This catches
    half-open sockets after a Wi‑Fi hop.
  - Bringing the app back to the foreground retries straight away.
  - **Disconnect** stops all retries.
- **Re-renders.** Socket traffic lands in small external stores, not in root React state. Each panel
  subscribes to its own slice, so 10 Hz telemetry re-renders only the telemetry panel, and a slider drag
  re-renders only that card and the previews.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | `expo start` (Metro + QR code for Expo Go) |
| `npm run web` | `expo start --web` |
| `npm run typecheck` | `tsc --noEmit` for the app and for `test/` |
| `npm test` | Unit tests (`node:test` via tsx): throttle timing, reconnect/backoff/stale detection, sync rules, presets vs `assessBigJump`, URL parsing, haptic rules |
| `npm run export:web` / `npm run export:android` | Production bundles (proves Metro can bundle `../shared`) |
| `npm run doctor` | `expo-doctor` |

## Shared protocol

The app imports the wire protocol directly, with `import … from '../../../shared/protocol'`. Nothing is copied
or generated. To make that work:

- `metro.config.js` adds `../shared` to `watchFolders`, and pins module resolution to this app's
  `node_modules`.
- `tsconfig.json` includes `../shared/**/*.ts`.

The same file drives the slider ranges, the physics preview and the big-jump verdict, so the dashboard always
agrees with the game and the relay.

## Troubleshooting

- **Stuck on `RETRY IN Ns` / "Could not reach the relay".**
  - Check the relay is running: `npm start` in `server/`.
  - Open `http://<computer-ip>:8787/health` in the **phone's browser**. If that times out, the problem is the
    network or a firewall, not the app.
  - Don't use `localhost` on a phone. There, `localhost` means the phone itself.
- **Firewall.**
  - macOS: allow incoming connections for `node`.
  - Windows: allow Node.js on *Private* networks, and set the Wi‑Fi profile to Private.
  - Linux: for example `sudo ufw allow 8787/tcp`.
- **Guest, office or hotel Wi‑Fi** often blocks device-to-device traffic (client isolation). A phone hotspot
  with the laptop joined to it works well. Pause VPNs on both devices.
- **iOS local network permission.** iOS 14+ asks before an app may talk to devices on your LAN.
  - In Expo Go, allow **Local Network** when prompted, or later in Settings → Privacy & Security → Local
    Network → Expo Go.
  - In a development or standalone build, the prompt text comes from `ios.infoPlist.NSLocalNetworkUsageDescription`
    in `app.json`. `NSAppTransportSecurity.NSAllowsLocalNetworking` permits plain `ws://` to LAN addresses.
- **Android cleartext `ws://` in dev builds.** Expo Go already allows it. Android 9+ blocks cleartext traffic
  in release-style builds. This project enables it through the `expo-build-properties` plugin in `app.json`
  (`android.usesCleartextTraffic: true`), so `npx expo run:android` and EAS builds can still reach
  `ws://192.168.x.x:8787`. Remove that setting if you ever ship against a `wss://` relay only.
- **`expo start --tunnel`** only tunnels Metro, not the relay. Use LAN mode, or expose port 8787 yourself and
  enter that `ws://` / `wss://` address.
- **Web build served over HTTPS.** Browsers block `ws://` from `https://` pages (mixed content). Serve the
  dashboard over `http://` on the LAN, or put the relay behind `wss://`.
- **Fonts look like a plain monospace.** Orbitron and Share Tech Mono load at startup. If they fail or take
  more than 4 s, the app falls back to the system monospace and keeps working.

## Layout

```
dashboard/
  index.ts                     registerRootComponent → src/App
  app.json                     name SquadHQ, slug squadhq, dark UI/splash, iOS local-network + ATS, Android cleartext
  metro.config.js              watchFolders += ../shared
  public/index.html            dark web shell (no white flash), slider focus ring
  src/
    App.tsx                    fonts, splash, saved link prefs, auto-connect, AppState → wake()
    theme.ts                   palette (#05060A / #0B0F1A / cyan / magenta / yellow / acid green), glow helper
    net/squadLink.ts           WebSocket client: hello, ping/latency, backoff + jitter, stale detection
    net/controlsThrottle.ts    leading + guaranteed-trailing throttle, flush/force
    net/serverUrl.ts           default relay URL (Metro hostUri / page host), input validation
    squad/controller.ts        stores + every protocol decision (sync rule, remote merge, game state)
    squad/sync.ts              pure adopt/push rule and mid-drag merge
    squad/presets.ts           the four presets
    state/store.ts             tiny external store + useStore (useSyncExternalStore)
    features/                  ConnectionCard, ControlSliderCard, PresetsCard, BigJumpCard, TunePreviewCard, TelemetryPanel
    ui/                        Panel (notched corners), Header (glitch title + LED), Background (grid + scan beam), Meter, Badge, NeonButton, Txt
  test/                        node:test suites (npm test)
  docs/                        screenshots
```
