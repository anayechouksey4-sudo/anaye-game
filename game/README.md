# SquadHQ Racer (game/)

3D voxel racer built with React Three Fiber + `@react-three/rapier`: **five original cars**
(garage), **six maps** (four procedural parkour courses over the void, a drag strip and a test
straight), start lights, results with medals, synthesized engine sound and phone vibration, and a
☰ menu that holds everything a phone player needs. The car's physics are tuned live over WebSocket
by the **SquadHQ** dashboard (`dashboard/`) through the relay (`server/`); the dashboard follows the
car and map you picked. The wire protocol and the physics model live in
[`../shared/protocol.ts`](../shared/protocol.ts).

```
dashboard (sliders) ──squad:controls──▶ relay :8787 ──▶ game ── mapSquadControlsToPhysics ─▶ car (next physics step)
                    ◀──game:state / game:telemetry (10 Hz)──
```

## Run

```bash
npm install
npm run dev          # http://localhost:5173  (vite dev, StrictMode)
npm run build        # tsc -b && vite build → dist/
npm run preview      # http://localhost:4173  (serves dist/)
npm run typecheck
```

Start the relay first (`cd ../server && npm start`) — the game runs fine without it and keeps
retrying in the background.

### URL parameters

| Param | Meaning |
| --- | --- |
| `?ws=<url>` | Relay address: `host`, `host:port` or a full `ws://` / `wss://` URL. `?ws=off` disables networking. |
| `?track=<id>` | Map: `chaos` (default), `ribbon`, `isles`, `cryo`, `strip` or `test` (see [Maps](#maps)). Wins over the map saved from the menu; unknown ids fall back to `chaos`. |
| `?car=<id>` | Car: `hypercar` (default), `rally`, `muscle`, `formula` or `buggy` (see [Cars](#cars-garage)). Wins over the saved car; unknown ids fall back to the hypercar. |
| `?plate=<text>` | Number plate for the car the page opens with (`?car=`, else the saved / default car), normalized like the editor (A–Z 0–9 spaces, ≤ 14) and kept in the save, so `?car=coupe&plate=UK%2007%20DW%202400` is a shareable link (see [Number plates](#number-plates)). The four newer ids `coupe`, `drift`, `electric`, `kart` work in `?car=` too. |
| `?seed=<n\|text>` | Chaos-track layout seed (integer, or any text — hashed). Omitted = the hand-validated default seed `1337`. |
| `?touch=1` / `?touch=0` | Force the on-screen touch controls on / off. |
| `?debug=1` | Rapier collider wireframes. |

Relay URL resolution: `?ws=` → `VITE_SQUAD_WS_URL` (build-time env) → `ws://<page hostname>:8787`,
so opening the game from another device on the LAN just works.

The picked car and map, sound, volume and vibration are remembered in `localStorage`
(`src/state/selection.ts`, best effort: a private tab just starts from the defaults). Best times are
kept per map **and** car. Every key the game writes (each read once at load with a field-by-field
check, written on change, wrapped in try/catch so a blocked store only costs the memory):

| Key | Holds | Owner |
| --- | --- | --- |
| `squadhq.selection.v1` | car, map, sound / volume / vibration, the garage's number plates | `state/selection.ts` |
| `gamerfleet.best.<track>` / `gamerfleet.best.<track>.<car>` | best time per map and car (ms; the hypercar's key has no car suffix) | `state/store.ts` |
| `gamerfleet.profile.v1` | drivers, active driver, MY RIDE, mounted flag | `state/profile.ts` |
| `gamerfleet.hud.v1` | TELEMETRY and MINIMAP switches | `hud/uiStore.ts` |
| `gamerfleet.input.v1` | steering mode, tilt range, invert, calibration offset | `state/inputSettings.ts` |
| `gamerfleet.rivals.v1` | RIVALS 3 / 1 / OFF, GHOST | `rivals/store.ts` |
| `gamerfleet.ghost.v1.<track>.<car>` + `gamerfleet.ghost.v1.index` | shadow-ghost tapes (≤ 64 KB each, LRU at 1.5 MB) | `rivals/ghost.ts` |
| `gamerfleet.skid.v1` | SKID MARKS switch | `car/skid/skidStore.ts` |
| `gamerfleet.career.v1` | career: records per map × car, totals, trophies with unlock times | `career/store.ts` |
| `gamerfleet.relay.v1` | relay address typed in FRIENDS → CONNECT; the hosted copy's start-up script uses it when the address has no `?ws=` | `multiplayer/FriendsTab.tsx`, `scripts/build-pages.mjs` |
| `gamerfleet.friends.v1` | rooms: this device's player token (random, never shown), YOUR NAME, the last ROOM SIZE, whether the name card was answered | `multiplayer/friendsProfile.ts` |
| `gamerfleet.room.v1` | rooms: the room this page is seated in and when it was last alive there (`{code, at}`), so a reload within the 120 s seat grace takes the seat back; in `sessionStorage` (this tab) and, for the installed app, `localStorage` | `multiplayer/friendsProfile.ts` |
| `gamerfleet.camera.v1` | SETTINGS · CAMERA (CHASE / ORBIT / HOOD; nothing stored = CHASE) | `state/store.ts` |
| `gamerfleet.signin.v1` | `'1'` after a Google sign-in on this device (offers one-tap next time); removed by SIGN OUT. Never the token, never an email | `auth/authStore.ts` |
| `gamerfleet.announce.closed.v1` | ids of the owner announcements closed with ✕ (the last 8), so a reconnect does not bring them back | `hud/announce.ts` |
| `tessera.air.v1`, `tessera.trap.v1` | the island's Kite Launcher air time and speed-trap bests per car | `track/world/physics/records.ts` |

The service worker's caches are named `gf-racer-<version>`; rooms (FRIENDS) keep only `gamerfleet.friends.v1` and `gamerfleet.room.v1` locally; Google sign-in keeps only `gamerfleet.signin.v1` (a flag, never the token).

## Install as an app

The game is an installable web app. The build emits `manifest.webmanifest`, the icons in
`public/icons/` and a service worker (`sw.js`, written by the small plugin in `vite.config.ts` from
the final list of emitted files) that precaches the whole game: hashed assets, `index.html`, the
manifest, icons and favicon, about 5 MB.

- **Install:** ☰ MENU → SETTINGS → APP → **INSTALL APP** (Chromium browsers offer it once they fire
  `beforeinstallprompt`). Elsewhere use the browser menu (*Install app* / *Add to Home screen*);
  on iPhone / iPad: Share → Add to Home Screen. Installed, it opens full screen (`display: standalone`,
  any orientation) and the card reads INSTALLED · PLAYS OFFLINE.
- **Offline:** once the card shows OFFLINE READY the game boots with no network: navigations go to
  the network first and fall back to the cached `index.html` after 3 s without an answer, hashed
  `assets/*` are served cache-first, manifest and icons stale-while-revalidate. Non-GET and
  cross-origin requests are never cached, and the relay is a WebSocket (never cached): `?ws=off`,
  the hosted copy's default, keeps the game in OFFLINE MODE.
- **Updates:** each build carries a `VERSION` (hash of the emitted files). On the next page load the
  browser installs the new worker, which precaches the new files, deletes this app's older caches
  (`gf-racer-*`) and takes over without reloading the page; the card then shows **UPDATE INSTALLED ·
  RESTART TO USE IT** with a RESTART button. A fresh page start simply gets the new version.
- Service workers run only in production builds (`import.meta.env.PROD`); registration is wrapped
  in try/catch (the page also runs inside sandboxed frames). Debug handle `window.__PWA__`:
  `state()`, `promptInstall()`, `restart()`, `checkForUpdate()`.
- `node ../scripts/build-pages.mjs` copies everything the build emits (`assets/`, `sw.js`,
  `manifest.webmanifest`, `icons/`, `favicon.svg`) into `docs/`; the worker's scope is `./`, so the
  same files work under `/<repo>/` on GitHub Pages and at `/` locally.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle (waits for GO at the start of a run) |
| S / ↓ | Brake; reverse once stopped |
| A D / ← → | Steer (speed sensitive) |
| Space | Handbrake |
| W + S | Burnout (front brakes hold, rears spin) |
| R | Respawn at the last checkpoint |
| T / Backspace | Restart the run (with start lights) |
| C | Camera: chase → orbit (mouse) → onboard |
| P | Physics panel (live sliders for every `CAR_PHYSICS_SPECS` param) |
| H | Help |
| Esc / M | ☰ menu: pause, garage, drivers, MY RIDE, maps, physics, settings, squad link, friends (Esc / M again closes it) |

While the menu is open only Esc / M do anything; the other hotkeys are ignored.

**Gamepad (AUTO).** A standard-mapping pad is used as soon as it is connected (Chrome needs one
button press first; the game looks for pads once a second and shows a GAMEPAD CONNECTED chip for
3 s): left stick X steers (dead zone 0.12, response curve ^1.5), D-pad ◀ ▶ full lock, RT throttle,
LT brake, A handbrake, B respawn, Y restart, Start the ☰ menu. Pad pedals wait for GO like the
others and add up with the keyboard / touch pedals; the stick beats the steer pad and tilt. Works in
desktop Chrome / Firefox / Edge and Android Chrome; ☰ MENU → SETTINGS → CONTROLS shows the pad's name.
Every source is composed in one place, `src/input/inputBus.ts` → `src/input/compose.ts`, and fed
through `car/input.ts setTouchInput`, so with no pad and tilt off the car reads exactly the keyboard /
touch input it always did (`__RACER__.setInput` still overrides everything).

### Touch (phones and tablets)

Phones and tablets get on-screen controls automatically (a coarse primary pointer, or touch with no
hover-capable pointer; a laptop with a touchscreen stays a desktop). `?touch=1` forces them on,
`?touch=0` off. They work alongside the keyboard, and `__RACER__.setInput` still overrides both.

| Control | Action |
| --- | --- |
| Steer pad (left thumb, ◀ ▶) | Analog steer from the finger's position: a thumb on ◀ / ▶ is full lock like A / D, sliding toward the centre gives partial lock for fine corrections. The pad keeps its finger while it slides sideways off the pad (past an edge = full lock that side) and lets go only when the finger lifts or moves more than 80 px above or below it. |
| GAS · BRAKE / REVERSE · DRIFT (right thumb) | Throttle, brake (reverses once stopped), handbrake. A finger presses whichever pedal it is on, so one thumb can slide gas → brake or gas → drift. |
| ⟲ RESPAWN (top right) | Same as R. The one quick-access button; it fires when the finger lifts on it (slide off to cancel). |
| ☰ MENU (top right) | Opens the menu (pauses the game). Everything else lives there: controls (tilt steering, gamepad), camera, HUD, physics, telemetry, garage, maps, sound, vibration, fullscreen, app install, squad link. |

**Tilt steering.** ☰ MENU → SETTINGS → CONTROLS → STEERING: **TILT** (phones with an orientation
sensor only). Rolling the phone steers: the roll is read from the gravity vector (`gamma` in
portrait, `±beta` in landscape by `screen.orientation`, and it keeps working with the phone tilted
back), minus the calibration offset taken when TILT is switched on and whenever you tap
**CALIBRATE** (hold the phone the way you play), a 2° dead zone, then linear to full lock at the
TILT RANGE (QUICK 14° · NORMAL 22° · GENTLE 35°), optional INVERT, smoothed with a 60 ms time
constant. With tilt on the ◀ ▶ pad is hidden (not removed: the layout variables and the pedal
cluster stay exactly where they were) and a read-only TILT indicator with the live steer takes its
place; GAS / BRAKE / DRIFT work as before. iPhone / iPad ask for motion access when you tap TILT;
a refusal shows TILT NOT ALLOWED and keeps the pad. Settings persist under `gamerfleet.input.v1`
(`src/state/inputSettings.ts`); debug handle `window.__INPUT__` (`status()`, `liveSteer()`,
`liveTiltRoll()`, `setSteeringMode()`, `calibrateTilt()`, `settings()`); unit test
`test/input.test.ts` (composition, tilt mapping, gamepad reading, settings validation).

**Start gate.** On a touch device every page load opens with a small card (map, car, **▶ RACE ·
FULLSCREEN** and **RACE IN THIS WINDOW**). Phone browsers only start audio from a touch that *ends*,
and a GAS thumb held through the start lights doesn't end, so without the card the first run would
be silent until that finger lifted. The tap unlocks the sound, optionally goes fullscreen (landscape
where the browser allows) and restarts the run so the lights count down with their beeps
(`src/hud/StartGate.tsx`). Keyboard players never see it.

Every finger is tracked separately (steer and throttle at the same time) and everything is
released when a finger is cancelled, the window loses focus, the tab is hidden or the menu opens; a
finger that was down then has to lift before it can press again. A touch on a control never fires
a follow-up click (so ☰ can't "click" the menu's ✕ that appears under the finger).

Phone layout (`hud--compact`): one slim **top bar** holds the speed (+ the gear you hear from the engine sound, R reversing, AIR in flight; a thin bar
of speed vs. the estimated top speed) and the run timer + checkpoint count, so nothing sits over the
car, the road ahead or the thumbs. It is centred in landscape and on the left in portrait, with
⟲ / ☰ at the top right (side by side in landscape, stacked in portrait). Squad Link and telemetry
are chips under it (landscape: top left) that expand on tap; the menu's HUD switch (or H) hides
them. Checkpoint / fall callouts and the start lights appear just under the top bar. The thumb
controls sit 28 px in from the side edges (outside Android's edge back-gesture zones), the in-race
buttons are 56 px (pedals and steer pad bigger), and below 320 px of landscape height (360 dp phones with the browser bars
showing) the pedal cluster gets lower. Checked free of overlaps at 412×839, 360×780, 360×640,
863×360, 780×360, 740×280 and 800×264. Desktop windows keep the timer on top, the big speedometer
at the bottom and add ☰ MENU at the top right.

The physics sliders are safe inside a scrolling panel on a phone: a vertical swipe that starts on a
slider scrolls the panel and never changes a value, a tap does nothing, and only a horizontal drag
(more than 8 px, more sideways than down) moves the value, relative to where it was (the full track
width is the full range). Desktop keeps the native slider.
Touch devices render at a device-pixel ratio of at most 1.5 with a 512 px sun shadow map.

### ☰ Menu, start lights and results

**Menu** (☰, Esc / M). Opening it **pauses the game**: `App.tsx` renders `<Physics paused>` from
`useSelection().menuOpen`, so no physics steps run and the run clock, the start lights, the hazard
clock, pendulums, shutters and tiles all freeze and carry on exactly where they were. The Android
back button (and browser back) closes it: opening pushes a history entry, popstate closes, and
closing any other way pops that entry again. Thumb-sized and scrollable in both orientations: nine
tabs as a 3 × 3 grid on top in portrait, a rail on the left in landscape (two columns of five on a
phone up to 420 px tall, three columns of three on a 740×280 / 800×264 screen, one column on a desktop;
the rail scrolls if it ever runs out of room), every tab ≥ 44 px, with RESPAWN · RESTART · **RESUME**
always at the bottom and ✕ where ☰ was (`menu.css`).

**Auto-pause on an app switch** (`src/hud/autoPause.ts`). Flipping to Termux, taking a call or
pulling down the notification shade mid-run opens the menu on RACE by itself, through the same
`openMenu` path as ☰, so you come back to PAUSED with everything where it was and carry on with
RESUME. Triggers: `visibilitychange` to hidden, `pagehide`, and on touch devices window `blur` (the
shade, split screen, a system dialog). A desktop window losing focus never pauses. It only fires
while there is something to freeze (a run in progress or the start lights counting, the menu closed,
no results showing): never behind the touch start card or after the finish. Details:
- `App.tsx` subscribes to `menuOpen` *inside* the R3F tree (`PausablePhysics`), so the pause commits
  in a microtask right after the hide event, before the page can be frozen or draw again.
  `@react-three/rapier` never steps while paused, so the first frame back (which carries the whole
  hidden time as its delta) runs no catch-up steps; the run clock, lights and hazards add nothing.
- Repeated hides while paused do nothing (the menu is already open). The Android-back history entry
  is pushed as usual, but when the menu opens while the page is already hidden the entry is pushed
  once the page is visible again (`visibilitychange` / `pageshow`), so a page that is being unloaded
  or put in the back/forward cache never gets one.
- Touch fingers are released by TouchControls (hidden tab / blur / menu open) and must lift before
  they press again; held keys are dropped on a hidden tab too. The audio ducks and suspends from the
  same menu and visibility state as a manual pause.

Verified with real hidden periods (raw Chrome `--headless=new` over CDP, where a background tab
really hides the page and stops rAF; phone viewport, touch emulation, GAS held): 3 s in a background
tab, and 3 s background + `Page.setWebLifecycleState` frozen → menu open on RACE, physics step count,
run time and car position identical before and after, **0 physics steps in any frame after coming
back** (the build before this change: menu closed and a 17-step burst in the first frame back), one
history entry, the audio context suspended while hidden and ducked under PAUSED; RESUME carries on,
the GAS finger held through the switch doesn't drive until it lifts. Also checked with simulated
hides (overridden `visibilityState` + events): nothing behind the start card, frozen start lights,
no history entry while hidden, no stacking on repeated hides, touch blur pauses, desktop blur
doesn't, `pagehide` pauses, Android back closes it, no pause after the finish.

| Tab | What's in it |
| --- | --- |
| RACE | Current map and car (tap to change), time / checkpoint / falls / best + medal for this car on this map, this car's medal times there ([Medals per car](#medals-per-car)) or, when the car can't clear the map's big jump, a BIG JUMP OUT OF REACH note with the speed needed vs the car's top speed; camera (chase / orbit / hood), how to drive, the map's setup tip |
| GARAGE | A card per car (`CAR_CATALOG`): accent, tagline, top speed / accel / grip / weight bars, your best time on the current map + medal and that car's gold / silver / bronze times there, or a JUMP OUT OF REACH badge (needs … km/h · max …) and no medals. Picking one starts a fresh run at the start line with that car |
| MAPS | A card per map (`TRACK_CATALOG`): difficulty pips, BIG JUMP badge with its lip speed, ice grip badge, JUMP OUT OF REACH badge + one line when the current car can't clear the jump, description, setup tip, best time with the current car, medal earned and the current car's gold / silver / bronze times (none when out of reach). Picking one loads it with a fresh run |
| PHYSICS | Every physics slider (the game is paused while you tune) + reset, and SHOW WHILE DRIVING for the floating panel |
| DRIVERS · MY RIDE | The five block-built drivers and the build-your-own look ([Drivers and MY RIDE](#drivers-and-my-ride-srcdrivers-srcride-srcstateprofilets)) |
| SETTINGS | Grouped: **CONTROLS** (STEERING TOUCH / TILT, TILT RANGE, INVERT TILT, CALIBRATE, GAMEPAD · AUTO status — `src/input/InputSettings.tsx`), **RACE** (RIVALS 3 / 1 / OFF, GHOST, SKID MARKS — `src/rivals/RivalsSettings.tsx`, `src/car/skid/SkidSettings.tsx`), **DISPLAY** (HUD: status chips on phones, help panel on desktop; TELEMETRY; MINIMAP; FULLSCREEN), **CAMERA**, **SOUND & FEEL** (SOUND + VOLUME, VIBRATION — `useSelection().settings`, persisted), **APP** (install / offline / update card — `src/pwa/InstallCard.tsx`). Every control is a 44 px+ button or switch |
| SQUAD | Link status, relay URL, dashboards online, round trip, last update, the squad's Front Wing Aero / Engine Tier / Chassis Balance, the big-jump verdict for this car on this map, the uplink feed |
| FRIENDS | Rooms over the relay ([Play with friends](#play-with-friends-srcmultiplayer)): YOUR NAME, ROOM SIZE + HOST A ROOM / JOIN by code, the room code and share link with `n/size`, the player list (RECONNECTING… rows) with READY, START, REMOVE and MAKE HOST (host) and LEAVE, the results table |

**Start lights.** Every new run (first load, restart, map or car change, RETRY / NEXT MAP; never a
respawn) begins with 3 · 2 · 1 · GO, one light every 0.8 s of simulated time
(`src/game/countdown.ts`, ticked by RunController after each physics step, so they freeze with the
menu and are deterministic under `__RACER__.advance`). Until GO, throttle and brake from the
keyboard, touch and gamepad do nothing (steer and handbrake still work); the timer starts on GO,
so holding GAS through the lights gives a perfect launch. Each light emits the `countdown` game event
(`{ step: 3 | 2 | 1 | 0 }`, 0 = GO) for sounds. A car that can never clear the map's big jump gets a
one-line BIG JUMP OUT OF REACH · NEEDS … KM/H · <CAR> MAX … under the lights (and on the touch start
card), kept between the steer pad and the pedals in landscape. A scripted driver (`__RACER__.setInput` with
throttle > 0) skips the lights and the run starts on its first throttle, as before, so automated
runs keep their timings.

**Results.** Crossing the finish shows the map · car it was driven with (on a narrow landscape card it
wraps at the dot, or drops under FINISH, rather than cut the car's name), the time, NEW RECORD (with
the improvement), the medal against this car's medal times on the map (`medalsFor(trackId, carId)`,
[Medals per car](#medals-per-car)) and the time to the next one (e.g. GOLD AT 0:34.500 for the Dune
Goblin on the strip), best for this car + map, checkpoints, falls and the big-jump lip speed; RETRY, NEXT MAP (the next catalog map) and GARAGE (opens the menu on the
garage). The car keeps rolling underneath; ✕ hides the card. Best times are per map and car
(`loadBestTime(trackId, carId)` in `state/store.ts`); medal maths in `state/records.ts`.

`window.__HUD__` (tests / console): `countdown()` → `{ serial, active, step }`, `countdownEvents()`
(the last 32 `countdown` events with the physics step they fired on), `menu.open(tab?)`,
`menu.close()`, `menu.isOpen()`, `menu.tab()`, `resultsVisible()`, `autoPauses()` (each auto-pause:
reason, time, physics step and run time at the pause), `medals(trackId?, carId?)` and
`reach(trackId?, carId?)` (the per-car medal times and big-jump reach below; default = current pick).

## Cars (garage)

Five original cars (no real brands, models or logos). Each is a car **class** in
`shared/protocol.ts → CAR_CLASSES` (slider mapping, aero, drivetrain, geometry, big-jump profile),
with geometry in `src/car/vehicleSpec.ts → getVehicleSpec(carId)`, a voxel model in
`src/car/model/<car>Shape.ts`, an engine sound in `src/audio/presets.ts` and a garage card in
`src/car/catalog.ts`. The dashboard sliders mean the same three things for every car, mapped with
that car's coefficients (`mapSquadControlsToPhysics(controls, carId)`), so the squad tunes whatever
you are driving.

| Car (id) | Character | Top speed, default sliders / tier 5 | 0–100 at tier 5 | Peak grip | Chaos big jump |
| --- | --- | --- | --- | --- | --- |
| Neon Hypercar (`hypercar`) | Pearl wedge hypercar, RWD. The car every map is calibrated on | 137.5 / 203.6 km/h | 4.9 s | 1.41 g | tier 5, 20–34 % wing (11–39 % at balance −40) |
| Glitch Rally (`rally`) | Lime hatch, light and short, AWD 45:55, grippy, short-geared | 131 / 190 | 4.0 s | 1.75 g | only 0–4 % wing, tier 5, balance −40 (very specific) |
| Bruiser V8 (`muscle`) | Violet muscle coupe, heavy, big low-end torque: smokes off the line from tier 3 and wants to wheelie | 140 / 192 | 4.5 s | 1.21 g | 18–22 % / tier 5 / 0, or 8–22 % at −40 |
| Razorwing (`formula`) | Cyan open-wheeler, featherweight, huge wings, very stable at speed | 128 / 215 | 3.75 s | 3.24 g | 7–19 % / tier 5 / 0 (tier 4 can't) |
| Dune Goblin (`buggy`) | Orange buggy, big wheels, long soft suspension, high centre of mass, AWD 40:60 | 99 / 133 | 9.25 s | 1.25 g | can't: tops out at 133 km/h |
| Ember Swallowtail (`coupe`) | Red rear-engined road coupe, RWD, 60 % of the weight on the back axle: hooks up where the hypercar spins (rear slip 0.01 at tier 5), nose light at speed (body lift 2.2 of a 5.5 wing), tail-happy in corners (2.4× the hypercar's rear slip for the same steer; the proposal's lift-off envelope needs `carController.ts` and was not built this round) | 141.9 / 204.7 (est.); nose lifts at 145.8 with 0 % wing (est. 145.6) | 4.6 s | 1.5 (traction) | tier 5, 21–37 % wing at balance 0 (13–37 % at −40); 20 % ran off before the lip, 24 % cleared at 188.3 km/h |
| Smoke Lantern (`drift`) | Teal long-nosed drift coupe, RWD, low grip under a turbo lump: the rears spin at every tier (slip 1.0) and shed 70 % of their side grip while spinning, 45° of lock, loose handbrake. Built for the DRIFT button | 145.2 / 205.3 (est.); nose lifts at 168.5 with 0 % wing (est. 170.9) | 5.7 s | 1.28 (traction) | tier 5, 18–43 % wing at balance 0 (42 % cleared at 183.0); at balance −40 it spins to the lip at ~165 km/h and falls short whatever the wing |
| Ion Dragonfly (`electric`) | Metallic-blue dual-motor saloon, AWD 50:50, 1.9 t on a flat battery floor, launch boost 1.8 fading by 100 km/h, no exhaust: its tier colour lives in the rear light strip | 141.8 / 199.5 | 5.0 s (AWD, no wheelspin) | 1.5 (traction) | tier 5, 0–24 % wing, any balance (tier 4: 181.8 < 183); lands chaos from 175 km/h (36 % wing cleared at 176.2, so the estimate is conservative above 24 %) |
| Pixel Gnat (`kart`) | White single-speed kart, 430 kg, open wheels, an open bucket seat that carries the active driver's bust, stiff springs | 121.3 / 175.6 (est.); nose lifts at 149.8 with 0 % wing (est. 150.6) | 4.0 s | 1.6 (traction) | can't: needs 190 km/h of estimated top speed, max 175.6. Makes the Isles leap at tier 5, 8–14 % wing (10 % / −30 cleared at 166.3) |

- Picking a car (garage or `__RACER__.setCar`) re-maps the physics from the squad's last sliders
  (or that car's defaults), loads that car's best time, remounts the car at the start line and
  starts a fresh run with the start lights.
- The hypercar drives bit-identically to the single-car game (checked by the CARS pass on both tracks).
  The rally and the buggy use a torque-sensing centre diff that never asks the front tyres for more
  than 60 % of their grip, so an AWD launch hooks up: on tarmac no wheel spins at any tier (no smoke
  — that traction is the AWD advantage), on ice only the rears spin and smoke. Their hard launches
  kick up light dust instead, a purely visual effect ([Tyre smoke](#tyre-smoke-srccarsmoke)).
- Each car is one body mesh, 4 wheels and its wing elements (7–8 draw calls), built once per page
  and cached; the whole frame stays at 34–35 draw calls at the chaos spawn with any car.
- `game:state` carries `carId`, `trackId` and `bigJumpKmh` (null on maps without a big jump), and is
  re-sent on any change, so the dashboard previews and verdicts are for this car on this map.

### The four newer cars (coupe, drift, electric, kart)

Added after the five above; the five existing classes' numbers are byte-identical. Measured on
`?track=test` with `__RACER__.advance` (standing start, full throttle): Ember Swallowtail 50/3/0 →
141.9 km/h (estimate 142.1), 0–100 in 7.9 s; 20/5/0 → 194.8 (est. 194.6), 0–100 4.65 s, rear slip 0.01
(the hypercar spins to 1.0); 0/5/0 → nose lifts at 145.8 (est. 145.6). Smoke Lantern 50/3/0 → 145.2
(est. 145.3), rear slip 1.0 at every setting; 0/5/0 lifts at 168.5 (est. 170.9); 20/5/0 → 195.8 (est. 196.0).
Ion Dragonfly 50/3/0 → 141.8 (est. 142.3), 0–100 8.45 s; 0/5/0 → 199.5 (est. 200.8), 0–100 5.0 s, never
lifts (est. 253.9). Pixel Gnat 50/3/0 → 121.3 (est. 121.4); 0/5/0 lifts at 149.8 (est. 150.6);
20/5/0 → 167.4 (est. 167.4), 0–100 4.1 s. Big-jump calibration (jump checkpoint, tier 5, autopilot flat
out; 58 runs on chaos + Isles, `scratchpad features/cars-plates/build/jumpscan.jsonl`): the protocol
verdict matched the outcome in 47; the four optimistic cases set the classes' `jumpSpeedScale` /
`noseLiftReserveKmh` (coupe reserve 12, drift 1.02, electric 1.03, kart 1.04 — comments in
`shared/protocol.ts`); the remaining seven are NOSE LIFT / TOO SLOW verdicts on the Isles' short
run-up for cars that cleared (the safe direction), and the Smoke Lantern at balance −40 (wheelspin
to the lip, below any wing's reach). Landing lip speeds seen so far (first 0.5 km/h above the fastest
fall; few runs, not yet in the map catalog): chaos coupe 182.5, electric 175; Isles electric ≈ 152.5–160.5,
kart 163.

Handling knobs: the drift coupe's character comes from `traction` 1.28, `spinGripLoss` 0.7 (spinning
rears lose most of their side grip → power oversteer), `steerMax` 0.78 and a loose handbrake; the coupe's
from its 40 % front weight (`frontWeightNeutral`) and `longitudinalGripRatio` 0.78; the electric's from
its AWD split, boost and 1.9 t; the kart's from 430 kg, springs at 90 and a 1.5 m wheelbase. No controller
code changed for them.

### Number plates

Every car wears a rear number plate (`src/car/plates/`): the car's default (`defaultPlate` in
`src/car/catalog.ts` — `NEON 001`, `GLITCH 45`, `BRUISER 8`, `RZR WING 1`, `DUNE 4X4`, `UK 07 DW 2400`
on the Ember Swallowtail, `SMOKE 01`, `ION 2060`, `GNAT 1`) or the text the player typed.

- **Rules** (`plateText.ts → normalizePlate`, unit-tested in `test/plates.test.ts`): upper-case; `- _ . /`
  become spaces; anything but A–Z, 0–9 and spaces is dropped; runs of spaces collapse; trimmed; at most
  14 characters, cut on the right and never ending in a space; empty = the car's default. No profanity
  filter: it renders on the player's own phone. `RANDOM` makes `LL DD LLL` plates (no I/O/Q).
- **Look**: a game plate, not any real-world registration design: navy face, a neon frame and two rivets in
  the car's accent, white 5×7 pixel glyphs (`plateFont.ts`, 36 glyphs; no web font, so it looks the same
  offline on every phone and matches the voxel art), drawn once into a 512×128 canvas (`plateDraw.ts`,
  0.1 ms) and used as colour + emissive map (reads at night).
- **Cost**: one shared 0.52 × 0.13 × 0.02 m box (12 triangles) per car and one texture + material per
  distinct text (`plateTexture.ts`, 16-entry LRU, evicted ones disposed): **+1 draw call, +12 triangles,
  +1 texture, +1 shader program** per car — measured at the chaos spawn on a headless Pixel 7: hypercar
  36 calls / 111,994 triangles / 12 programs with the plate (35 / 111,982 / 11 before), coupe 35 /
  105,458, drift 35 / 106,434, electric 35 / 107,266, kart 35 / 88,582 (budget 48 / 160 k).
- **Mounts** (`CarModelDef.plates.rear`, `[x, h, z]` like the exhausts): hypercar tail fascia under the
  light bar (h 0.67, z −2.28: anything lower is hidden by the diffuser from the chase cam, anything further
  forward is inside the voxels), rally hatch, Bruiser V8 rear panel between the exhaust pairs, Razorwing
  under the rear wing on the centre pylon (scale 0.6), Dune Goblin tub tail between the lamps, coupe /
  drift / electric Kamm-tail recesses, kart bumper bar (scale 0.85). Each one was read from a Pixel 7
  landscape chase-camera screenshot.
- **Editor** (`src/hud/PlateEditor.tsx` + `plateEditor.css`, standalone; mounted in the GARAGE tab next to
  the selected card): plate chip + `✎ PLATE` → a text field (`autoCapitalize="characters"`,
  `enterKeyHint="done"`, 18 px so the keyboard doesn't zoom, scrolls itself into view) with live
  normalization, `RANDOM`, `RESET` (back to the default) and `DONE`; 44 px targets. Game key bindings
  ignore keys typed into it (`car/input.ts isEditableTarget`).
- **Saved** per car id in `squadhq.selection.v1` (`plates`, `setPlate`; old saves load with none) and
  cosmetic only: no physics, no best-time key, no medal effect. `?plate=` sets it from a link.
- **Dev lab**: `lab-plates.html` (`src/dev/platesLab.tsx`, dev server only, not in the production build)
  shows the plate drawing and the editor for every car. Checked by real touch on a headless Pixel 7:
  typing `anaye-07 racer!! x` shows `ANAYE 07 RACER`, RANDOM / RESET / Enter work, the text survives a
  reload and the game page then wears it; 0 console errors.

## Maps

All maps are original and procedural (`src/track/maps/<map>.ts` recipes for the generator in
`src/track/chaos/plan.ts`, except the Proving Ground). They switch live from the ☰ menu (the old map
unmounts completely — no leaked bodies, colliders, joints, geometries or textures across 3 rounds of
switching through all six) and each brings its own sky, fog, lights and palette. The five Tessera Isle
entries share one generated island ([Tessera Isle](#tessera-isle-open-world)); MAPS shows them as one card.

| Map (id) | What it is | Length / CPs | Big jump | Medals (hypercar) gold / silver / bronze |
| --- | --- | --- | --- | --- |
| GamerFleet Chaos (`chaos`, default) | Neon night: pendulums, collapsing tiles, shutter gates, sky gap, then the 95 m jump (below) | 1740 m / 5 | 183 km/h | 46 / 53 / 62 s |
| Neon Ribbon (`ribbon`) | Dusk purple and amber: a narrow 10 m deck of non-stop S-bends, two fast shutter sets, one 8 m hop | 823 m / 3 | — | 41 / 47 / 55 s |
| Cloudbreak Isles (`isles`) | Bright day sky: island hops of 10–32 m, a crumbling bridge, a pendulum island, then a 520 m runway to a 90 m leap | 1610 m / 6 | 163 km/h* | 49 / 56 / 66 s |
| Cryo Drift (`cryo`) | Polar night on an ice shelf at **55 % grip** (`surfaceGrip`): pendulums on 13.5 m arms sweeping the full 20 m deck, two collapse fields | 1124 m / 4 | — | 58 / 67 / 80 s |
| Midnight Strip (`strip`) | 1 km night drag strip (CPs at 400 / 800 m), then 400 m to brake | 1000 m / 2 | — | 24.5 / 27 / 31 s |
| Proving Ground (`test`) | 1.85 km flat calibration straight with a speed-trap kicker (no gap: no jump verdict) | 1800 m / 2 | — | — |
| Tessera Isle (`tessera`) | Open-world island, **free roam**: a neon city, red canyons, a voxel village and a 185 m mountain on a 2 km three-lobed island ([below](#tessera-isle-open-world)) | — | — | — (no timer) |
| Rimway Loop (`tessera-rim`) | Island race: one lap of the coastal ring highway (city boulevard, salt flats, cove, village sweepers) | 4636 m / 10 | — | 2:07.5 / 2:26.5 / 2:52.0 |
| Crown Climb (`tessera-crown`) | Island race: city gate → Crown Saddle → summit hairpins → observatory, +175 m | 2783 m / 5 | — | 2:00.0 / 2:18.0 / 2:42.0 |
| Neon Sprint (`tessera-neon`) | Island race: Volt Docks to Spire Plaza through the city grid, six square corners | 1040 m / 6 | — | 56.5 / 65 / 76 s |
| Cinnabar Rally (`tessera-rally`) | Island race on **dirt**: canyon bends, under the rock arch, three hops along the salt pan | 1434 m / 5 | — | 72 / 83 / 97.5 s |

\* The lip speed that lands the Isles leap is below the sign: from 160.5 km/h for the hypercar and the
Glitch Rally, 156.5 for the Bruiser V8 and 164.5 for the Razorwing (measured, `landKmh` /
`landKmhByCar` in `track/catalog.ts`; the landing-speed table in
[Big jump honesty](#big-jump-honesty-integration-pass)). The sign and the dashboard ask for 163 because
that number is also the estimated top speed `assessBigJump` wants, and the 520 m runway leaves cars
5–6 km/h below their top speed at the lip: estimated top 162.6 fell, 163.1 cleared.

Ice: tyre friction **and** pedal braking scale with `surfaceGrip` (hypercar on ice: 0.74 g peak
lateral vs 1.34 g, 0–60 in 6.6 s vs 3.7 s, 60→0 in 18.3 m vs 10.5 m). The AWD rally keeps its launch
best there. `window.__MAPS__`: `current()`, `ids()`, `select(id)`, `physicsInfo()`, `renderInfo()`,
`describe(id, seed?)`; every generated map also installs `window.__CHAOS__` (with a `map` field).

### Medals per car

The catalog's `medalsMs` (table above) are hypercar times. Every other car gets them scaled by how
long it takes over the same course, so picking a slower car isn't punished on every results screen
and a faster one has to earn its gold (`src/state/records.ts`: `MEASURED_COURSE_S`, `medalScale`,
`medalsFor`; best-time storage keys are unchanged).

- **Measured**: full-course autopilot runs from the spawn (`?ws=off`, `__RACER__.advance`), the same
  driver for every car (the maps / integration autopilot: pure-pursuit steering on the ideal line,
  curvature + braking speed plan, shutter / pendulum timing) and the same sliders for every car: the
  ones each map's hypercar medals were set with (ribbon 60/4/0, isles 30/5/0, cryo 50/3/0, strip
  20/5/0, chaos 50/3/0 switching to the car's JUMP ATTEMPT preset at the jump checkpoint). 24 runs
  per car per map (8 on the Isles and the strip, where runs barely vary), each started at a different
  hazard phase; the median of the runs without a fall.
- **Flat out vs traction control**: the touch GAS is on/off, so every car was driven twice over the
  same phases, flat out and with a gentle traction control (easing off while a tyre slips, like
  pulsing the GAS; without it the torquey Bruiser V8 can't finish Ribbon or Cryo, 0 of 24). On the
  **strip** flat out is clearly quicker, 0.39 s for the hypercar and 0.37 s for the Bruiser V8
  (24.27 vs 24.66 and 24.23 vs 24.60), so the strip row uses the flat-out medians. The hypercar's
  slower traction-control median, the base every car's scale divides by, had set the rally's,
  Razorwing's and Dune Goblin's golds below what they make flat out (real touch runs on the old
  build: SILVER at 24.200, 23.267 and 34.133 against golds of 24.0, 23.0 and 34.0). On the other
  maps the two modes agree within run-to-run noise (the median per-phase gap is 0.16 s or less), so
  they keep the traction-control medians: taking the lower of two noisy medians would only nudge
  medals down at random (it would have moved the Bruiser V8's chaos gold from 44.0 to 43.5 s with no
  real difference in pace).
- **Checked on the strip with real touch**: Pixel 7 landscape, the map tip's 20 % / tier 5, the start
  card tapped and a finger held on GAS from the start lights to the line, no steering: every car gets
  GOLD (hypercar 24.300, rally 24.200, Bruiser V8 24.283, Razorwing 23.283 vs gold 23.5, Dune Goblin
  34.133 vs gold 34.5).
- **Scale** = car median / hypercar median; inside ±2 % (the autopilot's run-to-run noise: hazard
  waits move a chaos median that much) a car keeps the hypercar's times. Medal = hypercar medal ×
  scale, rounded to 0.5 s, kept strictly gold < silver < bronze. The hypercar's medals are the
  catalog's, unchanged.

| Map | Neon Hypercar | Glitch Rally | Bruiser V8 | Razorwing | Dune Goblin |
| --- | --- | --- | --- | --- | --- |
| chaos | 54.15 s → **46 / 53 / 62** | 54.67 (×1.010) → 46 / 53 / 62 | 51.54 (×0.952) → **44 / 50.5 / 59** | 53.56 (×0.989) → 46 / 53 / 62 | jump out of reach: no medals |
| ribbon | 40.96 → **41 / 47 / 55** | 40.82 (×0.997) → 41 / 47 / 55 | 40.88 (×0.998) → 41 / 47 / 55 | 41.62 (×1.016) → 41 / 47 / 55 | 44.11 (×1.077) → **44 / 50.5 / 59** |
| isles | 48.83 → **49 / 56 / 66** | 49.20 (×1.008) → 49 / 56 / 66 | 49.08 (×1.005) → 49 / 56 / 66 | 49.21 (×1.008) → 49 / 56 / 66 | jump out of reach: no medals |
| cryo | 56.67 → **58 / 67 / 80** | 52.67 (×0.929) → **54 / 62.5 / 74.5** | 56.52 (×0.997) → 58 / 67 / 80 | 55.00 (×0.971) → **56.5 / 65 / 77.5** | 61.16 (×1.079) → **62.5 / 72.5 / 86.5** |
| strip | 24.27 flat out → **24.5 / 27 / 31** | 24.15 (×0.995) → 24.5 / 27 / 31 | 24.23 (×0.998) → 24.5 / 27 / 31 | 23.23 (×0.957) → **23.5 / 26 / 29.5** | 34.07 (×1.404) → **34.5 / 38 / 43.5** |

The four newer cars, measured the same way with the same autopilot and sliders (8 runs per car per
map at 8 hazard phases; flat out, traction control only where flat out can't finish; the hypercar
control in the same session gave 54.35 / 41.48 / 48.92 / 56.94 / 24.27 flat out against the stored
54.15 / 40.96 / 48.83 / 56.67 / 24.27, so the stored bases stand; `src/state/records.ts` has the rows):

| Map | Neon Hypercar (base) | Ember Swallowtail | Smoke Lantern | Ion Dragonfly | Pixel Gnat |
| --- | --- | --- | --- | --- | --- |
| chaos | 54.15 → 46 / 53 / 62 | 55.00 (×1.016, in band) → 46 / 53 / 62 | 55.27 (×1.021) → **47 / 54 / 63.5** | 54.52 (×1.007, in band) → 46 / 53 / 62 | jump out of reach: no medals (needs 190 km/h of estimated top speed, max 176) |
| ribbon | 40.96 → 41 / 47 / 55 | 40.99 (×1.001) → 41 / 47 / 55 | 41.49 TC (×1.013) → 41 / 47 / 55 | 41.59 (×1.015) → 41 / 47 / 55 | 40.20 (×0.981) → 41 / 47 / 55 |
| isles | 48.83 → 49 / 56 / 66 | 48.50 (×0.993) → 49 / 56 / 66 | 52.30 (×1.071) → **52.5 / 60 / 70.5** | 49.59 (×1.016) → 49 / 56 / 66 | 51.47 (×1.054) → **51.5 / 59 / 69.5** |
| cryo | 56.67 → 58 / 67 / 80 | 54.67 (×0.965) → **56 / 64.5 / 77** | 58.75 TC 35 % (×1.037) → **60 / 69.5 / 83** | 54.60 (×0.963) → **56 / 64.5 / 77** | 57.40 (×1.013) → 58 / 67 / 80 |
| strip | 24.27 → 24.5 / 27 / 31 | 24.02 (×0.990) → 24.5 / 27 / 31 | 24.78 (×1.021) → **25 / 27.5 / 31.5** | 25.42 (×1.047) → **25.5 / 28.5 / 32.5** | 25.27 (×1.041) → **25.5 / 28 / 32.5** |

Notes on those rows: the Smoke Lantern can't finish Neon Ribbon flat out (0 of 8: it spins off) and
finishes 8 of 8 with the usual traction control; on Cryo Drift even that brings only 1 of 8 home, a
firmer one (easing off from 35 % slip) 3 of 8 — its ice row is the median of those three. With traction
control the drift car is also quicker on chaos (54.31) and the Isles (49.6), the only car where the two
modes disagree beyond noise; the rows keep the flat-out numbers because the touch GAS is on/off. The
Pixel Gnat's Isles row switches to its JUMP ATTEMPT preset (10 / T5 / −30) at the leap's checkpoint, as
every car does on chaos: with the map's 30 / 5 / 0 it reaches the lip at ~160 km/h and falls every time,
and even with the switch only 3 of 8 runs cleared (lip 164.8–165.2 cleared, ≤ 162.5 short), so its Isles
medals are a marginal target and its map tip should say "JUMP ATTEMPT from the leap's checkpoint". The
electric saloon is quickest of all on ice (AWD, lowest centre of mass) and slowest on the strip (1.9 t).

(Median autopilot time, traction control except the strip's flat-out row → gold / silver / bronze in
seconds; bold = differs from the hypercar's. Changed by the flat-out strip row: the rally, Razorwing
and Dune Goblin strip medals; the other maps are unchanged. The autopilot drives every car at the same cornering limit, so on the technical maps the cars land
close together; the drag strip and the ice show the real spread. The Proving Ground has no medals.)

**Big jump out of reach.** `jumpReach(trackId, carId)` asks whether any dashboard setting (engine
tier 5 down to 1, the full Front Wing Aero and Chassis Balance ranges in slider steps) gets a READY
from the protocol's `assessBigJump` with the map's `bigJumpKmh`. READY needs an estimated top speed of
at least the car's requirement, so it first works out the car's fastest estimated top speed from 10
estimates: `estimateTopSpeedKmh` reads only mass, drag and torque, so balance never changes it, and
at each tier it falls as the wing adds drag, so the fastest wing is an end of the slider. Below the
requirement the answer is "unreachable" with that speed, no scan; otherwise it scans the settings
and stops at the first READY. No ids are
hard-coded: today only the Dune Goblin comes out unreachable, on chaos (needs 183 km/h of estimated
top speed, tops out at 133) and the Isles (needs 163). Then the maps card and the garage card show
JUMP OUT OF REACH (with needs … · max …), no medals are shown or awarded for that car on that map,
and the RACE tab, the touch start card and the start lights say what speed it needs vs the car's
maximum. The map card's setup tip and the RACE tab's tip, which recommend jump setups, become "No
setup reaches this jump with the Dune Goblin." for that car. Memoized per car + jump speed. Checked
against the old full scan (all 51,005 settings): same reachable flag and the same max top speed, to the
last bit, for every car on both jump maps and 23 synthetic lip speeds (60–400 km/h, including 133–135
around the buggy's 132.84). First open at 6× CPU throttle (headless Chromium, fresh page, cold cache):
MAPS with the Dune Goblin 305 → 3 ms, GARAGE on chaos 197 → 32 ms, GARAGE on the Isles 239 → 35 ms; MAPS
with the hypercar stays ~21 ms (its early-exit scan). Checked at 412×839 and 780×360
(and the start-light note for overlaps at 360×640 … 863×360): no card content overflows, nothing
covers the thumb controls.

## Tessera Isle (open world)

An original open-world island you can drive anywhere (`src/track/world/`). It borrows only genres — a
neon city, a frontier canyon country, a blocky village — and invents everything else: the shape is a
three-lobed trefoil around a central mountain from a formula (`r = 700 − 210·cos 3θ` plus seeded noise),
and every name on it is made up. One fixed seed (7177) generates the same island on every device: the
Node test and the browser check the same pinned hash (`src/track/world/golden.ts`, `57ad65768fba31e1`).

**The island.** 2048 m square, a 513² heightfield at 4 m, sea level at y 0.

| Region | Genre | What is there |
| --- | --- | --- |
| Prism City (west lobe) | neon city | street grid, towers with neon window strips, Prism Spire, Volt Docks quay and pier (the spawn) |
| Kite Bay | coast | Kiteflat airstrip with three table-top ramps (Kite Hop, Kite Leap, Kite Launcher), Sunscale Beach |
| Cinnabar Reach (north-east lobe) | frontier | red plateau and buttes, Tin Spur, Cinnabar Gulch and its rock arch, Saltglass Flats (speed trap) |
| Shell Cove | coast | chalk cliffs and a beach |
| Patchwork Downs (south-east lobe) | voxel village | Hearthwick, Cobblekeep on Cobble Hill, Glassmere (a shallow lake you can drive across, ≤ 0.6 m) |
| Lantern Bay | coast | Lantern Point lighthouse |
| The Crown (centre) | mountain | Crownpeak (185 m), Crown Saddle, the summit hairpins, Crownpeak Observatory |

Roads: the Rimway (a 4.6 km clover-shaped coastal ring), the city grid, the Crownway and summit road, the
Cinnabar dirt loop, the Patchwork lanes, the castle ramp and the Kiteflat access road. Every road is level
across, grades stay ≤ 11 % (≤ 6 % on the Rimway), hairpins sit on flat pads, and the generator's validator
throws if a road, checkpoint, lake depth, slope (≤ 25° off-road outside cliffs), clearance or ramp rule is
broken (`gen/validate.ts`).

### Entries, races and medals

Five catalog entries share the island (`world: 'tessera'`); switching between them keeps the island loaded
and only moves the car (`<Track/>` keys by the world). MAPS shows them as one card: a map thumbnail, ▶ FREE
ROAM and one row per race with its surface, length, difficulty, best time and this car's medal targets.

| Entry | Start | Route | Checkpoints |
| --- | --- | --- | --- |
| Tessera Isle (`tessera`) | Volt Docks plaza, facing Prism Spire | free roam: no lights, no timer | — |
| Rimway Loop (`tessera-rim`) | Bayfront Boulevard | 4636 m asphalt, one lap clockwise | 9 + finish |
| Crown Climb (`tessera-crown`) | city east gate | 2783 m asphalt, y 6 → 181 | 4 + finish |
| Neon Sprint (`tessera-neon`) | Volt Docks plaza | 1040 m city asphalt, 6 square corners | 5 + finish |
| Cinnabar Rally (`tessera-rally`) | Tin Spur | 1434 m dirt loop, 3 hops | 4 + finish (on the start line) |

Races use the normal start lights, timer, results and best times, in **strict order** (a gate only counts
after the one before it). Guidance: a checkered arch over every gate, a fog-free beacon on the next one,
glowing arrows on the road at junction turn-offs, chevron boards on bends tighter than 120 m, the minimap's
route and next-gate dots, **WRONG WAY** and **MISSED CHECKPOINT ⟲** banners. No island race has a big jump,
so every car, the Dune Goblin included, gets medals on all four.

**Medals.** Measured like the other maps (`MEASURED_COURSE_S` in `src/state/records.ts`): the island
autopilot (pure pursuit on the race route, a speed plan from curvature with each car's off-road grip, gentle
traction control) at 50/3/0 for every car, 8 runs per car per race with the look-ahead jittered ±5 %, flat
out and with traction control; each car's time is the faster of the two medians, 288 runs, 0 falls. The
hypercar's median is gold, × 1.15 silver, × 1.35 bronze (rounded to 0.5 s); other cars scale by their time as
usual. Gold is the autopilot's median at BALANCED: a stronger setup (e.g. 30/5/0: Rimway 1:47.6 for the
hypercar) beats it.

| Car | Rimway Loop | Crown Climb | Neon Sprint | Cinnabar Rally |
| --- | --- | --- | --- | --- |
| Neon Hypercar | 2:07.5 / 2:26.5 / 2:52.0 | 2:00.0 / 2:18.0 / 2:42.0 | 56.5 / 65.0 / 76.0 | 1:12.0 / 1:23.0 / 1:37.5 |
| Glitch Rally | 2:13.0 / 2:32.5 / 2:59.0 | 2:00.0 / 2:18.0 / 2:42.0 | 56.5 / 65.0 / 76.0 | **1:08.0** / 1:18.5 / 1:32.0 |
| Bruiser V8 | 2:07.5 / 2:26.5 / 2:52.0 | 2:00.0 / 2:18.0 / 2:42.0 | 55.0 / 63.5 / 74.5 | 1:10.0 / 1:21.0 / 1:35.0 |
| Razorwing | 2:15.5 / 2:36.0 / 3:03.0 | 2:00.0 / 2:18.0 / 2:42.0 | 56.5 / 65.0 / 76.0 | 1:12.0 / 1:23.0 / 1:37.5 |
| Dune Goblin | 2:55.5 / 3:22.0 / 3:57.0 | 2:27.0 / 2:49.0 / 3:18.0 | 65.5 / 75.5 / 88.5 | 1:15.5 / 1:27.5 / 1:42.5 |
| Ember Swallowtail | 2:07.5 / 2:26.5 / 2:52.0 | 2:00.0 / 2:18.0 / 2:42.0 | 56.5 / 65.0 / 76.0 | 1:12.0 / 1:23.0 / 1:37.5 |
| Smoke Lantern | 2:03.0 / 2:21.5 / 2:46.0 | 2:00.0 / 2:18.0 / 2:42.0 | 56.5 / 65.0 / 76.0 | 1:12.0 / 1:23.0 / 1:37.5 |
| Ion Dragonfly | 2:07.5 / 2:26.5 / 2:52.0 | 2:03.5 / 2:22.0 / 2:46.5 | 57.5 / 66.5 / 77.5 | 1:12.0 / 1:23.0 / 1:37.5 |
| Pixel Gnat | 2:21.5 / 2:42.5 / 3:11.0 | 2:00.0 / 2:18.0 / 2:42.0 | 55.0 / 63.0 / 74.0 | 1:12.0 / 1:23.0 / 1:37.5 |

**Robustness** (autopilot, production build): every car × the four races + a free-roam Rimway lap at 50/3/0
and 30/5/0: 0 falls, 0 water, bounds or stuck respawns, no airborne moment over 0.25 s on the asphalt routes
(on the rally only at the three hops, 0.3–0.67 s), and the chassis never touches the ground on asphalt. The
one exception is the Pixel Gnat on the Cinnabar Rally: its 10 cm of suspension travel bottoms out landing the
hops (it still finishes, no fall). Off-road crossings (meadow, Saltglass Flats, Sunscale Beach, the Glassmere
ford) work for every car at both settings.

### Free roam, travel and respawns

- **Event pads.** Each race start has a glowing ring and a beacon. Within 14 m of one, under 40 km/h, a pill
  appears: **▶ START NEON SPRINT · 1.0 KM · BEST …**; tap it (or Enter) for the lights. The Neon Sprint pad
  is at the spawn, so it is the first thing you see.
- **RACE tab.** In free roam: the region you are in, **TRAVEL** (Volt Docks, the three other race starts,
  Kiteflat, Glassmere shore, Hearthwick, Crownpeak, Saltglass Flats) and **EVENTS**. In a race: **EXIT TO FREE
  ROAM** (the car stays where it is) and CHANGE EVENT. The bottom row's RESTART reads **TO SPAWN** in free
  roam (back to Volt Docks).
- **Results** on an island race: ⟲ RETRY · FREE ROAM (stay where you finished) · NEXT EVENT ▸ (NEXT MAP after
  the last race) · GARAGE.
- **Respawns** in free roam go to the last safe spot on a road (a road centreline sample 1.5 s or more back,
  upright): ⟲, falling off the world, deep water (**SPLASH · BACK ON THE ROAD**; the Pier Launch ramp ends in
  the bay on purpose), leaving the island (**OUT OF BOUNDS**), a flip, or being beached with all wheels in
  the air (**UNSTUCK**). After 4 s of throttle without moving, **STUCK? TAP ⟲**. In races ⟲ goes to the last
  checkpoint as on every map. A car swap in free roam keeps your place.
- **Records.** Landing after more than 0.6 s in the air shows **AIR 1.9 S · 34 M**; off a ramp it is kept as
  that car's best for that ramp and shown on the ramp's sign (**BEST AIR 2.2 S · 64 M**). Driving through the
  Saltglass gantry shows the speed and keeps each car's best (`localStorage` `tessera.air.v1`,
  `tessera.trap.v1`). Signs never claim a speed.
- The first time you enter each region a card names it (e.g. CINNABAR REACH / FRONTIER). Leaving the app
  (Termux, a call, the notification shade) pauses free roam like a race.

### Minimap

A heading-up disc with the car at 60 % of its height, an N tick, the race route in the event's colour, the
next gate (pulsing) and the one after it, and an arrow with the distance on the rim when the next gate is off
the disc. The island picture is painted once; driving only moves it with a CSS transform (about 0.07 ms per
frame, 0 React renders). Portrait: under ⟲ ☰ on the right (96–120 px). Landscape: top-left (96–128 px, the
status chips move under it). Desktop: 220 px under the SQUAD LINK panel. Tap it for ☰ MAPS. It hides while
the island loads, behind results, with the portrait physics panel open, below 240 px of landscape height, and
with SETTINGS → MINIMAP off. Checked on the real island at 412×839, 360×780, 360×640, 863×360, 780×360,
740×280 and 800×264: it covers none of the top bar, ⟲, ☰, steer pad, pedals, chips, start lights, banners or
the event prompt.

### Surfaces and grip

Each wheel reads the surface under it (road first, then the ground map) after every physics step; the tyre
grip, the drivetrain's grip limit and the brakes all scale by `g_eff = max(0.4, 1 − (1 − g)·k)`, and
off-road rolling drag is `C·k·m·g` (`gen/surfaces.ts`, applied through the `car/surfaceGrip.ts` seam, which
is exactly 1 on every other map).

| Surface | asphalt | cobble | salt | rock | dirt | grass | sand | snow | water (≤ 1.1 m) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Grip g | 1.00 | 0.97 | 0.90 | 0.90 | 0.85 | 0.72 | 0.62 | 0.55 | 0.60 |
| Drag C | 0 | 0.005 | 0 | 0.01 | 0.02 | 0.05 | 0.09 | 0.04 | 0.25 × depth |

Off-road factor k: hypercar 1.1, Razorwing 1.15, Bruiser V8 0.9, Glitch Rally 0.25, Dune Goblin 0.3, Ember
Swallowtail 1.0, Smoke Lantern 1.0, Ion Dragonfly 0.85, Pixel Gnat 1.2. Calibrated on the Cinnabar Rally
(targets: rally ≤ 0.95 × hypercar, buggy ≤ 1.10 × hypercar): rally 0.945 / 0.911 and buggy 1.052 / 0.996 at
50/3/0 / 30/5/0. Audio follows the surface too (dirt crunch, grass, sand hiss, salt, a splash into water).

**Roll stability on the island.** The raycast suspension damps explicitly, so a car whose damping is large
for its roll inertia over-corrects every 1/60 s step. Only the Razorwing is past the limit
(`dt·m·(c_f·t_f² + c_r·t_r²)/2 / I_roll` = 2.3–2.4, where 2 is unstable): on the island's crests and terrain
creases it fell into a 30 Hz side-to-side chatter that halved its traction and stalled it on the Crown
Climb. While the island is mounted it installs a chassis-inertia resolver (`physics/rollStability.ts`) that
raises only the roll inertia, and only as far as that number = 1.6; today that touches the Razorwing alone.
Off the island no resolver is installed and every car is exactly as before.

### Performance (headless Chromium on a software GPU; Pixel 7 emulation at DPR 1.5)

| Item | Island | Budget / reference |
| --- | --- | --- |
| Draw calls / triangles, spawn (portrait / landscape) | 28 / 80,608 · 32 / 95,456 | ≤ 40 / 130 k |
| Worst of 12 probe spots (portrait / landscape) | 32 / 96,612 (Spire Plaza) · 37 / 105,426 (city centre) | ≤ 48 / 160 k |
| Shader programs | 15 (chaos 12) | ≤ chaos + 3 |
| Physics step, 600 steps, median of 3 | 0.086 ms (chaos 0.219 ms), 72 world colliders | ≤ chaos + 0.15 ms, ≤ 130 colliders |
| Main-thread script per frame, landscape | 6.15 ms (chaos 5.12); at 4× CPU throttle 11.97 (chaos 15.99) | ≤ chaos + 1.5 ms |
| JS heap | island +1.2 MB over chaos, +0.2 MB after leaving | ≤ +30 MB / ≤ +10 MB |
| World data (typed arrays, outside the JS heap) | 9.57 MB | ≤ 12 MB |
| GPU memory estimate (upper bound) | 13.8 MB | ≤ 25 MB |
| Generation in the worker | 963–1026 ms | 900 ms (not met here) |
| Direct load → island drivable | 2.1–2.3 s | ≤ 2.5 s |
| Longest main-thread task, direct load / switch from chaos | 177–193 ms / 102–125 ms | 150 ms (direct load not met) |
| Switch chaos → island drivable | 5.5–6.5 s | 2.5 s (not met: the software GPU stalls frames while it compiles and uploads) |
| Leak test: 3 rounds through all 11 entries with car swaps | bodies, colliders, joints and programs equal on every revisit; rounds 2 and 3 identical in every counter | — |

The world code is a lazy chunk (WorldRoot 55 kB, 21.9 kB gzip) plus its own worker file (96 kB); the boot
bundle only carries the small shell. On a phone, generation takes longer (it runs in the worker, so the menus
stay responsive while BUILDING TESSERA ISLE fills its bar). Cold generation in Node: about 0.9 s here.

### Tests and debug handle

- `npm run test:world` (also part of `npm test`): determinism against the pinned hash, the validator, the
  budgets (boxes ≤ 6000, trees ≤ 3000, collider triangles ≤ 70 k, data ≤ 12 MB), ids, and Rapier heightfield
  raycasts against `heightAt` (≤ 1e-4 m). Cold generation time is logged and must stay under 2.8 s;
  `WORLD_PERF_STRICT=1 npm run test:world` asserts the 700 ms desktop budget instead (not met on this box).
- `window.__WORLD__`: `info()` (seed, hash, genMs, genWhere, state, chunks, colliders, stepMs, gpuMB…),
  `route(id)` (points, speeds, length, gates), `heightAt(x, z)`, `surfaceAt`, `regionAt`, `events()`,
  `spots()`, `safePoses()`, `probes()`, `validate()`, `chassisContacts()`, `live()`, `hud()`, `respawns()`,
  `actions()` (`travel(id)`, `freeRoamHere()`).
- `?track=tessera` (or any island id) opens the island directly; `?worldgen=main` generates without the worker.

## Rivals and ghost (`src/rivals/`)

Every timed race (the five generated maps and the four island races; never free roam, never the test
track) starts with three rivals on the grid behind the player. They are the other four drivers of the
DRIVERS roster taking turns run by run, each in a different car class than the player and than each
other, painted in their signature colour with their own plate (`VOLT 11`, `PIXEL RAE 22`…), and they
drive at exactly this car's **GOLD, SILVER and BRONZE** pace on the map (`state/records.ts medalsFor`):
beat the gold rival and you are P1. A medal still comes from your time as before; the position is extra.

- **Zero physics.** A rival is a pose on the race route (`route.ts`: the plan's ideal line sampled every
  2 m with the deck / tile heights baked in and a ballistic arc over the hops and the big jump; island
  races use the generator's 2 m route with `heightAt` for the height) driven by a speed plan
  (`speedPlan.ts`: v = √(10 m/s² · R) from curvature, capped by the class's top speed at tier 5,
  accel ≤ 6 m/s², braking ≤ 10 m/s², then ONE factor on the capped profile so the driving time hits the
  target within 0.1 %, plus a 0.15–0.35 s reaction after the lights). No bodies, no colliders, no
  collisions: rivals are ghosts that ignore the hazards (they cross the tile field as if it held and
  drive through pendulums and shutters). Within 6 m of the player they fade to 60 % so they never hide
  the road; after the line they roll on for 1.5 s and fade out. A class whose top speed cannot make a
  target is skipped for that slot (the buggy against a 46 s chaos gold); a map without medals for this
  car (the buggy on chaos, the kart on chaos) has no rivals.
- **Drawn by `KinematicCar`** (also used for the shadow ghost and for multiplayer's remote players): the
  class's voxel car wearing a look at HALF resolution (`rivalAssets.ts`: every 2×2×2 block of the livery
  grid becomes one voxel), the front wing merged in, the four wheels as one `InstancedMesh`, the plate;
  3 draw calls per car, no shadow casting. The name tag is DOM (`NameTags.tsx`, projected from the
  canvas): no draw call.
- **Standings** (`standings.ts`, the contract multiplayer ranks remote players through): progress is
  metres along the route, the player projected onto the segment between the last gate passed and the
  next (so leaving the course never gains progress), published ≤ 10 Hz. Phones show `P n/N` in the top
  bar (tap it for a 3 s standings sheet), desktop lists everyone with gaps under the run panel, and the
  results card gains `P1 · AHEAD OF VOLT BY 2.3 S` / `P3 · 4.1 S BEHIND PIXEL RAE` (the nearest human
  when friends are present, else the nearest rival). Nothing shows while fewer than two cars are ranked.
- **Ghost.** Every timed run is recorded at 10 Hz from GO (position + quaternion, quantized to 1 cm and
  delta-coded: 14 bytes per sample, ≤ 64 KB per run); a new best for this car on this map is saved
  under `gamerfleet.ghost.v1.<track>.<car>` (LRU eviction at 1.5 MB total) and replayed on the next run
  as a 40 % translucent copy of your own car tagged `<driver> · BEST`. It is never ranked.
- **SETTINGS · RACE** (`RivalsSettings.tsx`, persisted under `gamerfleet.rivals.v1`): RIVALS 3 / 1
  (gold only) / OFF, GHOST ON / OFF.

Measured (production build, headless Chromium on SwiftShader, Pixel 7 landscape, `renderer.info`
with rivals OFF → ON at the spawn, `__RIVALS__.castDown` physics raycasts at 10 Hz along the run):

| Check | chaos | Neon Sprint | Budget |
| --- | --- | --- | --- |
| Draw calls | 36 → 45 (+9) | 33 → 42 (+9) | ≤ +9 |
| Triangles | +22,296 | +21,040 | ≤ +30 k |
| Shader programs | 12 → 15 | 11 → 14 | (instanced wheels, translucent variant) |
| Bodies / colliders / joints | 53 / 189 / 3 unchanged | 2 / 73 / 0 unchanged | 0 added |
| Rival finish vs target | +0.11 / +0.09 / +0.08 % | +0.09 / +0.08 / +0.07 % | ≤ 1.5 % |
| Contact height vs raycast | median 0.000 m (outliers only where a rival crosses a shutter) | 0 of 1,654 samples off by > 0.3 m | ≤ 0.5 m |
| Standings going backwards | never | never | — |

Three rivals at rival resolution: 22,136 triangles for the heaviest three classes (node test; a full-resolution
hypercar alone is 17 k). Ghost replay vs its recording on the strip: worst 0.007 m at matching race times; a
31 s run stores 5.9 KB. Node test: `dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test
game/test/rivals.test.ts` (routes of all ten timed entries, the speed plan for every race × every player car ×
every medal slot, standings math and the results line, the ghost tape round trip, the triangle budget).
Debug handle `window.__RIVALS__`: `rivals()`, `standings()`, `participants()`, `route()`, `raceMs()`,
`castDown(x, z)`, `ghost()`, `settings()` / `setSettings({ rivals, ghost })`.

## Career (`src/career/`)

The ☰ **CAREER** tab is the player's record book. It is fed only by the event bus and the stores (`career/tracking.ts`
listens to `finish`, `respawn` and `restart`, the rivals standings at the finish instant, the room phase for friends
races, the island's region label and AIR records, and a 10 Hz sampler of `carRuntime.speedKmh` for distance, time
played and top speed), so it has no physics footprint and the replay goldens are unchanged.

- **Records** per (map, car): best time, medal (via `records.medalsFor`), best finishing position against the rivals,
  runs, falls, clean runs. Shown as a MAPS × CARS matrix of 44 px cells; tap a cell for the detail.
- **Totals:** races finished, wins and podiums against the rivals, friends races hosted / played / won, kilometres
  driven (and per map), top speed with its map and car, longest air time and leap, time played, finishes on tilt
  steering, the biggest improvement on a personal best.
- **Trophies** (`career/trophies.ts`, 24, each a pure rule over the career data): FIRST LIGHTS, TEN UP, BRONZE AGE,
  SILVER LINING, GOLD RUSH, FULL SET (gold on every classic map with one car), ISLANDER (all four island races gold),
  NINE LIVES (a medal with every car), CLEAN SHEET, FRONT ROW, PODIUM REGULAR, GRID KING (P1 in ten races),
  ROOM SERVICE (host a friends race), PACK LEADER (win a friends race with three or more players), TILTED,
  NIGHT SHIFT (30 minutes), ODOMETER, LONG HAUL, BIG AIR, HANG TIME, GHOSTBUSTER (beat your own best by 2 s),
  WAYFARER (island regions), SPEED MARK, GARAGE TOUR (finish with five different cars). An unlock shows a
  3-second notice under the top bar (`career/TrophyToast.tsx`, one at a time, never over the minimap or the thumbs).
- **Reset:** RESET CAREER arms for 5 s and needs a second tap; KEEP cancels.
- Storage: `gamerfleet.career.v1` (versioned, sanitised on load). Tests: `game/test/career.test.ts` (34: reducers,
  persistence, every trophy rule, the toast queue).

## Play with friends (`src/multiplayer/`)

Rooms ride on the relay socket the game already keeps for the dashboard (`net/squadLink.ts` hands every
`room:*` frame to `multiplayer/roomClient.ts`; `game:state` / `squad:controls` keep working, so the
dashboard still tunes every car in the room). Protocol `room.v1` in `shared/protocol.ts`, relay side in
`server/src/rooms.ts` ([server/README.md](../server/README.md#rooms--play-with-friends-roomv1)).

- **Rooms.** ☰ MENU → **FRIENDS** → ROOM SIZE (2 · 3 · 4 · 6 · 8, default 2 = "you + 1 friend") → HOST A ROOM
  gives a 4-letter code (20-letter alphabet, no vowels, no 0/O/1/I; 2 h idle expiry, 64 rooms per relay) and a
  share link `…/?room=CODE` (with `ws=` when the page named a relay) that joins on load once the socket is open.
  The code, the link and the player list show `n/size`; a join beyond the size gets `ROOM FULL (2/2)`. The host
  can change the size in the lobby (never below the players in it), REMOVE a player (tap twice; that device gets
  "You were removed from the room" and cannot come back by link or code) and MAKE HOST; LEAVE asks "Leave and
  hand the room to <name>?". Members cannot start, change the size, remove or pick the map.
- **Seats and reconnects.** `friendsProfile.ts` keeps a random player token per device (never shown) and sends
  it on create / join. A lost socket drops the room locally and re-joins the same code when the link is back;
  the relay gives the same seat back (`room:joined {restored}`: same member id, host role, results row; the race
  in progress keeps its start, `raceFlow.ts`), so the host stays the host through a 20 s blip and a friend who
  reconnects never appears twice. Meanwhile the others see that player as RECONNECTING… (car hidden) for up to
  120 s. A reload (Android discards a background tab while the host shares the link; the host's own address has no
  `?room=`) re-joins too: the page keeps `gamerfleet.room.v1` `{code, at}` while seated (refreshed every few
  seconds, on hide and on pagehide) and, when it loads within the grace, re-joins that code with the token
  (FRIENDS: "GETTING BACK INTO ROOM …"). It is kept per tab (`sessionStorage`, so a second tab does not steal the
  seat) and, for the installed app, in `localStorage`; LEAVE, REMOVE and a failed re-join clear it. Away seats
  count toward the size, so a join then gets `ROOM FULL (2/2) · 1 RECONNECTING: ask the host to REMOVE that seat,
  or try again in 2 min`, and the host sees the same hint above the player list. Against a relay that predates
  seats the room still works, without sizes, grace or host controls.
- **Humans only.** While the player is in a room (any phase, any map, and while re-joining after a blip)
  `rivals/RivalsLayer.tsx` mounts no AI rivals and no shadow ghost, so the standings and the `P n/N` chip count
  room members only and the results line names the nearest friend. That line uses the relay's finish times (the
  same on every phone) and follows them while the card is up: "P1 · AHEAD OF ANAYE 2" while the friend is still
  driving, then "… BY 0.2 S" once their time arrives. Friends' pace in the live standings comes from the speed
  their poses carry. Solo play keeps SETTINGS · RIVALS / GHOST.
  The FRIENDS tab says "AI rivals and your ghost are off in rooms".
- **Names.** YOUR NAME (FRIENDS, ≤ 16, prefilled from the selected driver, saved per device) is the name friends
  see. A device that still carries the owner's default driver "Anaye" with the stock look is asked once ("WHAT
  SHOULD FRIENDS CALL YOU?", OK or SKIP) before HOST / JOIN, or at the top of the room for a friend who joined by
  link before seeing it; the relay de-duplicates names per room ("Anaye 2").
  Identity (name, car, MY RIDE look, plate, avatar) follows the FRIENDS / DRIVERS / GARAGE / MY RIDE choices live
  (`identity.ts`, throttled to one `room:update` per 300 ms).
- **Shared race.** The host's MAPS pick goes out as `room:race {phase: 'lobby', track}` and every member's
  selection store follows it (the normal map switch). Members tap READY, the host taps START → `startAt =
  relayNow + 4 s`; each client restarts its run `3 × 0.8 s` before `startAt` on the relay clock (`clockSync.ts`:
  median offset of a 5-ping burst, then one ping per 5 s), so the local 3 · 2 · 1 · GO (`game/countdown.ts`,
  counted in physics steps) reaches GO at `startAt`. Everyone races on their own physics with no collisions
  between players; `finish` becomes `room:finish`; the host closes the race when everyone present has a
  time or 60 s after the first finisher. Late joiners drive the track untimed and are in from the next START.
  Free roam on Tessera Isle: everyone just roams together (poses only; START is refused).
- **Remote cars.** Each client sends `room:pose` at 15 Hz (`poseSender.ts`; paused while the tab is hidden)
  and the relay fans it out to the others (dropped above 30 Hz per sender). `remotePlayers.ts` keeps a
  32-sample ring per player, read from the render loop 100 ms behind the newest sample with linear / slerp
  interpolation, dead reckoning up to 250 ms past it, a hard snap beyond 2 m and an eased correction above
  0.3 m; nothing heard for 3 s dims the car. `RemotePlayersLayer.tsx` (mounted in `App.tsx` inside
  `<Physics>`) draws each one with `rivals/KinematicCar` (their class, look, plate, name tag in their colour),
  and `roomClient` ranks them through `rivals/standings` as `remote`, so the `P n/N` chip and the results
  line count the room's players (the line names the nearest friend) and the results card adds
  `P1 OF 3 FRIENDS` (`FriendsResultLine.tsx`).
- Debug handle `window.__ROOM__`: `state()`, `host(size?)`, `join(code)`, `leave(to?)`, `ready(on)`, `start()`,
  `setSize(n)`, `remove(id)`, `makeHost(id)`, `shareUrl()`, `relayNow()`, `clock()`, `remotes()`, `stats()`,
  `sceneCars()` (every car in the scene graph: `friend` / `rival` / `ghost`), `waitFor(predicate)`. The room lives
  on the relay; the device keeps only `gamerfleet.friends.v1` (token, YOUR NAME, last size), `gamerfleet.room.v1`
  (the seat to take back after a reload) and the URL (`?room=`).
- **Sign-in and announcements** (milestone 6): see [Google sign-in](#google-sign-in-srcauth) and
  [Owner announcements](#owner-announcements-hudannouncebannertsx) below.
- **Waking the hosted relay.** A free hosted relay sleeps when idle. While FRIENDS waits for a `wss://` relay it
  shows "WAKING THE ONLINE SERVER… (up to 30 s the first time)" with a seconds counter from 3 s, and from 45 s
  also "NO RELAY REACHED" with a RETRY button (it restarts the link; a LAN `ws://` relay keeps the plain wording).

## Google sign-in (`src/auth/`)

Optional. Signing in puts **✓ and the player's Google first name** next to their name in the FRIENDS player list
and on the name tag over their car (`auth/badge.ts`; a typed YOUR NAME cannot fake it: check-mark look-alikes are
dropped from names), and lets a host make a room **SIGNED-IN PLAYERS ONLY**. Nothing else changes: playing,
rooms and the dashboard work exactly the same signed out.

- **Where.** ☰ MENU → FRIENDS shows a sign-in box above the room controls only when both are true: the game has
  a client id (`GOOGLE_CLIENT_ID` in `src/config.ts`; empty = no button anywhere) and the relay verifies Google
  tokens (`server:welcome.signIn === true`, i.e. the relay has its own `GOOGLE_CLIENT_ID`). Google Identity
  Services (`https://accounts.google.com/gsi/client`) is loaded only then, the first time that box shows
  (`auth/gis.ts`); never at start-up, never in offline mode, never against a relay without sign-in. The button
  is the one Google draws (scaled to a 44 px touch target). Inside another page's frame it is replaced by
  OPEN THE GAME PAGE TO SIGN IN. The installed app and Chrome / Safari use Google's popup.
- **Signed in.** "✓ SIGNED IN AS <first name>" and SIGN OUT. The ID token stays in memory only
  (`auth/authStore.ts`): not in localStorage, sessionStorage, the zustand store or any log. The device remembers
  only that it signed in last time (`gamerfleet.signin.v1`), so the next visit offers Google's one-tap when FRIENDS
  opens. A few minutes before the token runs out (1 h) the game asks one-tap for a fresh one, but only while the ☰
  menu is open (nothing pops up over the thumbs mid-race); if that does not work the box says SIGN-IN RAN OUT ·
  SIGN IN AGAIN, and the relay keeps the ✓ on the current connection until it reconnects. SIGN OUT forgets the
  token and the flag, turns off Google's auto-select and tells the relay at once.
- **What goes to the relay** (`auth/wire.ts`, contract in `shared/protocol.ts` "Sign-in, time zone and
  announcements"): the device time zone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on `hello` and on
  every `room:create` / `room:join` / `room:update`; the relay keeps only the country it maps that to, for the
  owner's stats, and never looks at the IP address. The token goes once per connection (on `hello` when the game
  already has one, else on the next room frame) and again on `room:create` / `room:join`; never once it is about to
  run out (that would sign the connection out); `idToken: null` once after SIGN OUT. Signing in or out outside a
  room still tells the relay with one `room:update`, whose expected `not_in_room` answer is not shown. The relay
  checks the token (signature, issuer, audience, expiry) and keeps only the first name; the email is never shown,
  sent on or stored by the game.
- **SIGNED-IN PLAYERS ONLY.** In a room the host gets a switch under ROOM SIZE (turning it on needs the host's
  own ✓). While on, the status line says so and a friend who is not signed in is refused with "SIGNED-IN PLAYERS
  ONLY: sign in with Google (above), then try again" and the sign-in box highlighted; after signing in, JOIN (the
  code is still in the field) gets them in. Players already seated stay; the host can switch it off any time. A
  friend on an older version of the game gets a message that says to reload.
- If the game shows SIGNED IN but the player's own row has no ✓ a few seconds later, the relay refused the token
  and FRIENDS says so (most likely the game and the relay were given different client ids).
- **Owner setup.** Google Cloud console → APIs & Services → Credentials → Create OAuth client ID → *Web
  application*; Authorized JavaScript origins: `https://anayechouksey4-sudo.github.io` (plus `http://localhost:5173`
  for `npm run dev`); no redirect URI and no client secret are needed. Paste the client id into
  `GOOGLE_CLIENT_ID` in `src/config.ts` (it is public by design) and set the same value as the relay's
  `GOOGLE_CLIENT_ID` environment variable on Render, then rebuild the hosted copy (`node scripts/build-pages.mjs`).
- **Local testing.** Google issues no tokens for a made-up client id, so headless checks build the game with
  `VITE_GOOGLE_CLIENT_ID=local-test-client.example.com`, start a local relay with the test key set from
  `npm run test-google` (server/README.md) and answer the GIS script URL with a stub `google.accounts.id` that
  hands back tokens signed by that key. Unit tests: `game/test/signin.test.ts` (token reading, memory-only storage,
  what goes on the wire, announcement timing, badge text).

## Owner announcements (`hud/AnnounceBanner.tsx`)

When the owner posts an announcement from the admin console, the relay sends `server:announce` to every connected
game (and again to each game that connects while it is up). The game shows it as an **ANNOUNCEMENT** banner with a
✕ (44 px) until the relay's end time:

- Phones, portrait: straight under the top bar, left of ☰ / ⟲ (and of the minimap disc); landscape: the top-left
  corner beside the centred top bar and above the steer pad, or, on the island where the minimap disc holds that
  corner, the mirror slot on the right under ⟲ / ☰ and above the pedals (a long text scrolls inside it). Speed,
  timer, the `P n/N` chip, the minimap and the thumb controls are never covered (checked at 360×640, 412×839,
  863×360 and 740×280); the LINK / TELEMETRY chips that start in the top-left corner sit under it until it is
  closed. It steps aside while the physics panel or the results card is open (it comes back when they close, its
  time still running). Desktop: the right column under ☰ MENU and the UPLINK feed. While the ☰ menu is open the
  same banner sits at the top of FRIENDS.
- The text is plain text, rendered as a text node: `<b>` shows as the characters `<b>`.
- It goes away on its own at the relay's `until` (time left = `until − serverNow` from the same frame, so the
  device clock does not matter), at once when the owner clears it (`text: ''`), or with ✕ on this device. A closed
  announcement stays closed through reconnects and reloads (`gamerfleet.announce.closed.v1`, last 8 ids).
- An older game ignores the frame.

## Sound and haptics

Everything is synthesized live with WebAudio — no audio files, no extra dependencies (details in
[`src/audio/README.md`](src/audio/README.md)): a per-car engine (3 detuned oscillators, shaper,
load-opened filter, firing "lump", turbo whistle on the rally) driven by a sound-only gearbox fitted
to the car's estimated top speed, tyre squeal, wind and road rumble, landing / hit impacts, exhaust
pops, and one-shots for the start lights (3 beeps + a higher GO), checkpoints, the finish (sparkle on a
personal best), falls and respawns. The phone HUD shows the gear you hear.

Vibration (`navigator.vibrate`, ms): start lights 12 / GO 40, checkpoint 24, finish 45-80-45 (+80-110
on a personal best), fall 220, landing / hit 30 / 40 scaled by impact, rate-limited (per-kind
cooldown, 90 ms gap, ≤ 450 ms per 2 s). SETTINGS in the menu has SOUND, VOLUME and VIBRATION; the
menu ducks the mix to 30 %, a hidden tab suspends it. `window.__AUDIO__` exposes the live mix state.

## Physics model

This section describes the hypercar (the default car); the other cars use the same model with
their own `CAR_CLASSES` coefficients (front/rear drive split, launch boost, aero, geometry).

Everything is read from the store **every fixed step** (`1/60 s`), so a dashboard change is applied
on the very next step — no remounts, no React renders on the hot path (measured below: a
`squad:controls` frame through the real relay changes the Rapier body's mass, centre of mass and
springs on the first step after it arrives).

| Slider (dashboard) | Param (`CarPhysicsParams`) | What the car does |
| --- | --- | --- |
| Front Wing Aero | `frontDownforce`, `drag` | Vertical force **at the front-axle midpoint**: `(frontDownforce − FRONT_BODY_LIFT) · v_fwd²` along chassis −up, applied with `applyImpulseAtPoint` every step. Negative = lift: with too little wing the front wheels leave the ground at speed. |
| Engine Tier | `engineTorque`, `mass` | Rear-wheel drive. Each rear wheel gets `(engineTorque / 2) / DRIVE_WHEEL_RADIUS` through a 1-DOF wheelspin model (`src/car/drivetrain.ts`): if that exceeds the tyre's grip budget the wheel breaks loose and spins (no traction control). |
| Chassis Balance | `balance` | Centre of mass moved along the car axis so the static front-axle load = `balanceToFrontWeightFraction(balance)` (CoM height = the protocol's `CG_HEIGHT`, so load transfer matches `estimateFrontLiftOffKmh`), and per-axle spring stiffness = `balanceToSuspensionStiffness(balance)` (dampers scale with √k). |
| — | `traction` | Rapier friction slip / side-friction stiffness on every tyre. |

Also: rear wing `REAR_DOWNFORCE · v_fwd²` at the rear axle, drag `−drag · v · |v|` at the centre of
mass, rolling resistance while grounded, speed-sensitive steering, ABS-less brakes, handbrake
(rear brake + rear grip drop), reverse at 45 % torque up to 32 km/h.

**Ground effect.** Each axle's vertical aero force (front: wing + body lift; rear: rear wing) is
multiplied by a ground-effect factor: 1 while that axle's tyres touch or the surface below it is
within 1 m of its normal height (so a wheelie keeps its lift), then an exponential fade
(e-folding 0.6 m) to 0 high above the ground or over the void, probed with one down-ray per
airborne axle. Without it, wing setting would change the gravity a car "feels" in flight by up to
±0.2 g and lever the car up at a lip as the front wing went over the edge first, so the big jump's
required lip speed would depend on aero by ~5 % and `BIG_JUMP_LIP_KMH` could not be one honest
number. Drag is unaffected. In flight the body has a dart-like pitch stability (restoring moment
toward the flight path + pitch/roll damping). `getState().groundEffect` shows the mean factor.

Nose lift (`noseLift` telemetry) = both front tyres off for 0.12 s at > 11 m/s while net front lift
is at least half the static front-axle load, starting from all four tyres down (landing bounces
and rear-first landings don't count). Non-protocol tuning lives in `src/car/tuning.ts`; geometry
in `src/car/vehicleSpec.ts`.

### Calibration (shared/protocol.ts, tuned against this sim)

| Constant / mapping | Was | Now | Why |
| --- | --- | --- | --- |
| `FRONT_BODY_LIFT` | 3.0 | **2.7** | Puts the nose-lift edge of the jump window at ≈ 13 % wing at balance 0 (estimated lift-off 181 km/h there) and keeps every grid point clear of the edges. Wing nets lift below 42 % (was 46 %). |
| drag mapping | `2 + 4·a` | **`2.98 + 1.8·a`** | Wing still costs top speed (≈ 4.6 km/h per 10 % at tier 5), but tier 4's best top speed (181.8) stays below the requirement, so only tier 5 can clear. |
| torque mapping | `1000 + 550·(tier−1)` | **`700 + 700·(tier−1)`** | Bigger gap between tier 4 and 5; tier 3 (default) unchanged at 2100 N·m. |
| `SUSPENSION_STIFFNESS_BASE` | 30 | **50** | At 190 km/h the rear wing (7 kN) plus a kicker's 2 g bottomed the rear springs (0.05 m), scraping 2–7 km/h off front-heavy setups. Ride height 0.618 → 0.656 m. |
| `BIG_JUMP_LIP_KMH` | 185 | **183** | Measured requirement at the window's upper edge (≈ 36 % wing): 183.2 km/h clears, 182.2 falls. |

### Measured on `?track=test` (fixed-step, `__RACER__.advance`, full throttle from a standstill)

| Setup (aero / tier / balance) | Protocol estimate | Observed |
| --- | --- | --- |
| 50 / 3 / 0 (defaults) | top 137.5 km/h, lift never | top 138.3, 0–100 7.25 s, no wheelspin |
| 0 / 5 / 0 | top 203.6, lift-off 150.3 | nose lifts at **148.7**, then holds a wheelie at ~159 |
| 10 / 5 / 0 | top 197.7, lift-off 172.5 | nose lifts at **170.5** |
| 20 / 5 / 0 · 30 / 5 / 0 · 40 / 5 / 0 | top 192.3 · 187.3 · 182.7 | top 193.4 · 188.8 · 184.4, 0–100 4.9 s, front stays planted |
| 0 / 4 / 0 · 20 / 4 / 0 | lift-off 150.8 · top 171.7 | lifts at 149.5 · top 172.5 |
| 0 / 5 / −40 · 30 / 5 / +40 | lift-off 179.8 · top 187.3 | lifts at 178.5 · top 188.8 (0–100 4.1 s: rear-heavy launches best) |
| 100 / 1 / 0 | top 69.7 | top 69.6 |
| balance −50 / 0 / +50 | front load 70 / 50 / 30 % | 70 / 50 / 30 % (8021/3436, 5728/5728, 3436/8021 N); springs F/R 70/30, 50/50, 30/70 |

Estimates land within 1.3 % of the sim (top speed +0.5…1 %, lift-off −1…1.3 % because the 0.12 s
debounce reports a little late and load transfer under power is slightly larger than the
estimate's). Launch: tiers 1–3 never spin; tier 4 spins briefly; tier 5 spins until ~100 km/h.

## The car: voxel hypercar (`src/car/model/`)

An original track hypercar (no real-world brand, badge or logo) built from voxels at load time:
analytic shape functions sampled on a **0.08 m grid** (27 × 18 × 59 cells), then surface-paint
passes. Livery: pearl-white body, carbon aero, dark-tinted canopy under a carbon roof, neon
accents from the dashboard palette.

| Part | What it is |
| --- | --- |
| Nose / front | very low pointed beak between two front-fender pods, aero tunnels between them, carbon splitter + endplates, slashed cyan headlights |
| Front wing | two animated voxel elements (`frontWing.ts`): angle **and** chord follow the live `frontDownforce` (Front Wing Aero 0 % → 2°/4°, upper flap retracted to 30 % chord; 100 % → 26°/50°, full chord), servoing at ~9/s |
| Cabin | cab-forward canopy with tumblehome, tinted glass with a reflection streak, carbon roof and A-pillars, painted flying buttresses, mirrors |
| Sides | carbon scallop sweeping up the flank into a deep intake ahead of the rear wheel, neon edge + sill lines, carbon arch trims |
| Rear | muscular haunches, louvred engine cover, shark fin with a neon spine, open rear-wheel area, finned diffuser with a race-style rain light, twin centre exhausts, full-width magenta tail-light bar |
| Rear wing | high two-element wing on swan-neck pylons, raked endplates, magenta trailing edges |
| Wheels | 12 × 12-voxel discs (voxel = radius / 6, so the flat contact row sits exactly on the physics radius), tread blocks, yellow sidewall segments, neon rim + 5 spokes, yellow hub; spin, steer and suspension travel from `carRuntime` via `useWheelPose` |

**Live feedback (every frame from the store/runtime, no React renders):**
- *Aero LEDs* (front endplates + flap trailing edges): cyan when `frontDownforce ≥ FRONT_BODY_LIFT`
  (the wing beats body lift), magenta when the setup nets lift (Front Wing Aero ≤ 41 %), brightness ∝ the live
  front-axle aero load, fast blink while `noseLift` is set.
- *Exhaust*: colour cyan (tier 1) → yellow (tier 3) → magenta (tier 5) from `engineTorque`; glow and
  an additive voxel flame scale with throttle; a backfire pop on a sharp lift-off above 70 km/h at tier ≥ 4.
- *Tail lights + rain light* brighten under braking / handbrake.

Verified through the real relay (`squad:controls` frames from `server/src/tools/send.ts`): aero 0/tier 1 →
wing 2.0°/4.0°, LEDs magenta, exhaust cyan; 100/5 → 25.9°/49.8°, LEDs cyan, exhaust magenta;
46 % → magenta, 47 % → cyan with the body lift of 3.0 at the time (47 % = 3.055). The threshold is
`frontDownforce ≥ FRONT_BODY_LIFT`, so with today's body lift of 2.7 it sits at 41 % → magenta, 42 % → cyan.

**Rendering.** `VoxelGrid` (`voxelGrid.ts`) meshes a grid into one BufferGeometry with hidden-face
culling, writing per-vertex colour (with a small per-voxel jitter), `glow`, `channel` and `surf`
(roughness, metalness). One patched `MeshStandardMaterial` (`carMaterial.ts`) serves body, wings and
wheels; animated emissives are uniform "channels" (headlight, tail, exhaust, aero), so lights don't
need their own meshes.

| | Count |
| --- | --- |
| Body | 9,475 voxels → 6,158 exposed faces (12,316 triangles); a naive mesher would emit 56,850 faces (89 % culled) |
| Wheels | 468 voxels / 466 faces (front), 564 / 514 (rear) |
| Front wing | 70 voxels / 216 faces (two elements) |
| Car draw calls | 7 colour (body, 2 wing elements, 4 wheels) + 5 shadow (body, wheels); +1 flame mesh under throttle |
| Whole frame, chaos spawn | **35** draw calls (placeholder car: 48), 104 k triangles (was 72 k) |

Geometry is built once per page (`carAssets.ts`, ~60–140 ms in headless Chromium) and reused when the
car remounts on a track change.

The four newer shapes (same mesher, same material; headless Chromium under load):

| Shape | Grid | Voxels → body triangles | Whole car (body + 4 wheels + wing) | Build |
| --- | --- | --- | --- | --- |
| `coupeShape.ts` Ember Swallowtail | 27 × 17 × 56 | 11,128 → 9,344 | 13,296 | 51 ms |
| `driftShape.ts` Smoke Lantern | 27 × 20 × 62 | 11,290 → 10,144 | 13,808 | 137 ms |
| `electricShape.ts` Ion Dragonfly | 27 × 18 × 65 | 14,655 → 10,508 | 14,212 | 67 ms |
| `kartShape.ts` Pixel Gnat | 21 × 11 × 28 | 425 → 1,604 (the painted torso and helmet left when the kart got its open seat anchor; the driver's bust is a separate 300-triangle mesh) | 4,664 | 20 ms |

A car with an empty `exhaust` list (the electric) gets no flame mesh (`carAssets.flame` is null); its
exhaust colour channel lives in the voxels of its rear light strip instead.

## Tyre smoke (`src/car/smoke/`)

World-space voxel puffs from both rear contact points. Emission starts when a grounded rear wheel's
`slip01` passes 0.25 (full at 0.85): tier 4–5 launches, burnouts (W + S), handbrake turns and slides.

**Launch dust (all-wheel-drive cars, purely visual).** The rally's and the buggy's centre diff never
asks the front tyres for more than 60 % of their grip, so their launches hook up: on tarmac no tyre
spins at any tier and wheelspin smoke never shows (on ice their rears spin and smoke as usual). So
cars with a driven front axle kick up light dust instead (`smokeRules.ts → launchDustIntensity`):
throttle at least 0.6, below 40 km/h (full strength up to 15 km/h), scaled by the drive force asked
of the driven tyres over their grip budget (`carRuntime.driveForceN / driveGripN`, none at 0.2, full at
0.65; tier 5 on tarmac is ~0.59 for the rally and ~0.48 for the buggy, tier 1 ~0.14–0.19, so a gentle
launch stays clean). Up to 24 puffs/s from each driven wheel on the ground, low and thrown back off the
tread, lighter and shorter-lived than smoke, warm grey on tarmac and pale snow spray on a low-grip
surface; the Dune Goblin gets 1.5× the dust (rate, bigger and denser puffs). It shares the smoke's
budget (dust only gets what rear smoke leaves of 2 × 75 puffs/s, so a spinning-rear launch on ice is
smoke, not dust) and the same 384-puff pool: no extra draw call or particle.

Nothing in the physics changes: `driveForceN` / `driveGripN` are plain reads of the step's throttle,
launch boost and last tyre loads, written to `carRuntime` for the visuals only. Checked with the
scripted launches below (fixed 16 ms frames from Playwright's fake clock, `Math.random` reseeded): every
car ends each 2.5 s window at the same speed on both builds (rally tier 5 68.2 km/h, tier 4 56.4, buggy
39.1 at 150 physics steps), and rear-drive cars never enter the dust branch, so the hypercar's smoke is
identical: 370 puffs at 150 steps, 374 at 151 (the window holds 150 or 151 steps depending on the
accumulator phase), for both the tier-3 burnout and the tier-5 launch, before and after. Dust per 2.5 s
launch on tarmac: rally tier 5 84–88 puffs, tier 4 76, buggy tier 5 152; a rally cornering at
64 km/h: 0. (The old front-wheel-spin emitter it replaces never fired at a launch: the AWD front
tyres creep at 0.11–0.16 m/s.)
Rate up to 75 puffs/s per wheel, and puff size and opacity scale with slip. Wheelspin throws smoke
backwards and slides throw it sideways. Each puff starts with 30 % of the car's velocity, then air
drag bleeds that off while buoyancy lifts it. It grows on an ease-out curve and fades in and out.

Implementation:
- `SmokePool` keeps up to 384 puffs in typed arrays inside one `InstancedMesh`, using a ring buffer
  and a per-instance `aAlpha` attribute read by a patched `MeshStandardMaterial`.
- Nothing is allocated per frame. When no puffs are alive the mesh is hidden, so it costs no draw call.
- Spawns are shifted by the gap between the physics and the interpolated chassis pose, so puffs leave
  the wheel you actually see.

Measured on `?track=test`:

| Situation | Result |
| --- | --- |
| Cruising straight, tier 3, part throttle, 107 → 104 km/h | no smoke (max rear `slip01` 0) |
| Full-throttle launch, tier 1 / 2 / 3 | no smoke (max rear `slip01` 0) |
| Full-throttle launch, tier 4 / 5 | smoke from the first metre (`slip01` = 1, 150 puffs/s) until 51 / 100 km/h |
| Handbrake turn at ~86 km/h | both rears at `slip01` = 1, smoke for the whole slide |
| Burnout (throttle + brake), tier 3 | `slip01` = 1, continuous smoke while held |

## Skid marks (`src/car/skid/`)

Dark tyre marks where a grounded wheel slides, laid in world space from `carRuntime` every frame
(contact point and normal, `slip01`, the handbrake); nothing in the physics changes. A wheel marks when
its combined slip `slip01` passes 0.3 (fully dark at 0.95), and a rear wheel dragged under the handbrake
marks from 1.5 m/s even before the slip saturates; gentle cornering (`slip01` ≈ 0.05) leaves nothing.
Each wheel lays a strip perpendicular to the contact patch's travel, as wide as the tyre (0.6 × the
width when sliding sideways, the contact-patch length), lifted 2 cm along the contact normal; a jump
longer than 3 m (a respawn, a flight) starts a new strip. Marks hold for 10 s and fade over the next
10 s. Graphite rubber on built surfaces, a pale faint scuff on the Cryo Circuit's ice and the island's
salt and snow, ruts on its dirt, grass and sand (`skidRules.ts`).

The marks belong to the map: a car swap keeps them, a different map starts clean; restart and respawn
only break the strip. SETTINGS · SKID MARKS turns them off (persisted at `gamerfleet.skid.v1`).

Implementation:
- `SkidBuffer` keeps up to 2,048 quads for all four wheels in ONE interleaved vertex buffer (256 KB)
  with a static 16-bit index: one mesh, one draw call, no shadow pass. A new quad overwrites the oldest;
  quads older than 20 s are retired by moving the tail, and the draw range follows the live window.
- The fade runs in the shader (`aBorn` + a time uniform), so a frame uploads only the vertices it
  wrote and nothing is allocated per frame. With no live mark the mesh is hidden: 0 draw calls.
- Budget: ≤ 1 draw call and ≤ 4,096 triangles per frame by construction, one program.

Measured on the production build, Pixel 7 emulation (software GPU), chaos, a handbrake turn, the
same paused frame with the marks on and off via `window.__SKID__.setEnabled`: +1 draw call,
+2 triangles per live quad (exactly the buffer's count), programs and geometries unchanged; JS heap
after GC flat over 30 s of continuous sliding (±0.3 MB); the 30-combination G2 physics replay and the
G3/G4 goldens identical to `main`.

`window.__SKID__`: `stats()` (`enabled, capacity, live, written, head, tail, visible, triangles, now,
newestAgeS, trackId, fadeS, laying[4]`), `setEnabled(on)`, `clear()`.

## GamerFleet Chaos Track (`?track=chaos`, default)

A linear voxel course along +Z suspended over a bottomless void (`killY` = lowest deck − 18 m →
respawn at the last checkpoint). It is **procedural**: `generateChaosTrack(seed)` (`src/track/chaos/plan.ts`)
is pure and deterministic (mulberry32) — same seed, identical layout. The macro structure is fixed so
every seed is a complete track; the seed picks the hazard order, connector types/lengths, chicane
offsets, tile grid, pendulum/shutter counts, spacing and phases, gap length, lip angle and decor.

```
START ─ [connector] ─ CP ▸ hazard ─ connector ─ CP ▸ hazard ─ … (4 hazards, seeded order) ─ CP ▸ THE MASSIVE JUMP ─ FINISH
```

Segment library (each renders its own colliders):

| Segment | What it is |
| --- | --- |
| `straight` / `chicane` | Plain deck, or a lateral S-bend (4–8 m) built from axis-aligned 4 m voxel slices — a staircase in plan view, seamless to drive. |
| `leadIn` | Straight after each checkpoint (40–56 m, enough for ~70 km/h from a standstill at default settings); last 8 m are yellow/black hazard tiles. |
| `gap` — SKY GAP | Eased 2°→4°→6–8° kicker, an 8–10 m gap over the void (≈ 55–60 km/h needed at default settings), 48 m landing deck; the next connector is always straight (tier-5 cars fly ~70 m). |
| `tiles` — COLLAPSE ZONE | 3–4 × 11–15 grid of 4 m fixed voxel tiles over the void. First touch arms a tile; **exactly 1.0 s later** (60 physics steps) it turns dynamic and tumbles away. |
| `pendulums` — PENDULUM ALLEY | 2–4 giant 15 t wrecking blocks (3.6 × 3.0 × 3.2 m) on Rapier revolute joints, hinge 12.65 m up on a gantry, swinging ±48–54° across the track (period ≈ 7.05 s); the bob bottom passes 0.15 m above the deck. |
| `sliders` — SHUTTER GATES | 2–4 pairs of kinematicPosition walls that slide in from both edges, meet on the centreline, hold, retract (period 3.4–4.2 s). |
| `bigJump` — THE MASSIVE JUMP | 825 m dead-flat run-up with the "aero kink" (16 m lane shift), a low eased kicker (2.5° steps to 10°, lip 3.3 m above the toe), a 95 m gap over the void to a knoll 3 m below the lip, an eased landing hill, 100 m run-out with the finish and an end wall. |

Default seed `1337` (hand-validated), 1.74 km spawn → finish (all 200 tested seeds: 1.64–1.82 km):

| # | Segment | z (m) | Notes |
| --- | --- | --- | --- |
| s0 | START GRID | −24 → 40 | spawn / CP 0 at z 0 |
| s1 | CHICANE L6 | 40 → 92 | |
| s2–s3 | CP 1 ▸ PENDULUM ALLEY ×3 | 92 → 212 | pendulums at z 146 / 170 / 194 |
| s4 | STRAIGHT | 212 → 228 | |
| s5–s6 | CP 2 ▸ COLLAPSE ZONE 3×12 | 228 → 348 | field z 284 → 332 |
| s7 | CHICANE R6 | 348 → 396 | |
| s8–s9 | CP 3 ▸ SHUTTER GATES ×4 | 396 → 528 | shutters at z 450 / 470 / 490 / 510, period 3.55 s |
| s10 | STRAIGHT | 528 → 544 | |
| s11–s12 | CP 4 ▸ SKY GAP 8 m (lip 8°) | 544 → 671 | |
| s13 | CP 5 ▸ THE MASSIVE JUMP | 671 → 1804 | CP 5 z 679, kink z 1079 → 1319, kicker toe z 1504, lip z 1532 (3.3 m, 10°), knoll z 1627, finish z 1740 |

**Hazard details**
- *Collapsing tiles* — raycast wheels raise no collision events, so touches are read every step
  from `carRuntime.wheels[i].groundColliderHandle` (plus a chassis contact-pair check for belly
  flops). Countdown is counted in steps: measured touch → drop = exactly 60 steps (1.000 s; first
  downward motion one step later) for every tile in the full-course runs below. Armed tiles shake and flash orange → red;
  fallen tiles are disabled 60 m down. Tiles reset on `restart`, and on `respawn` at/before the
  field's checkpoint (reset parks the body disabled for a step before re-enabling — re-fixing a
  falling body in place leaves a stale scene-query entry and the wheel rays would miss it).
  Tiles never collide with each other or the deck (collision groups), only with the car.
- *Pendulums* — a plain revolute joint between a fixed anchor and the dynamic bob. The bare hinge
  is nearly lossless (5 min: 50/49/51° amplitude, period = target to 1 ms); a gentle clamped PD
  hinge torque (`PENDULUM.drive`, max 0.25 rad/s² vs gravity's 0.67 at full swing) tracks the free-swing sine so
  hits are recovered from within ~one swing and the staggered phases stay a readable "green wave"
  for a car holding ~94 km/h. Rapier's joint motor is deliberately not used (its
  AccelerationBased gains scale with the bob's CoM inertia, ~90× weaker than configured, and it
  bled energy out of the swing). Measured hit on a parked car: Δv = 8.7 m/s sideways in one step
  (bob 8.3 → 7.65 m/s), car thrown off the deck. The bob clears the deck by only 0.15 m (below the
  chassis floor) so a car can't be driven underneath it; a car still stopped under a bob for 1.5 s is
  respawned (`flipped`).
- *Shutters* — closure is a pure function of the hazard clock (`hazardClock.ts`, simulated time,
  reset on `restart`), so runs are deterministic under `__RACER__.advance`.

**The massive jump.** All key numbers are named constants in `src/track/chaos/config.ts → BIG_JUMP`
(`RUNUP_M`, `LANE_SHIFT_*`, `KICKER_PROFILE` → lip height/take-off angle, `GAP_M`,
`LANDING_DROP_M`, `LANDING_PROFILE`, `RUNOUT_M`, `FINISH_AT_M`), and the geometry is built so the
dashboard's `assessBigJump()` (top speed vs `BIG_JUMP_LIP_KMH`, lift-off speed) tells the truth:

- *Long, dead-flat run-up* (825 m, checkpoint → kicker toe): even from a standstill (every respawn)
  a car reaches the kicker within ~0.6 % of its top speed, and carried speed changes the lip speed
  by < 0.5 km/h. No crests: at top speed a front-light READY setup has only ~5 % of its weight on
  the front axle, so a crest would lift its nose although the estimate is right.
- *Aero kink*: 400–640 m in, the lane shifts 16 m (cosine S over 240 m). That is wider than the
  deck's slack (2 × (7 − 1) = 12 m), so there is no straight line through it: a car whose nose has
  lifted cannot steer and runs off the edge. On a racing line it needs only ~0.15 g of front grip.
- *Low kicker*: climbing a kicker at top speed costs ≈ 2·g·h of v², so it is only 3.3 m tall
  (2.5° steps over 6 m, 10° take-off); the lip speed is ~1.5–2 km/h below top speed.
- *Gap*: 95 m to the knoll — sized so the setups at the window's upper edge need exactly
  `BIG_JUMP_LIP_KMH` (183) at the lip. The lip sign shows `NEED 183 KM/H` plus the last speed-trap
  reading; a sensor at the lip and the RunController's lip-plane check record the same value.

The window (hypercar): only **Engine Tier 5** clears, with Front Wing Aero between the nose-lift
edge and the drag edge, and Chassis Balance moves the nose-lift edge. Re-measured in 1 % steps at the
edges by the integration pass (standstill at CP 5, full-throttle racing-line autopilot):

| Balance | Clears (tier 5, aero) | Fails low (nose lifts on the run-up, off at the kink) | Fails high (too slow) |
| --- | --- | --- | --- |
| −40 (front-heavy) | **10 – 34 %** (10, 11, 12, 20, 30, 32, 34 measured) | 0–9 % (lifts at 178–194 km/h) | from ~35 % (lip ≈ 183: coin flip) |
| −20 | **15 – 34 %** (15, 16, 20) | 10–14 % | from ~35 % |
| 0 | **20 – 34 %** (20, 30, 33, 34) | 0–18 % (13–18 % lift at 179–188 km/h) | 35–38 % is a coin flip (lips 182.0–183.3: 35 fell, 36 and 38 cleared); 40 % (180.9) and up fall |
| +40 (rear-heavy) | **29 – 34 %** (29, 30, 34) | 0–28 % (28 % lifts at 182.8) | 35 % (183.4) fell |
| tier 4, any aero/balance tried | — | 0–10 % | always (best 177.3 at 0 % / −45) |

The older 5 %-step table here said 15–35 % clears at balance 0 and 5–30 % at −40. Those low ends lift
the nose on the run-up with this autopilot, in the original single-car build as well (checked against
a copy of it), so it was the old estimate rule, not a regression.

Calibration grid, from a standstill at CP 5 with a full-throttle racing-line autopilot (Engine Tier
{3, 4, 5} × Front Wing Aero {0…80} at balance 0, plus tier 5 at ±40). 29 / 29 sim outcomes matched
`assessBigJump` with the original nose-lift rule; with the integration pass's rule (below) 10 / 5 / −40
reads NOSE LIFT although it clears, so 28 / 29, the miss on the safe side:

| Setup | Sim: lip speed → outcome | `assessBigJump` (top / lift-off) |
| --- | --- | --- |
| 0 / 5 / 0 · 10 / 5 / 0 | nose lift at 148.5 · 171.2 → off at the kink | NOSE LIFT (150.3 · 172.5) |
| 20 / 5 / 0 | 189.6 → **clears**, knoll reach 99.9 m | READY (192.3 / 208.7) |
| 30 / 5 / 0 | 185.4 → **clears**, 95.6 m | READY (187.3 / 285) |
| 40 · 60 · 80 / 5 / 0 | 180.9 · 172.7 · 164.9 → short | TOO SLOW (182.7 · 174.4 · 167.2) |
| 0 / 5 / −40 | nose lift at 178.6 → off at the kink | NOSE LIFT (lift-off 179.8) |
| 10 · 20 · 30 / 5 / −40 | 193.5 · 189.3 · 185.1 → **clear** | READY |
| 0 · 10 · 20 / 5 / +40 | nose lift at 112.5 · 127.9 · 154.3 → off | NOSE LIFT (113.5 · 130.2 · 157.6) |
| 30 / 5 / +40 | 185.3 → **clears** | READY (lift-off 215) |
| 0 / 4 / 0 · 10 / 4 / 0 | nose lift (149.5) / 166.6 → off · short | NOSE LIFT |
| 20 … 80 / 4 / 0 | 169.0 … 146.7 → short | TOO SLOW (171.7 … 149.2) |
| 0 / 3 / 0 | nose lift at 130 → off | NOSE LIFT |
| 10 … 80 / 3 / 0 | 148.8 … 125.8 → short | TOO SLOW |

At the slow edge (35–39 % wing, lip 182–183.4 km/h) the outcome is a coin flip that no single
number can call; the estimate says READY there. Low-wing cars fly ~1–2 % farther per v² (less drag
in the air), so they clear down to ~182 km/h.

### Big jump honesty (integration pass)

`assessBigJump` (what the dashboard's Big Jump card and the in-game telemetry show) was checked
against the sim for every car on both jump maps: 90 runs from a standstill at the jump checkpoint,
full throttle on the racing line, at each car's JUMP ATTEMPT preset, a solid READY, READY / TOO SLOW
settings 3 km/h from the edge, the nose-lift edge and a clear NOSE LIFT.

Two fixes came out of it:
- **Hypercar nose-lift rule** (`CAR_CLASSES.hypercar`, `shared/protocol.ts`). **The hypercar's physics,
  slider mapping and estimates (top speed, lift-off, needed speed, every physics helper) are byte-identical
  to the single-car game; only its verdict rule changed.** It only called NOSE LIFT when lift-off was below
  the 183 km/h requirement. On the 825 m run-up the car gets within ~1 % of its top speed, so a lift-off
  between 183 and top speed still lifts the nose: 16 settings said READY and ran off at the kink
  (4–9 % / −40, 14–18 % / 0, 10–14 % / −20, 28 % / +40; e.g. 8 / 5 / −40 lifts at 192.3 km/h in both the
  old and the new build). It now uses the same rule as the other cars: for a car that is fast enough
  (top ≥ needed), NOSE LIFT when lift-off < top speed + 12 km/h (every measured failure was < 10.4 km/h
  above top speed). A car that is too slow gets no reserve (protocol-fix pass): NOSE LIFT only when it
  actually reaches lift-off (lift-off < top speed), otherwise TOO SLOW, as before the garage. Over all
  51,005 slider positions this changes exactly 590 hypercar verdicts from the old game, all Engine Tier 5,
  READY → NOSE LIFT; tiers 1–4 read as before (e.g. 12 / 4 / 0: top 175.5, lift-off 178.8, TOO SLOW, though
  its nose lifts in the sim, see "TOO SLOW is not always nose-down" below; an interim build had called 751
  such too-slow settings NOSE LIFT, whose "add wing" hint made them slower).
  The 90 sim runs above keep their verdicts under the final rule.
- **Cloudbreak Isles requirement 160 → 163** (`track/maps/isles.ts`). The requirement is also the
  estimated top speed the hypercar needs, and the 520 m runway leaves cars 5–6 km/h short of top speed
  at the lip: estimated top 162.6 fell, 163.1 cleared. 163 also puts the rally exactly on its edge
  (165.6 fell, 166.5 cleared at 163 × 1.027 = 167.4 needed, conservative by 1 km/h).

| Map | Runs | Agree | READY but fell | Said no but cleared |
| --- | --- | --- | --- | --- |
| Chaos (183) | 55 | 52 | 2: hypercar 35 % at balance 0 / +40, lip 183.3 / 183.4 (coin-flip edge) | 1: hypercar 10 / 5 / −40 (NOSE LIFT, cleared) |
| Isles (163) | 35 | 23 | **0** | 12: 5 NOSE LIFT (the runway has no kink, so a lifted nose can still land: 4 of 5 did, the rally didn't), 7 TOO SLOW within 0.3–2.3 km/h of the car's scaled requirement |

Every READY on the Isles in these 35 runs cleared (the protocol-fix pass later found two that don't:
hypercar tier 5 at 87 % and 90 % wing, estimated top 164.8 / 163.9, lip 160.0 / 159.0, fell); every
JUMP ATTEMPT preset clears on both maps (hypercar 20 / 5 / −20, rally 2 / 5 / −40, muscle 20 / 5 / 0,
formula 14 / 5 / 0), and the buggy is TOO SLOW everywhere (128.7 km/h at the chaos lip, 125 on the
Isles; it tops out at 133 km/h, and the dashboard's hint says no setup gets it there). Each car's
other nose-lift edges held (rally, muscle and formula READY settings within 12–27 km/h of lift-off all
cleared). On the Isles the NOSE LIFT verdict is a true warning (the nose did lift within 2 % of the
estimated speed every time, and you can't steer while it's up) but not a guaranteed fall.

**TOO SLOW is not always nose-down** (dashboard-polish pass, `bigJumpHint` in
`dashboard/src/squad/bigJump.ts`). 12 / 4 / 0 does lack speed, but it doesn't only lack speed: in the sim
its nose comes up at 171.5 km/h and it leaves the track before the lip. The same happens to rally 5 / 4 / 30
(163.4), muscle 18 / 4 / 36 (163.9) and formula 1 / 4 / −40 (183.6). The old TOO SLOW hint said "raise
Engine Tier or trim the front wing", and each wing point less lowers lift-off far faster than it raises
top speed (median in that window: hypercar −2.5 / +0.5 km/h, rally −3.5 / +0.4, muscle −1.9 / +0.3,
formula −8.3 / +1.1). When lift-off is less than the car's `noseLiftReserveKmh` above top speed (12 / 10
/ 12 / 8 km/h for hypercar / rally / muscle / formula), the hint now says "raise Engine Tier and keep the
front wing (lift-off X km/h is close to top speed Y; less wing lifts the nose)". It also warns that more
engine lowers lift-off too, so the next verdict is usually NOSE LIFT. Calibration: 88 TOO SLOW settings
with a lift-off on the chaos jump (tiers 2–5, balance −45…+50, standstill at the checkpoint, full
throttle). 30 lifted the nose or ran off before the lip, every one within its car's reserve. The largest
gaps were hypercar 10.0 km/h (27 / 4 / +50), muscle 8.7, rally 8.5 and formula 4.6: rearward balance
lifts at the larger gaps, forward balance only within ~3 km/h. None of the 19 settings at or above the
reserve lifted. At Engine Tier 5 the hint can't ask for more tier: there it says to move Chassis Balance
forward first, then trim the wing, or use the JUMP ATTEMPT preset (rally 5 / 5 / 0 falls short at 179.8
and 3 / 5 / 0 lifts its nose, while 5 / 5 / −40 clears at 184.3 and 2 / 5 / −40 at 185.0; muscle
23 / 5 / 30 lifts at 182.4 and 20 / 5 / 0 clears at 182.6). See `dashboard/README.md`.

**Landing speed vs the lip sign** (protocol-fix pass). `bigJumpKmh` (the sign, `game:state`, the
estimate's target) is not the lip speed that lands, so the map catalog also carries `landKmh` (hypercar)
and `landKmhByCar`, and the dashboard's speed trap guesses LIKELY CLEARS / LIKELY SHORT against those
(`landKmhOf` in `track/catalog.ts`, copied in `dashboard/src/squad/garage.ts`). Measured with the same
standstill-at-the-checkpoint runs, sliders swept around each car's edge (≈ 70 runs): the value is the
first 0.5 km/h step above the fastest lip speed that fell, so every measured run at or above it landed.

| Map (sign) | Hypercar | Rally | Muscle | Formula | Evidence (fastest fall → slowest landing above it) |
| --- | --- | --- | --- | --- | --- |
| Chaos (183) | 183.5 | 184 | 182 | 188.5 | hypercar 183.4 (35 % / +40) → 183.6; rally 183.5 → 183.8; muscle 181.9 → 182.0; formula 188.4 → 189.5 |
| Isles (163) | 160.5 | 160.5 | 156.5 | 164.5 | hypercar 160.0 (87 %) → 160.3; rally 160.3 → 160.7; muscle 156.1 → 156.5; formula 164.3 → 165.0 |

Below these a jump can still land (the edge is a coin flip over 1–2 km/h, and low wing flies farther:
the hypercar lands from 182.0 at 38 % on chaos, the formula from 161.6 at tier 4 on the Isles). The
buggy has no landing speed: it never gets near either lip.

**The speed trap's verdict is the outcome** (dashboard-polish pass, `watchSpeedTrap` in
`dashboard/src/squad/bigJump.ts`). Since a landed jump can sit 1–3 km/h under these numbers (formula Isles
23 / 4 / 0 landed at 161.6 vs 164.5; muscle chaos 28 / 5 / 0 at 180.6 vs 182), CLEARED / SHORT come from the
telemetry after the reading. On both jump maps `bigJump()` (`track/chaos/plan.ts`) is the last section:
one checkpoint at the start of its run-up, then the lip, the landing hill and the finish gate 36 m into the
run-out, with no checkpoint after the lip. So `finished` turning true after a `speedTrapKmh` reading means
that jump landed (CLEARED). A rise in `falls` means it dropped into the void (SHORT). Until either happens
the card shows LIKELY CLEARS / LIKELY SHORT in grey against the landing speed, and the margin stays on screen
for information (`CLEARED −2.9`, `SHORT +1.0`). `speedTrapKmh` is set on every lip crossing and only cleared
by a restart, car change or map change (`freshRun`). A respawn keeps it, so a retry after a fall is a new
reading with its own verdict.

Full-course autopilot from the spawn (default settings 50 / 3 / 0, `?ws=off`): CP1 6.7 s, CP2 11.1 s,
CP3 15.8 s, CP4 19.8 s, **CP 5 at 23.3 s with 0 falls**, 12 tiles collapsed exactly 60 steps after
the first wheel touch. Switching to a READY setup at CP 5: 25 / 5 / 0 → lip 187.9 km/h, 2.12 s / 95.3 m
flight, **finish 46.0 s**; 20 / 5 / −20 (the dashboard's JUMP ATTEMPT preset) → lip 190.1, 98.6 m,
finish 45.7 s. 40 / 5 / 0 with carried speed: lip 181.3 → falls every attempt. A 15 t bob hitting a
parked car at 7.7 m/s throws it sideways at 8.6 m/s, off the deck, and it respawns.

`window.__CHAOS__` (installed by the chaos track): `describe()` (segment list, checkpoints, lip),
`plan()`, `centerX(z)` (ideal line, for autopilots), `tiles()`, `collapses()` (touch/drop step log),
`pendulums()` (angle vs target, bob pose/velocity), `shutters()`, `hazardTime()`, `generate(seed)`
(pure, for determinism checks), `setPendulumDrive(k, c, maxAccel?)`, `renderInfo()`.

Rendering: all static scenery is one merged vertex-coloured voxel mesh with a glow attribute
(~2.7k boxes), tiles and debris are InstancedMeshes, gate labels share one canvas atlas, billboards
one merged mesh — the whole frame (car, environment and shadow pass included) is 35 draw calls at
the spawn and 24 on the jump run-up (≈ 110 k triangles), measured with `renderer.info` in the
production build.

## Live link & performance (measured)

Against the real relay (`server/`, `npx tsx src/index.ts --port 18790`), production build, headless
Chromium (SwiftShader software GL), Node playing the dashboard:

| Check | Result |
| --- | --- |
| `squad:controls` send → game handler | 1.1–3.8 ms (relay + loopback); parse + store update 0.3–0.5 ms |
| Store update → car | applied on the **next fixed step**: stepping exactly one step on arrival moved the Rapier body from 1170 → 1110 kg, CoM z −0.410 → −0.432 m and springs to 34/34/66/66 (aero 10 / tier 2 / balance +40) |
| `server/src/tools/send.ts controls 20 5 -20` | game physics → mass 1290, torque 3500, drag 3.34, springs 58/58/42/42 |
| `sim-dashboard` (6 s, 167 frames at ~30 Hz) | game applied every change; dashboard got 39 `game:state` (throttled to ≤ 10 Hz, latest values) + 52 `game:telemetry` (mean interval 110 ms) |
| Sliders hammered at 30 Hz while driving | same chassis body handle before/after (no remount); main-thread script 6 ms/frame idle → 14 ms/frame (≈ 1.1 ms per controls frame); 0 console errors |
| Draw calls / triangles | 35 / 112 k at the spawn, 24 / 109 k on the jump run-up |
| Frame time (SwiftShader, CPU-rasterised) | 200 ms at 960×540, 270–290 ms at 1280×720 — fill-rate bound in software GL; main-thread JS is ~6 ms of it |

**Every car on every map, through the real menu and relay** (integration pass: Pixel 7 landscape,
relay on its own port, ☰ → MAPS / GARAGE taps for all 30 combinations, a Node client playing the
dashboard). Every combination loaded, spawned on four wheels, ran 3 · 2 · 1 · GO (events 3, 2, 1, 0)
and reached checkpoint 1 with 0 falls (autopilot, default sliders). Its `game:state` carried the right
`carId` / `trackId` / `bigJumpKmh`, and a dashboard `squad:controls` 20 / 5 / −20 produced exactly
`mapSquadControlsToPhysics(controls, carId)` in the game for each car (torque 3500 / 2640 / 4500 / 2100
/ 2480 N·m). Then all six maps three times with car swaps: identical Rapier bodies / colliders / joints
and renderer geometries / textures / programs on every visit, flat JS heap, 0 errors.

Time to checkpoint 1 (s, default sliders, autopilot; a repeat run lands within ±0.3 s, the hazard phase at the start differs):

| Map | Hypercar | Rally | Muscle | Formula | Buggy |
| --- | --- | --- | --- | --- | --- |
| chaos | 7.07 | 7.17 | 6.38 | 6.82 | 8.98 |
| ribbon | 10.88 | 10.85 | 9.63 | 10.73 | 12.48 |
| isles | 8.57 | 8.63 | 7.97 | 8.67 | 11.07 |
| cryo | 9.68 | 7.83 | 9.47 | 8.18 | 9.82 |
| strip | 16.13 | 16.30 | 14.85 | 16.08 | 21.38 |
| test | 21.58 | 21.87 | 20.45 | 21.75 | 28.73 |

Draw calls / triangles per map (production build, `renderer.info`, shadow pass included, hypercar):

| Map | Spawn | Busiest checkpoint |
| --- | --- | --- |
| chaos | 35 / 112 k | 37 / 113 k (CP 1, pendulums) |
| ribbon | 31 / 108 k | 36 / 109 k (CP 1) |
| isles | 24 / 113 k | 26 / 114 k (CP 4) |
| cryo | 30 / 104 k | 31 / 105 k (CP 1) |
| strip | 21 / 101 k | 21 / 101 k |
| test | 44 / 35 k | 46 / 35 k (grid + ramp meshes, few triangles) |

Per car at the chaos spawn: 34–35 calls, 101–112 k triangles, 12 shader programs for all five.

Per-step code allocates nothing of its own (scratch vectors, reused kinematic targets, an
allocation-free pendulum swing helper); the remaining per-step objects are Rapier's own getters.
HUD numbers are written from rAF into DOM refs; only the jump-verdict line, the link panel and the
uplink feed re-render on a slider change.

## Debug handle — `window.__RACER__`

Stable scripting surface (used by the automated tests; handy in the console):

```ts
__RACER__.getState()   // { position, velocity, up, speedKmh, forwardSpeed, wheelsGrounded,
                       //   wheels: [{ inContact, suspensionForce, slip01, suspensionLength, lateralSlip,
                       //              longitudinalSlip, spinRate, steering, groundColliderHandle }] (FL, FR, RL, RR),
                       //   noseLift, frontAeroN, rearAeroN, groundEffect, rearSlip, frontAxleLoadN, rearAxleLoadN,
                       //   driveForceN, driveGripN (drive asked of the driven tyres vs their grip; visuals only),
                       //   throttle, brake, steer, airborneTime, physics, controls, link, serverUrl, dashboards,
                       //   checkpoint, totalCheckpoints, falls, finished, elapsedMs, bestMs, speedTrapKmh,
                       //   track, stepCount, simTime, car: { bodyHandle, mass, localCom, suspensionStiffness[],
                       //   suspensionCompression[], suspensionRelaxation[] } }
__RACER__.respawn()                 // back to the last checkpoint
__RACER__.restart()                 // full run reset
__RACER__.teleport(checkpointIndex) // make that checkpoint current and go there
__RACER__.placeAt([x, y, z], yaw?)  // put the car on a ground point (run progress untouched)
__RACER__.setInput({ throttle, brake, steer /* −1…1, + = right */, handbrake } | null) // null = keyboard again
__RACER__.setPhysics(patch)         // same path as a physics:set frame; returns params
__RACER__.setControls(controls)     // same path as a squad:controls frame; returns params
__RACER__.advance(seconds)          // simulate synchronously in fixed steps; returns getState()
__RACER__.telemetry()               // the next game:telemetry payload
__RACER__.linkStats()               // { connected, sent, received, rejected, connects } | null
__RACER__.setCar(carId)             // same path as the garage; returns the resolved id (getState().carId)
__RACER__.estimates()               // { carId, topSpeedKmh, liftOffKmh, bigJump: assessBigJump(...) | null }
__RACER__.session()                 // { carId, trackId, bigJumpKmh } exactly as sent in game:state
```

A scripted driver (`setInput` with throttle > 0.05) skips the start lights, so automated timings are
unchanged. Other handles: `window.__HUD__` (menu, start lights, results — see the menu section),
`window.__MAPS__` (see [Maps](#maps)), `window.__CHAOS__` (below), `window.__CARFX__` and
`window.__AUDIO__` (live mix, engine, sfx and haptics counters — `src/audio/README.md`),
`window.__WORLD__` (the island — [Tests and debug handle](#tests-and-debug-handle)), `window.__PROFILE__`
(drivers and MY RIDE), `window.__PWA__` (install / offline / update state — [Install as an app](#install-as-an-app)),
`window.__INPUT__` (tilt and gamepad status — [Controls](#controls)), `window.__RIVALS__` (rivals, standings,
ghost — [Rivals and ghost](#rivals-and-ghost-srcrivals)), `window.__SKID__` (skid-mark buffer stats —
[Skid marks](#skid-marks-srccarskid)) and `window.__ROOM__` (rooms — [Play with friends](#play-with-friends-srcmultiplayer)).

`window.__CARFX__` (car visuals, read-only): `model()` (voxel/face counts, build time), `live()`
(wing angles/chords, light-channel radiance, flame length, car draw calls), `smoke()` (capacity,
alive, emitted, current rate, `dustRate` = the launch-dust part of it, `dustEmitted` = launch-dust puffs
since the emitter mounted; both 0 for rear-drive cars), `renderInfo()` (renderer calls/triangles/geometries/programs).

## Code map / extension points

```
src/main.tsx, App.tsx          entry (main.tsx registers the service worker: pwa/register.ts); Canvas → PausablePhysics
                               (<Physics timeStep=1/60 paused={menuOpen}>, subscribed inside the R3F tree) → Track,
                               PlayerCar (keyed by map + car), RunController, RivalsLayer, debug handle,
                               RemotePlayersLayer; <HUD/>, <GameAudio/>
src/config.ts                  PHYSICS_DT, resolveServerUrl(), getQueryParam(), isNetworkDisabled()
src/state/selection.ts         persisted player choices: carId, trackId, menuOpen, settings {sound, volume, haptics}
src/state/store.ts             zustand store (carId, physics, controls, link, uplink feed, run, trackLayout, ui) + actions;
                               loadBestTime(trackId, carId)
src/state/records.ts           medals per car (MEASURED_COURSE_S → medalScale → medalsFor) on top of the catalog's
                               hypercar medalsMs; jumpReach() / computeJumpReach() (can this car ever clear this
                               map's big jump? top-speed short-circuit, then an early-exit scan)
src/game/events.ts             typed bus: restart, respawn, teleported, checkpoint, finish, countdown
src/game/countdown.ts          3 · 2 · 1 · GO start lights (simulated time) + the throttle/brake drive lock
src/game/RunController.tsx     timer, checkpoints, finish, kill plane, speed trap, flip recovery, start lights
src/game/runClock.ts           exact run timer (simulated time)
src/car/catalog.ts             garage cards (CAR_CATALOG); physics per car = CAR_CLASSES in shared/protocol.ts
src/car/vehicleSpec.ts         per-car geometry (getVehicleSpec): chassis frame, wheels, axles, collider, COM helpers
src/car/runtime.ts             carRuntime: per-step mutable state for visuals/hazards/HUD/audio (carId, spec)
src/car/carController.ts       Rapier raycast vehicle + aero/drive (centre diff for AWD)/brakes/steering, surfaceGrip
src/car/drivetrain.ts          wheelspin model;  tuning.ts: handling constants
src/car/Car.tsx                RigidBody + controller wiring; renders <CarModel/> (chassis frame), <TireSmoke/> and <SkidMarks/> (world)
src/car/model/                 voxel cars: models.ts (per-car shape, livery, wheels, lights), <car>Shape.ts,
                               shapeKit.ts, CarModel.tsx (meshes, live wing/lights/exhaust, useWheelPose),
                               frontWing.ts, wheelVoxels.ts, voxelGrid.ts (hidden-face mesher), carMaterial.ts,
                               carAssets.ts (build-once cache), carFxDebug.ts (window.__CARFX__)
src/car/smoke/                 TireSmoke.tsx (emitter, frozen while paused), smokeRules.ts (rears smoke on slip,
                               AWD launch dust from drive force / grip), smokePool.ts, smokeMaterial.ts
src/car/skid/                  SkidMarks.tsx (one ring-buffered mesh for all four wheels), skidBuffer.ts, skidMaterial.ts
                               (shader fade), skidRules.ts (when / how dark / how wide), skidStore.ts (SKID MARKS setting),
                               SkidSettings.tsx, skidDebug.ts (window.__SKID__)
src/input/                     inputBus.ts (touch + tilt + gamepad composed into car/input.ts), compose.ts, tilt.ts,
                               gamepad.ts, InputSettings.tsx (SETTINGS · CONTROLS), InputChip.tsx (HUD notices)
src/state/inputSettings.ts     steering mode, tilt range / invert / offset (gamerfleet.input.v1)
src/pwa/                       register.ts (service worker, install prompt, update flag), InstallCard.tsx (SETTINGS · APP)
src/rivals/                    RivalsLayer.tsx (rivals, race clock, name-tag projector), rivals.ts + speedPlan.ts (who and
                               how fast), route.ts / classicRoute.ts / islandRoute.ts / routeCache.ts (the race line),
                               standings.ts (one ranking for player, rivals, remote players), KinematicCar.tsx,
                               GhostCar.tsx + ghost.ts (shadow ghost tapes), NameTags.tsx + nameTags.ts, store.ts,
                               RivalsSettings.tsx (SETTINGS · RACE)
src/multiplayer/               roomClient.ts (rooms on the relay socket), roomStore.ts, raceFlow.ts (shared start / finish),
                               clockSync.ts, poseSender.ts, remotePlayers.ts (interpolation), RemotePlayersLayer.tsx,
                               identity.ts, friendsProfile.ts (device token, YOUR NAME), sceneProbe.ts,
                               FriendsTab.tsx (☰ FRIENDS), FriendsResultLine.tsx, roomDebug.ts (window.__ROOM__)
src/audio/                     GameAudio.tsx + audioSystem.ts (WebAudio engine/tyres/wind/sfx), gearbox.ts,
                               presets.ts (per car), haptics.ts, engineReadout.ts (gear for the HUD), README.md
src/track/catalog.ts           map cards (TRACK_CATALOG: difficulty, medals, tips), bigJumpKmhOf(layout)
src/track/types.ts             TrackLayout contract (+ surfaceGrip, atmosphere), isInsideGate(), totalCheckpointsOf()
src/track/registry.ts          TRACKS map + resolveTrackId; Track.tsx mounts useSelection().trackId, keyed by id
src/track/maps/                recipes: chaos.ts, ribbon.ts, isles.ts, cryo.ts, strip.ts, helpers.ts, index.ts
src/track/mapsDebug.ts         window.__MAPS__
src/track/useTrackLayout.ts    useRegisterTrackLayout(layout)
src/track/common/              Gate (checkpoint arch), neonGridTexture(), buildRamp() (eased ramp profiles)
src/track/test/TestTrack.tsx   Proving Ground (calibration straight)
src/track/chaos/               the generator every recipe runs on: recipe.ts (TrackRecipe, palette, chaos defaults),
                               config.ts (chaos tunables), plan.ts (generateTrack(recipe, seed), pure data),
                               scenery.ts/voxel.ts (merged voxel geometry + glow material), StaticTrack (colliders,
                               gate/trap sensors), hazards/ (CollapsingTiles, PendulumGauntlet, SlidingWalls),
                               Decor (signs, billboards, clouds, shards, towers), ChaosTrack.tsx, chaosDebug.ts
src/scene/Environment.tsx      sky, fog, lights, stars, void grid from the layout's atmosphere
src/net/squadLink.ts           WebSocket client + useSquadLink(); game:state with carId/trackId/bigJumpKmh;
                               telemetry.ts builds game:telemetry
src/hud/                       HTML overlay (rAF-driven numbers, no 60 Hz React renders): TopBar (phones, + the P n/N chip),
                               Positions (chip, standings sheet, desktop lines), Speedometer (desktop), GameMenu (☰, nine
                               tabs), Countdown, Results, StartGate, TouchControls, SwipeSlider, Banners, LinkPanel,
                               TelemetryPanel, PhysicsPanel, Minimap, hudDebug (__HUD__), autoPause (menu on RACE when
                               the page is hidden mid-run)
src/camera/ChaseCamera.tsx     chase / orbit / onboard, framed per car size
src/debug/racerHandle.ts       window.__RACER__
```

**Adding a map:** write a `TrackRecipe` in `src/track/maps/<map>.ts` (start from the chaos defaults in
`chaos/recipe.ts`; the program is a list of sections: straights, chicanes, gaps, islands, tiles,
pendulums, sliders, a big jump or a finish straight), add it to `RECIPES` (`maps/index.ts`), to
`TRACKS` in `registry.ts` and to `TRACK_CATALOG` (`track/catalog.ts`), and copy its name / accent /
jump speed into `dashboard/src/squad/garage.ts` (`dashboard/test/garage.test.ts` fails if they drift).
A hand-built map is a component that renders fixed colliders + visuals and calls
`useRegisterTrackLayout(layout)`. Hazards subscribe to `onGameEvent('restart' | 'respawn', …)` to
reset, and can detect the car via `carRuntime.wheels[i].groundColliderHandle` /
`wheelsOnCollider(handle)` (wheel contact) or `isCarCollider(handle)` (chassis collisions). Sensors
are ignored by the wheel raycasts. A big jump's `requiredKmh` is the estimated top speed the
hypercar needs (`assessBigJump` scales it per car), so calibrate it from a standstill at the jump's
checkpoint — see [Big jump honesty](#big-jump-honesty-integration-pass).

**Adding a car:** add a class to `CAR_CLASSES` (`shared/protocol.ts`), a spec to `vehicleSpec.ts`,
a shape + livery to `car/model/models.ts`, a sound preset to `audio/presets.ts` (optional: one is
derived from the garage stats), a card to `CAR_CATALOG`, and its colour / JUMP ATTEMPT preset to the
dashboard (`garage.ts`, `presets.ts`). Measure its full-course time on each map the same way and add
it to `MEASURED_COURSE_S` (`state/records.ts`); until then it gets the hypercar's medal times. Its
big-jump reach is computed from its class, nothing to add. A new map with medals needs a row there
too (missing cars keep the hypercar's times).

## Drivers and MY RIDE (`src/drivers/`, `src/ride/`, `src/state/profile.ts`)

Cosmetic layers over the car classes: nothing here changes handling, best times or medals.

**Drivers.** Five original stylised voxel characters (slot 1 is the owner's first name, marked
OWNER; the other four are invented nicknames), every name editable (14 code points, touch
keyboard, `sanitizeName` strips controls / bidi marks / markup). A face is an `AvatarConfig`
(8 skin tones, 9 hair styles × 8 colours, 6 helmets / hats, 5 visors, 5 eyes × 6 colours, 5
mouths, 4 glasses, 4 beards, 5 marks, a signature colour): built from blocks, never from a photo,
so no look can resemble a real person; the LOOK builder lets the player make a look-alike of a
friend. The same config draws the 24×24 portrait (`drivers/portrait.ts`, a cached data URL) and the
in-car bust (`drivers/bust.ts` → `DriverBust.tsx`): at most 40 boxes merged into one geometry on
the shared car material (defaults 14–25 boxes = 168–300 triangles, worst combination 32 boxes =
384; measured +1 draw call / +300 triangles for the owner in the buggy, cast-shadow off). Open
cockpits (Razorwing, Dune Goblin, Pixel Gnat) show the bust at the seat anchor in `ride/anchors.ts`; closed
cabins are solid voxel bodies with opaque glass, so the livery paints the driver's helmet and face
into the side glass and windscreen beside the seat instead (0 draw calls, 0 extra triangles; 4–28
recoloured cells per class; every class has an authored anchor, the glass-derived guess is only for
a class added later). Share codes `DRV1-…` (19 / 31 / 51 characters min / median / max over
3,000 random drivers; CRC-8, version nibble, every field range-checked; fuzzed codes never throw).

**MY RIDE.** A `RideConfig` over any base class: paint (body / second / accent), neon trim, wheel
preset + rim colour, spoiler (lip, GT wing, fin — stamped voxels on the rear deck, found by scanning
the body), exhaust tips (none / single / twin / quad chrome tips at the class's outlet height; the
flame follows `outlets`), stance (a body offset of −4…+8 cm, wheels and physics untouched), name
and plate text (handed to the plate system). `ride/livery.ts applyLook(grid, spec, def, look)` is a
pure function: it copies the class's filled grid, stamps and recolours the copy and returns it with
the material table; the input grid is never written (tested). The ride keeps its base class's
handling exactly, so records and the dashboard's estimates stay keyed by the base `carId`. Share
codes `RIDE1-…` (42 / 61 / 84 characters; a code naming a class this build lacks decodes to the
default base with `known: false`).

**Preview cost** (`ride/previewAssets.ts`, the class grid filled once per page, then applyLook +
mesh per change): node warm medians 2.4–6.6 ms per class (kart 0.8 ms); headless Chromium on a
loaded 4-core box: first build 77–83 ms (cold JIT), then 5–8 ms for a paint change and 6–47 ms for
a geometry change (median 18.7 ms, one outlier at 51 ms); the first fill of a class 28–136 ms
(one-off). Slider-speed changes are debounced (60 ms trailing): 30 changes 12 ms apart → 1 rebuild.
The preview is its own small canvas (8–10 draw calls, ~14 k triangles, 3 programs) that unmounts with
the tab, so the game's frame cost is unchanged while the builder is closed.

**Persistence** `gamerfleet.profile.v1` (drivers, active driver, ride, mounted flag; junk saves fall
back field by field). `?driver=DRV1-…` puts a shared driver in slot 2 and `?ride=RIDE1-…` mounts a
shared ride. Dev pages: `lab-drivers.html`, `lab-ride.html` (dev server only), debug handle
`window.__PROFILE__` (`installProfileDebug()`): `state()`, `builds()` (rebuild log), `render()`,
`bust()`, `rideCode()`, `driverCode()`. Tests: `game/test/drivers.test.ts`, `game/test/ride.test.ts`
(`dashboard/node_modules/.bin/tsx --tsconfig game/tsconfig.app.json --test game/test/drivers.test.ts game/test/ride.test.ts`).
`game:state` carries the optional `driverName` / `rideName` (≤ 14 code points, `sanitizeDisplayText`).

## Garage, DRIVERS and MY RIDE in the game (integration)

Everything above in "Drivers and MY RIDE" and in the car / plate sections is wired into the live game:

- **☰ menu tabs.** Eight tabs — RACE · GARAGE · DRIVERS · MY RIDE / MAPS · PHYSICS · SETTINGS · SQUAD
  (`hud/uiStore.ts MENU_TABS`): two rows of four in portrait (91 px buttons on a Pixel 7, 79 px at
  360 px, nothing clipped), a two-column rail of four in phone landscape (≤ 420 px tall), the usual
  single rail on desktop. DRIVERS and MY RIDE are one lazy chunk (`DriversTab` / `RideTab` +
  `profile.css`), prefetched while the menu is open, so the first tap is instant and the race page's
  bundle does not grow.
- **GARAGE.** Nine cards (catalog order); the number-plate editor (`hud/PlateEditor.tsx`, test ids
  `plate-*-<car>`) sits directly under the selected car's card, spanning the row (a card is a button,
  so the editor is its sibling). Picking a stock car calls `profileState().setRideActive(false)`: MY
  RIDE comes off, the profile keeps it for later.
- **MY RIDE.** `<RideTab preview="button" onDrive>`: DRIVE MY RIDE sets `rideActive`, selects the
  ride's base class (`setCar(ride.base)`) and closes the menu. The 3D preview is a second WebGL
  context, so it waits for a **SHOW 3D PREVIEW** tap and then mounts two frames later behind a
  "BUILDING PREVIEW…" veil (`RidePreview onReady` drops it after the first frame that drew the car).
  Measured headless (SwiftShader, load ~7): the compile is a 4.9 s long task the first time and 5.9 s
  on a repeat open (every context compiles again under software GL), far over the 400 ms bar, so the
  button is the default on every open; the car on track wears the look regardless. Opening the other
  tabs: menu open 152 ms (same as before: 75–200 ms on this box for every tab), GARAGE 53 ms, DRIVERS
  / MY RIDE / MAPS / PHYSICS / SETTINGS / SQUAD no long task.
- **How the look reaches the car.** `car/model/carAssets.ts getCarAssets(carId, look)` applies
  `ride/livery.ts applyLook` over the class's body grid (filled once per page, shared with the
  preview via `ride/previewAssets.ts baseGridFor`): `look.materials` colour the body, wing and
  wheels, `look.wheelStyle` picks the wheel preset, `look.outlets` place the flame (exhaust `none` ⇒
  no flame mesh). Results are cached by `carId|rideLookKey|avatarKey` in an 8-entry LRU (evicted
  geometries disposed). `CarModel` reads the look from the profile store — `ride` only while
  `rideActive && ride.base === spec.id`, the active driver's avatar always — so a paint change
  re-renders the model with other cached geometries in place: no remount, the physics body, wheels
  and run clock are untouched (a physics replay is identical; the look is vertex colours and extra
  voxels on the visual mesh). Stance moves the body / wing / plate / flame / bust group on Y; the
  wheels stay on the road.
- **Driver bust and window.** Open cockpits (`ride/anchors.ts seatFor(id).open`: Razorwing, Dune
  Goblin, Pixel Gnat) mount `<DriverBust>` inside the body group with the shared car material (+1 draw call, no
  shadow; 14 boxes / 168 triangles for the default Anaye). The Razorwing's and the Pixel Gnat's painted stock
  driver voxels are gone (`formulaShape.ts driver()` keeps only the seat, `kartShape.ts driver()` the legs and
  arms; the kart's bust sits where its yellow helmet was, h 0.48 / z −0.22). Closed cabins get the driver's
  helmet / face painted into the glass beside the seat by `applyLook` (0 extra draw calls); Smoke Lantern
  (door glass only, 9 + 5 cells) and Ion Dragonfly (door glass + screen, 23 + 5) have authored anchors too.
- **Plates.** The car wears `car/plates/platePick.ts useWornPlate(carId)`: MY RIDE's plate while the
  ride is mounted on that class, else the garage's own text, else the catalog default; `plateFor()`
  is the same rule for the results and `__RACER__`. The garage editor always edits the stock car's
  plate (it comes back when the ride is unmounted), so a ride never overwrites it.
- **Session fields.** `net/squadLink.ts gameSessionInfo()` adds `driverName` and, while the ride is
  worn, `rideName` (both through `sanitizeDisplayText`); `SquadLink` re-sends `game:state` on any
  profile change (rename, driver swap, ride edit, mount / unmount). The relay copies both into
  `snapshot.session` for late dashboards (`server/test/relay.test.ts`).
- **Flavour.** RACE tab "now" chip shows the plate (and `MY RIDE · <name>` with the base class);
  the menu header names the ride; the results subtitle adds `· <plate> · <driver>`; the start card
  shows the driver's name and taunt.
- **Debug.** `window.__PROFILE__` is installed next to `__RACER__` (`debug/racerHandle.ts`);
  `__RACER__.setPlate(text)` edits the plate of the car in play and returns what it now wears.
- **Budget (Pixel 7 landscape, GamerFleet Chaos spawn, headless SwiftShader, this session):** Neon
  Hypercar 36 calls / 111,994 triangles / 12 programs (HEAD 35 / 111,982: +1 call and +12 triangles
  for the plate, 0 for the painted driver window), Ember Swallowtail 35 / 105,458, the coupe wearing a
  GT wing + quad tips ride 35 / 106,490, Razorwing with the bust 37 / 101,302 (portrait). Budget
  48 / 160 k.
- **Catalog data.** Landing lip speeds from the cars builder's runs: chaos `coupe 182.5`,
  `electric 175`; Isles `kart 164.5` (mirrored in `dashboard/src/squad/garage.ts`, test-guarded). The
  kart's Isles card tip comes from the new `tipByCar` field: "JUMP ATTEMPT (10 / T5 / −30) from the
  leap's checkpoint" (`GameMenu.tsx setupTip`).
