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
| `?track=<id>` | Track id from `src/track/registry.ts`: `chaos` (default, the GamerFleet Chaos Track) or `test` (1.85 km calibration straight). Unknown ids fall back to the default. |
| `?seed=<n\|text>` | Chaos-track layout seed (integer, or any text — hashed). Omitted = the hand-validated default seed `1337`. |
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

### Touch (phones and tablets)

Phones and tablets get on-screen controls automatically (a coarse primary pointer, or touch with no
hover-capable pointer; a laptop with a touchscreen stays a desktop). `?touch=1` forces them on,
`?touch=0` off. They work alongside the keyboard, and `__RACER__.setInput` still overrides both.

| Control | Action |
| --- | --- |
| Steer pad (left thumb, ◀ ▶) | Analog steer from the finger's position: a thumb on ◀ / ▶ (or further out) is full lock like A / D, sliding toward the centre gives partial lock for fine corrections. Sliding off the pad lets go. |
| GAS · BRAKE / REVERSE · DRIFT (right thumb) | Throttle, brake (reverses once stopped), handbrake. A finger presses whichever pedal it is on, so one thumb can slide gas → brake or gas → drift. |
| ⟲ RESPAWN · ⏮ RESTART · ◉ camera · ▤ HUD · ⚙ PHYSICS | Same actions as R · T · C · H · P. HUD (H) hides the status chips for a clean view. Buttons fire when the finger lifts on them; slide off to cancel. |
| ⤢ FULL | Fullscreen and, where the browser allows it, locks to landscape. Portrait stays fully playable (the camera pulls back and widens). |

Every finger is tracked separately (steer and throttle at the same time) and everything is
released when a finger is cancelled, the window loses focus or the tab is hidden. On phone-sized
screens the HUD is compact: Squad Link and telemetry are chips that expand on tap, the run panel is
timer + checkpoint, and the physics panel opens (scrollable) in the space between the thumbs.
Touch devices render at a device-pixel ratio of at most 1.5 with a 512 px sun shadow map.

## Physics model

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
| Rear | muscular haunches, louvred engine cover, shark fin with a neon spine, open rear-wheel area, finned diffuser with an F1 rain light, twin centre exhausts, full-width magenta tail-light bar |
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

## Tyre smoke (`src/car/smoke/`)

World-space voxel puffs from both rear contact points. Emission starts when a grounded rear wheel's
`slip01` passes 0.25 (full at 0.85): tier 4–5 launches, burnouts (W + S), handbrake turns and slides.
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

The window: only **Engine Tier 5** clears, with Front Wing Aero between the nose-lift edge and
the drag edge, and Chassis Balance moves the nose-lift edge (measured in 5 % steps):

| Balance | Clears (tier 5, aero) | Fails low (nose lift at the kink) | Fails high (too slow) |
| --- | --- | --- | --- |
| −40 (front-heavy) | **5 – 30 %** | 0 % (lifts at 179 km/h) | 35 % (183.0) and up |
| 0 | **15 – 35 %** | 0–10 % (lift at 149 / 171 km/h) | 40 % (180.9) and up |
| +40 (rear-heavy) | **30 %** | 0–25 % (lift at 113–172 km/h) | 35 % (183.3) and up |
| tier 4, any aero/balance tried | — | 0–10 % | always (best 177.3 at 0 % / −45) |

Calibration grid, from a standstill at CP 5 with a full-throttle racing-line autopilot (Engine Tier
{3, 4, 5} × Front Wing Aero {0…80} at balance 0, plus tier 5 at ±40). **29 / 29 sim outcomes match
`assessBigJump`**:

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

Off the grid the estimate is right except in two narrow bands at the window's edges: 36–37 % wing
(estimate READY, the lip is ~1.5 km/h short of the top speed the estimate uses, so the car falls)
and ~1 % of wing just above the nose-lift edge (the sim lifts ~1 % below the estimated speed).
Low-wing cars fly ~1–2 % farther per v² (less drag in the air), so they clear down to ~182 km/h.

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
```

`window.__CARFX__` (car visuals, read-only): `model()` (voxel/face counts, build time), `live()`
(wing angles/chords, light-channel radiance, flame length, car draw calls), `smoke()` (capacity,
alive, emitted, current rate), `renderInfo()` (renderer calls/triangles/geometries/programs).

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
src/car/model/                 voxel hypercar: CarModel.tsx (meshes, live wing/lights/exhaust, useWheelPose),
                               hypercarShape.ts (body shape + paint passes), frontWing.ts, wheelVoxels.ts,
                               voxelGrid.ts (hidden-face mesher), carMaterial.ts (palette + channel material),
                               carAssets.ts (build-once cache), carFxDebug.ts (window.__CARFX__)
src/car/smoke/                 TireSmoke.tsx (emitter), smokePool.ts (instanced pool), smokeMaterial.ts
src/track/types.ts             TrackLayout contract, isInsideGate(), totalCheckpointsOf()
src/track/registry.ts          TRACKS map + DEFAULT_TRACK_ID; Track.tsx picks by ?track=
src/track/useTrackLayout.ts    useRegisterTrackLayout(layout)
src/track/common/              Gate (checkpoint arch), neonGridTexture(), buildRamp() (eased ramp profiles)
src/track/test/TestTrack.tsx   calibration straight
src/track/chaos/               GamerFleet Chaos Track (default): config.ts (every tunable), plan.ts (seeded
                               generator, pure data), scenery.ts/voxel.ts (merged voxel geometry + glow material),
                               StaticTrack (colliders, gate/trap sensors), hazards/ (CollapsingTiles,
                               PendulumGauntlet, SlidingWalls), Decor (signs, billboards, debris), chaosDebug.ts
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
