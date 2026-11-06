/**
 * Read-only engine readout for the HUD (gear indicator, tachometer): the same simulated gearbox the
 * engine sound uses, so the number on screen matches what the player hears. Written in place by the
 * audio loop every frame (also before the sound is unlocked and while it is muted); read it from a
 * requestAnimationFrame loop like `carRuntime`. Never replace the object.
 */
export interface EngineReadout {
  /** 1…n, −1 = reverse. */
  gear: number;
  /** Number of forward gears of the current car. */
  gears: number;
  rpm: number;
  /** rpm / redline (≈ 0.1 at idle, 1 at the upshift point, slightly above on the limiter). */
  rpmFrac: number;
  redline: number;
  /** Bouncing off the rev limiter (e.g. throttle held in the air). */
  limiter: boolean;
  /** In an upshift's ignition cut. */
  shifting: boolean;
  /** Increments on every gear change (flash the indicator when it changes). */
  shifts: number;
  /**
   * Handling v2: the car's physics steps the gearbox and writes this readout every step; the sound
   * then follows it instead of simulating its own (which it still does while no live car exists).
   */
  live: boolean;
  /** Engine load 0…1 (smoothed throttle with the shift / limiter cuts), for the engine voice. */
  load: number;
  /** GEAR_EVENT_* bits raised since the sound last read them (the reader clears them). */
  events: number;
}

export const engineReadout: EngineReadout = {
  gear: 1,
  gears: 1,
  rpm: 0,
  rpmFrac: 0,
  redline: 1,
  limiter: false,
  shifting: false,
  shifts: 0,
  live: false,
  load: 0,
  events: 0,
};

/** HUD helper: 'R', 'N' (no car / before the first frame) or the gear number. */
export function gearLabel(r: EngineReadout = engineReadout): string {
  if (r.rpm <= 0) return 'N';
  return r.gear < 0 ? 'R' : String(r.gear);
}
