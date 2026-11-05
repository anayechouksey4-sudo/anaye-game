# GamerFleet Racer (game/)

3D voxel hypercar racer built with React Three Fiber + `@react-three/rapier`. The car's physics
are tuned live over WebSocket by the **SquadHQ** dashboard (`dashboard/`) through the relay
(`server/`). The wire protocol and the physics model live in [`../shared/protocol.ts`](../shared/protocol.ts).

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
| `?track=<id>` | Track id from `src/track/registry.ts` (`test` = 1.85 km calibration straight). Unknown ids fall back to the default. |
| `?debug=1` | Rapier collider wireframes. |

Relay URL resolution: `?ws=` → `VITE_SQUAD_WS_URL` (build-time env) → `ws://<page hostname>:8787`,
so opening the game from another device on the LAN just works.

## Controls

| Key | Action |
| --- | --- |
| W / ↑ | Throttle |
| S / ↓ | Brake; reverse once stopped |
| A D / ← → | Steer (speed sensitive) |
| Space | Handbrake |
| W + S | Burnout (front brakes hold, rears spin) |
| R | Respawn at the last checkpoint |
| T / Backspace | Restart the run |
| C | Camera: chase → orbit (mouse) → onboard |
| P | Physics panel (live sliders for every `CAR_PHYSICS_SPECS` param) |
| H | Help |

A standard-mapping gamepad also works (RT throttle, LT brake, left stick steer, A/B handbrake).

## Physics model

Everything is read from the store **every fixed step** (`1/60 s`), so a dashboard change is applied
on the very next step — no remounts, no React renders on the hot path.

| Slider (dashboard) | Param (`CarPhysicsParams`) | What the car does |
| --- | --- | --- |
| Front Wing Aero | `frontDownforce`, `drag` | Vertical force **at the front-axle midpoint**: `(frontDownforce − FRONT_BODY_LIFT) · v_fwd²` along chassis −up, applied with `applyImpulseAtPoint` every step (also airborne). Negative = lift: with too little wing the front wheels leave the ground at speed. |
| Engine Tier | `engineTorque`, `mass` | Rear-wheel drive. Each rear wheel gets `(engineTorque / 2) / DRIVE_WHEEL_RADIUS` through a 1-DOF wheelspin model (`src/car/drivetrain.ts`): if that exceeds the tyre's grip budget the wheel breaks loose and spins (no traction control). |
| Chassis Balance | `balance` | Centre of mass moved along the car axis so the static front-axle load = `balanceToFrontWeightFraction(balance)`, and per-axle spring stiffness = `balanceToSuspensionStiffness(balance)` (dampers scale with √k). |
| — | `traction` | Rapier friction slip / side-friction stiffness on every tyre. |

Also: rear wing `REAR_DOWNFORCE · v_fwd²` at the rear axle, drag `−drag · v · |v|` at the centre of
mass, rolling resistance while grounded, speed-sensitive steering, ABS-less brakes, handbrake
(rear brake + rear grip drop), reverse at 45 % torque up to 32 km/h. In the air, the body has a
dart-like pitch stability (restoring moment toward the flight path + pitch/roll damping) so long
jumps are flyable with good settings while the aero couple still pitches the car.
Non-protocol tuning lives in `src/car/tuning.ts`; geometry in `src/car/vehicleSpec.ts`.

### Measured on `?track=test` (fixed-step, `__RACER__.advance`)

| Setup (aero / tier / balance) | Protocol estimate | Observed |
| --- | --- | --- |
| 50 / 3 / 0 (defaults) | top 135.4 km/h | top 136.7 km/h, 0–100 7.5 s, no wheelspin |
| 0 / 5 / 0 | top 237.4, lift-off 165.3 km/h | front wheels off at **137.9 km/h** (full throttle; `noseLift` flag at 145.7 after debounce), then a stable ~19° wheelie at ~155 km/h |
| 20 / 5 / 0 | top 200.7, lift-off 218.9 | nose lifts at **186 km/h**, holds a ~15° wheelie at 181 km/h |
| 30 / 5 / 0 | top 187.7, lift-off 279.5 | top 189.9 km/h, front stays planted (1.8 kN on the front axle at top speed) |
| 100 / 1 / 0 | top 75.3 | top 75.4 km/h |
| balance −50 / 0 / +50 | front load 70 / 50 / 30 % | 70.0 / 50.0 / 30.0 % (8027/3435, 5729/5729, 3435/8027 N); springs F/R 42/18, 30/30, 18/42 |
| launch, tier 1 / 3 / 4 / 5 | — | mean rear slip over the first 3 s: 0 / 0 / 0.77 / 0.99 (tier 5 spins at the 22 m/s slip limiter until ~100 km/h) |

