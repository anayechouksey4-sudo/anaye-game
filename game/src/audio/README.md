# Sound and haptics (`game/src/audio/`)

All sound is synthesized live with WebAudio. There are no audio files and no extra dependencies.
`GameAudio.tsx` (mounted once by `App.tsx`) creates an `AudioSystem` and disposes it on unmount.

| File | What it does |
| --- | --- |
| `audioSystem.ts` | Owns the AudioContext lifecycle (mobile autoplay rules, hidden tab, mute, menu duck). Runs the rAF loop (≤ ~60 Hz, `setTargetAtTime` glides, no per-frame allocation) and subscribes to game events and selection. |
| `mixGraph.ts` | The persistent graph (34 nodes). One looping noise source feeds engine grit, tyre squeal (two resonant bands plus a quiet tonal core, with warble), wind and road rumble. Then come the engine voice and a one-shot bus, followed by duck → master → 35 Hz high-pass → limiter. It works on any `BaseAudioContext`, so tests render the real mix offline. |
| `engineVoice.ts` | The engine: 3 oscillators locked to the firing frequency → drive → soft-clip shaper → resonant low-pass that opens with load. It adds an amplitude "lump" (uneven-firing burble), band-passed grit and an optional turbo whistle. |
| `gearbox.ts` | Simulated sequential gearbox, used for sound only. Gearing is fitted to the car's current `estimateTopSpeedKmh` (it follows Engine Tier and wing). Shifts depend on throttle, with ignition-cut upshifts and rev-matched downshifts under braking. Kickdown is supported. There are no shifts in the air, so the engine bounces off the limiter mid-jump. Wheelspin flare is capped. A clutch-slip launch is modelled. It follows simulated time. |
| `presets.ts` | Per-car character: `hypercar` (10-cyl shriek, 7 gears), `rally` (turbo four, whistle + blow-off, 6), `muscle` (lumpy eight, overrun crackle, 5), `formula` (12k-rpm six, 8 fast shifts), `buggy` (rattly flat four, 4). Catalog cars missing from the table get a preset derived from their garage stats. Unknown ids get a generic six. |
| `sfx.ts` | One-shots: start-light beeps (A5, GO on A6), checkpoint chime, finish fanfare (+ sparkle on a personal best), fall whoosh, respawn blip, impact thud (+ metallic clank for hits), exhaust pops, blow-off. |
| `impacts.ts` | Detects hard landings from approach speed into the surface (velocity · contact normal) and hits from horizontal Δv beyond a tyre budget (1.8 g grip + up to 2 g downforce at speed). It re-arms on teleports and step gaps. |
| `haptics.ts` | `navigator.vibrate` patterns with rate limits. Limits are per-kind cooldowns, a 90 ms minimum gap and a budget of 450 ms of buzzing per 2 s. Haptics fire only when `settings.haptics` is on, the page is visible and the page has had a user gesture. |
| `engineReadout.ts` | Read-only `{ gear, gears, rpm, rpmFrac, redline, limiter, shifting, shifts }` and `gearLabel()`, so a HUD can show the gear the player hears. |
| `audioDebug.ts` | `window.__AUDIO__`. |

Haptic patterns (ms):

| Event | Pattern |
| --- | --- |
| Start lights 3 · 2 · 1 / GO | 12 / 40 |
| Checkpoint | 24 |
| Finish | 45, 80, 45 (personal best adds 80, 110) |
| Fall | 220 |
| Hard landing / hit | 30 / 40, scaled by intensity |

## Mobile rules

- The context is created and resumed on the first activating gesture: `pointerup`, `touchend`, `click` or `keydown`. Chrome does not count a touch `pointerdown`, so a GAS press held from page load would stay silent until that finger lifted (browser policy). On touch devices the HUD's start gate (`hud/StartGate.tsx`) asks for one tap first, which unlocks the sound before the first start lights.
- When the tab is hidden, the context is suspended. When it is visible again, the context resumes.
- Sound off fades the master to 0, then suspends the context after 1.5 s to save battery. Volume maps to master = 0.8 · volume².
- When the ☰ menu is open, the mix is ducked to 0.3. The simulation is paused, so the engine idles and squeal, wind and road go silent.

## `window.__AUDIO__`

```
state ('locked' until the first tap, then the AudioContext state) · unlocked · muted · sound · volume ·
master / masterValue (live gain) · duck / duckValue · menuOpen · hidden · preset · carId ·
engine { rpm, gear, freq (firing Hz), load, limiter, shifting, redline, gears, topKmh, shifts } ·
squeal · wind · road (0…1) · impacts { landings, hits, lastKind, lastIntensity } ·
sfx { countdown, go, checkpoint, finish, fall, respawn, impact, pop, blowoff } (played counts) ·
haptics { supported, fired, suppressed, lastKind, lastPattern } · frames · nodes · time
```
