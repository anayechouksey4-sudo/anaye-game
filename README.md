# SquadHQ Racer

A voxel racing game you tune live from your phone.

<p>
  <img src="docs/game-launch.png" alt="Voxel hypercar launching on the GamerFleet Chaos Track with tyre smoke" width="68%">
  <img src="docs/dashboard.png" alt="SquadHQ dashboard with the Front Wing Aero and Engine Tier sliders" width="28%">
</p>

| Folder | What it is | Stack |
| --- | --- | --- |
| [`game/`](game/README.md) | 3D racer: voxel hypercar, the **GamerFleet Chaos Track** over a bottomless void, F1-style aero and drivetrain physics | Vite, React Three Fiber, @react-three/rapier |
| [`dashboard/`](dashboard/README.md) | Cyberpunk control panel with **Front Wing Aero**, **Engine Tier** and **Chassis Balance** sliders, big-jump readiness and live telemetry | Expo, React Native |
| [`server/`](server/README.md) | Local WebSocket relay on port 8787 that connects the two | Node, ws |
| [`shared/protocol.ts`](shared/protocol.ts) | Wire protocol and the slider → physics mapping used by all three | TypeScript, no dependencies |
| [`scripts/dev-all.mjs`](scripts/dev-all.mjs) | One-command launcher (installs, starts everything, prints the URLs) | Node, concurrently |

## Run everything with one command

Needs Node 22 or newer.

```bash
npm run dev:all
```

This one command:

1. Installs dependencies for the root, `server/`, `game/` and `dashboard/`, one package at a time. On later runs it skips any package whose `package.json` and lockfile haven't changed.
2. Starts the relay, the game and the dashboard together in this terminal. Each service's log lines are prefixed with its name.
3. Waits until each service answers, then prints a summary like this:

```
────────────────────────────────────────────────────────────────────────
 SQUADHQ // ALL SYSTEMS LIVE
   RELAY      ws://localhost:8787          ws://192.168.1.23:8787
   GAME       http://localhost:5173        http://192.168.1.23:5173
   DASHBOARD  exp://192.168.1.23:8081      web: http://localhost:8081

 Game + dashboard connect to the relay on port 8787 of whichever host served them.
 Dashboard on a phone: Expo Go → "Enter URL manually" → exp://192.168.1.23:8081
 Ctrl+C stops everything.
────────────────────────────────────────────────────────────────────────
```

Press Ctrl+C to stop all three services. Closing the terminal (or the Termux session) or `pkill -f dev-all` stops them too. If the launcher itself was killed (for example by Android's low-memory killer) and left a service holding its port, free the ports with `fuser -k 8787/tcp 5173/tcp 8081/tcp` (`pkg install psmisc` on Termux if `fuser` is missing).

| Command | Does |
| --- | --- |
| `npm run dev:all` (or `npm start`) | Install what's missing, then run all three |
| `npm run start:all` | Run all three without the install check |
| `npm run setup` | Install only |
| `node scripts/dev-all.mjs --fresh` | Delete `node_modules` and reinstall every package from scratch (repairs an interrupted install) |
| `node scripts/dev-all.mjs --only=relay,game` | Run only some services |
| `npm run dev:relay` / `dev:game` / `dev:dashboard` | Run one service on its own |
| `npm test`, `npm run typecheck`, `npm run build` | Relay and dashboard tests, typecheck all three, production build of the game |

### On an Android phone (Termux)

```bash
pkg update && pkg install nodejs-lts git
git clone https://github.com/anayechouksey4-sudo/make-an-app-like-claude-and-chatgpt-mixed.git
cd make-an-app-like-claude-and-chatgpt-mixed
git checkout claude/racing-game-physics-dashboard-fzyqvv
npm run dev:all
```

The launcher handles the parts of Termux that usually break Node dev servers:

- **No `/bin/sh` on Android.** Services are started through Termux's own shell.
- **Blocked network listing.** Android can block `os.networkInterfaces()` (the error is `uv_interface_addresses returned Unknown system error 13`). The launcher finds the Wi-Fi address another way. It also preloads `scripts/termux-netfix.cjs` into every service, so Vite and Expo don't crash.
- **Limited memory.** The three installs run one after another, not in parallel.

The first install and Metro's first bundle can take several minutes on a phone. Run `termux-wake-lock` first so Android doesn't put Termux to sleep while that happens.

Then, on the same phone:

- **Game:** open `http://localhost:5173` in Chrome.
- **Dashboard:** open Expo Go and enter `exp://127.0.0.1:8081`. You can also open `http://localhost:8081` in a second Chrome tab. It connects to the relay on its own; the Connection panel should turn ONLINE within a few seconds.

Other devices on the same Wi-Fi use the LAN URLs from the summary instead.

## How the pieces talk

```
 dashboard ──squad:controls──▶  relay :8787  ──squad:controls──▶  game
    ▲                             (ws)                              │
    └────── game:state, game:telemetry (10 Hz) ◀────────────────────┘
```

- The **game** connects to `ws://<host that served the page>:8787`. To use a different relay, add `?ws=192.168.1.23:8787` to the game URL. `?ws=off` plays offline.
- The **dashboard** connects to the relay on the machine that served it: the Expo dev host on a phone, or the page's host on the web. You can edit the URL in its Connection panel.
- Slider moves are sent up to 30 times a second. The game remaps its physics on the next physics step, without remounting the car or restarting the run.
- The relay keeps the latest controls, physics and telemetry. A dashboard or game that joins late starts from that snapshot.

## The sliders

| Slider | Range | What it does in the game |
| --- | --- | --- |
| **Front Wing Aero** | 0–100 % | Downforce at the **front axle**, proportional to speed². It works against a fixed body lift. Below about 42 % the front nets lift, and at high speed the nose physically rises. More wing also adds drag. |
| **Engine Tier** | T1–T5 | Base torque on the **rear wheels**: 700 → 3500 N·m (+60 kg per tier). At T4–T5 the rear tyres break traction and smoke on launch. |
| **Chassis Balance** | −50…+50 | Moves the rigid body's **centre of mass** (70/30 to 30/70 front/rear) and re-splits the **suspension stiffness** between the axles. |

The **massive jump** at the end of the track needs about 183 km/h at the lip with the nose still down. That means Engine Tier 5 and a narrow wing window: roughly 15–35 % at balance 0, wider with a front-heavy balance. The dashboard's Big Jump Readiness card predicts READY / TOO SLOW / NOSE LIFT from the same formulas the game uses. It also shows the real speed the game measured at the lip.

## Repository note

Original description of this repository:

> Make an app like claude and chatgpt mixed together and name it as Anaye.Ai