Lift-off happens earlier than `estimateFrontLiftOffKmh` because under power the drive force at the
contact patch (below the CoG) moves load off the front axle: ≈ `driveForce · 0.45 m / 2.7 m`
(1.48 kN at tier 5). Subtracting that from the static front load predicts 145 / 192 km/h vs
the observed 138 / 186.

Test kicker (eased 3°→11°, lip 4.8 m high) after a 1.51 km run-up, full throttle:

| Setup | Lip speed (speed trap) | Flight | Peak nose-up in flight | Landing |
| --- | --- | --- | --- | --- |
| 30 / 5 / 0 | 185.7 km/h | 2.0 s, 90 m | 17° | upright |
| 20 / 5 / 0 | 184.2 km/h | 2.2 s, 98 m | 21° | upright |
| 15 / 4 / 0 | 170.1 km/h | 2.2 s, 91 m | 21° | upright |
| 0 / 5 / 0 | 165.1 km/h (in a wheelie) | 2.5 s, 102 m | 26° | upright |
| 50 / 3 / 0 | 132.3 km/h | 1.5 s, 51 m | 12° | upright |

A single sharp 11° kink instead of the eased profile scrubs ~14 km/h on entry (front springs
spike to ~37 kN per wheel) — use `buildRamp()` for jumps.

## Debug handle — `window.__RACER__`

Stable scripting surface (used by the automated tests; handy in the console):

```ts
__RACER__.getState()   // { position, velocity, up, speedKmh, forwardSpeed, wheelsGrounded,
                       //   wheels: [{ inContact, suspensionForce, slip01, suspensionLength, lateralSlip,
                       //              longitudinalSlip, spinRate, steering, groundColliderHandle }] (FL, FR, RL, RR),
                       //   noseLift, frontAeroN, rearAeroN, rearSlip, frontAxleLoadN, rearAxleLoadN,
                       //   throttle, brake, steer, airborneTime, physics, controls, link, serverUrl, dashboards,
                       //   checkpoint, totalCheckpoints, falls, finished, elapsedMs, bestMs, speedTrapKmh,
                       //   track, stepCount, simTime, car: { mass, localCom, suspensionStiffness[],
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
```

## Code map / extension points

```
src/main.tsx, App.tsx          entry; Canvas → <Physics timeStep=1/60> → Track, PlayerCar, RunController, debug handle
src/config.ts                  PHYSICS_DT, resolveServerUrl(), getTrackParam(), isNetworkDisabled()
src/state/store.ts             zustand store (physics, controls, link, uplink feed, run, trackLayout, ui) + actions
src/game/events.ts             typed bus: restart, respawn, teleported, checkpoint, finish
src/game/RunController.tsx     timer, checkpoints, finish, kill plane, speed trap, flip recovery
src/game/runClock.ts           exact run timer (simulated time)
src/car/vehicleSpec.ts         geometry: chassis frame, wheels, axles, collider, COM helpers
src/car/runtime.ts             carRuntime: per-step mutable state for visuals/hazards/HUD
src/car/carController.ts       Rapier raycast vehicle + aero/drive/brakes/steering
src/car/drivetrain.ts          rear wheelspin model;  tuning.ts: handling constants
src/car/Car.tsx                RigidBody + controller wiring; renders <CarModel/> (chassis frame) and <TireSmoke/> (world)
src/car/model/CarModel.tsx     placeholder body + useWheelPose(wheel) hook
src/car/smoke/TireSmoke.tsx    placeholder (null)
src/track/types.ts             TrackLayout contract, isInsideGate(), totalCheckpointsOf()
src/track/registry.ts          TRACKS map + DEFAULT_TRACK_ID; Track.tsx picks by ?track=
src/track/useTrackLayout.ts    useRegisterTrackLayout(layout)
src/track/common/              Gate (checkpoint arch), neonGridTexture(), buildRamp() (eased ramp profiles)
src/track/test/TestTrack.tsx   calibration straight
src/net/squadLink.ts           WebSocket client + useSquadLink(); telemetry.ts builds game:telemetry
src/hud/*                      HTML overlay (rAF-driven numbers, no 60 Hz React renders)
src/camera/ChaseCamera.tsx     chase / orbit / onboard
src/debug/racerHandle.ts       window.__RACER__
```

**Adding a track:** create `src/track/<name>/<Name>Track.tsx` that renders fixed colliders + visuals
and calls `useRegisterTrackLayout(layout)` with a module-level `TrackLayout`; add it to `TRACKS` in
`registry.ts` (set `DEFAULT_TRACK_ID` to make it the default). Hazards subscribe to
`onGameEvent('restart' | 'respawn', …)` to reset, and can detect the car via
`carRuntime.wheels[i].groundColliderHandle` / `wheelsOnCollider(handle)` (wheel contact) or
`isCarCollider(handle)` (chassis collisions). Sensors are ignored by the wheel raycasts.
