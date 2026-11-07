# Handling v2 — branch status

This branch (`m2-handling`) carries the realistic handling pass. It is **not merged into `main`** yet because two
calibration steps that depend on it were not finished inside the owner's time window. Nothing here is wired to
the Pages site or the game people play until it is merged.

## What is on the branch (verified)

- `shared/cars/<id>.ts` and `game/src/car/tuning/<id>.ts`: one file per car class (a pure split, proven
  bit-identical to the single-file version), then the Handling v2 numbers per class.
- `game/src/car/carController.ts` + `game/src/car/handling.ts`: behind `CAR_TUNING.handlingV2` (on for all nine
  classes): load-sensitive tyres, a friction ellipse (combined slip), a real gearbox stepped in physics with a
  per-class torque curve (the audio follows it), ABS with live brake bias, Ackermann steering with a slip-aware
  cap and a counter-steer assist, anti-roll bars implemented as load transfer, a rear differential lock, and an
  ASSISTS on/off setting (`GameSettings.assists`, no UI yet).
- Bench results on the Proving Ground (Engine Tier 5 for 0–100, Tier 3 for the rest), every class inside ±12 %
  of the targets in the plan: hypercar 3.05 s / 1.32 g / 34 m, formula 2.42 s / 1.61 g / 26 m, muscle 4.18 s /
  1.05 g / 39 m, rally 3.80 s / 1.14 g / 35 m, buggy 5.08 s / 0.85 g / 42 m, coupe 3.55 s / 1.16 g / 34 m,
  drift 3.92 s / 1.03 g / 37 m, electric 3.15 s / 1.16 g / 36 m, kart 3.53 s / 1.41 g / 29 m. Top speeds kept
  within 0.4 % of before. Before this pass the cars took 5.7–9.9 s to 100 km/h and braked in 18–34 m.
- With the flag off the physics replay goldens are byte-identical to `main` (G2 `20695bc576484202`); with the
  flags on the new replay hash is `d275743a6ea0cdf4` (to be pinned when merged).
- Tests: `game/test/handling.test.ts` (10), relay 45, dashboard 72 (jump pins re-pinned with reasons), world 6.

## What is still missing before a merge

1. **Jump calibration**: chaos lip sign and `landKmhByCar`, Isles landing speeds, `jumpSpeedScale` /
   `noseLiftReserveKmh` per class, the dashboard JUMP presets and their tests. The cars reach the lips 1–14 km/h
   nearer their top speed now, so the current numbers are slightly conservative but not wrong in direction.
2. **Medals**: every `MEASURED_COURSE_S` row (5 classic maps + 4 island races × 9 cars) with the per-car
   autopilot table in the scratch report `best10/m2/c0/ap2.js`, the hypercar `medalsMs` rows in the catalog,
   the island off-road grip targets (`OFFROAD_K`) re-checked.
3. Docs and mirrors: README car tables, `CAR_CATALOG.stats`, the dashboard garage mirror, re-pinning G2/G4.
4. An ASSISTS toggle in SETTINGS (the setting exists and is read by the controller).

The stage reports with every command and number live in the session scratchpad under `best10/m2/`
(`model`, `baseline`, `tune-1`, `tune-2`, `c0`); the plan is `best10/PLAN-M2.md`.
