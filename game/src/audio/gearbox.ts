/**
 * Simulated sequential gearbox for the engine sound only (the physics has a single fixed drive
 * ratio). Pure and allocation-free: feed it the driven-wheel speed, throttle and contact each
 * audio frame and read `rpm`, `gear`, `load` and the event bits.
 *
 * Gearing is fitted to the car's CURRENT estimated top speed (shared/protocol estimateTopSpeedKmh,
 * which follows Engine Tier and Front Wing Aero from the dashboard), so every setup climbs through
 * all its gears and reaches top speed in top gear just below the redline:
 *   speed at redline in gear i = vTop · firstGearFrac^((n−1−i)/(n−1)),  vTop = topSpeed / TOP_GEAR_RPM_FRAC
 *
 * Shift logic (automatic, like a paddle-shift auto mode):
 *   - upshift at shiftUpLight…shiftUpFull of redline depending on throttle (short-shifts when cruising);
 *   - downshift below shiftDownFrac (earlier under braking, with a rev-matching blip), kickdown at full throttle;
 *   - no shifts while airborne (so the engine bounces off the limiter mid-jump), a minimum time between shifts,
 *     and a jump straight to the right gear after a discontinuity (teleport, scripted advance).
 *   - an upshift cuts the ignition for `shiftTime` (the audible "bap" of a fast gearbox) and drops the rpm
 *     by the ratio step; 1st and reverse slip the clutch so the engine revs at a standstill launch.
 */
import { TOP_GEAR_RPM_FRAC } from '@shared/protocol';
import type { EnginePreset } from './presets';

/** Top speed is reached in top gear at this fraction of the redline (shared with the Handling v2 engine math). */
export { TOP_GEAR_RPM_FRAC };
/** Minimum time between two shifts: this many upshift cuts, clamped to [MIN, MAX] s (quick boxes shift more often). */
const SHIFT_INTERVAL_CUTS = 3;
const SHIFT_INTERVAL_MIN = 0.2;
const SHIFT_INTERVAL_MAX = 0.45;
/** Limiter bounce frequency, Hz, and how far the rpm drops on each cut. */
const LIMITER_HZ = 15;
const LIMITER_DROP_RPM = 380;
/** Clutch-slip launch rpm at full throttle, fraction of redline (1st / reverse only). */
const LAUNCH_RPM_FRAC = 0.5;
/**
 * Wheelspin flare: how far spinning driven wheels may pull the rpm above road speed, as a fraction
 * of the current gear's span (on the ground / in the air). Without a cap a tier-5 launch (tyres
 * up to 22 m/s faster than the road) would race through the gears at walking pace; with it the
 * engine flares and bounces off the limiter like a spinning launch, and still climbs the gears
 * with the car. In the air the wheels spin free, so the engine screams up to the limiter.
 */
const FLARE_GROUND = 0.3;
const FLARE_AIR = 0.65;

export const GEAR_EVENT_UPSHIFT = 1;
export const GEAR_EVENT_DOWNSHIFT = 2;
/** Sharp lift-off at high rpm: backfire pops / blow-off. */
export const GEAR_EVENT_LIFTOFF = 4;
/** First touch of the limiter. */
export const GEAR_EVENT_LIMITER = 8;

export interface GearboxInput {
  /** Seconds since the last update (simulated time while driving; capped at 0.25). */
  dt: number;
  /** Road speed along the car, m/s, ≥ 0. */
  carSpeed: number;
  /** Driven-wheel surface speed, m/s, ≥ 0 (follows wheelspin and free spin in the air). */
  driveSpeed: number;
  /** Applied throttle 0…1. */
  throttle: number;
  /** Applied brake 0…1. */
  brake: number;
  /** A driven wheel is on the ground. */
  grounded: boolean;
  reversing: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class Gearbox {
  preset: EnginePreset;
  /** Estimated top speed the gearing is fitted to, m/s. */
  topSpeed = 50;
  /** 1…gears, −1 = reverse. */
  gear = 1;
  rpm: number;
  /** Load 0…1: smoothed throttle with shift / limiter cuts and downshift blips. */
  load = 0;
  /** Bouncing off the limiter this frame. */
  limiter = false;
  /** In an upshift's ignition cut. */
  shifting = false;
  /** Ignition cut this frame (an upshift's cut or the limiter's off phase): no torque. */
  cut = false;
  /** Bits of GEAR_EVENT_* raised by the latest update. */
  events = 0;
  shifts = 0;

  /** Speed at redline per forward gear, m/s (index 0 = 1st). */
  private readonly gearTop = new Float64Array(10);
  private throttleSmooth = 0;
  private recentThrottle = 0;
  private sinceShift = 10;
  private cutLeft = 0;
  private blipLeft = 0;
  private limiterPhase = 0;
  private wasLimiter = false;

  constructor(preset: EnginePreset, topSpeedMs = 50) {
    this.preset = preset;
    this.rpm = preset.idleRpm;
    this.configure(preset, topSpeedMs);
  }

  /** New car or new top speed (Engine Tier / aero changed). Keeps gear and rpm. */
  configure(preset: EnginePreset, topSpeedMs: number): void {
    const changedCar = preset !== this.preset;
    this.preset = preset;
    this.topSpeed = clamp(Number.isFinite(topSpeedMs) ? topSpeedMs : 80, 12, 140);
    const n = clamp(Math.round(preset.gears), 1, this.gearTop.length);
    const vTop = this.topSpeed / TOP_GEAR_RPM_FRAC;
    for (let i = 0; i < n; i++) {
      this.gearTop[i] = n === 1 ? vTop : vTop * Math.pow(preset.firstGearFrac, (n - 1 - i) / (n - 1));
    }
    if (changedCar) this.reset();
    else this.gear = clamp(this.gear, -1, n);
  }

  get gearCount(): number {
    return clamp(Math.round(this.preset.gears), 1, this.gearTop.length);
  }

  /** Back to 1st at idle (respawn, restart, new car). */
  reset(): void {
    this.gear = 1;
    this.rpm = this.preset.idleRpm;
    this.load = 0;
    this.limiter = false;
    this.shifting = false;
    this.cut = false;
    this.events = 0;
    this.throttleSmooth = 0;
    this.recentThrottle = 0;
    this.sinceShift = 10;
    this.cutLeft = 0;
    this.blipLeft = 0;
    this.limiterPhase = 0;
    this.wasLimiter = false;
  }

  /** Engine rpm the wheels would turn in forward gear `gear` (1-based) at `speed` m/s. */
  wheelRpm(gear: number, speed: number): number {
    const top = this.gearTop[clamp(gear, 1, this.gearCount) - 1]!;
    return (speed / top) * this.preset.redlineRpm;
  }

  /** Firing frequency, Hz: the engine's fundamental. */
  get firingHz(): number {
    return (this.rpm / 60) * (this.preset.cylinders / 2);
  }

  get rpmFrac(): number {
    return this.rpm / this.preset.redlineRpm;
  }

  update(input: GearboxInput): number {
    const p = this.preset;
    const n = this.gearCount;
    const dt = clamp(input.dt, 0, 0.25);
    const throttle = clamp(input.throttle, 0, 1);
    const road = Math.max(0, input.carSpeed);
    const slip = Math.max(0, input.driveSpeed - road);
    const flare = input.grounded ? FLARE_GROUND : FLARE_AIR;
    let events = 0;

    this.sinceShift += dt;
    this.cutLeft = Math.max(0, this.cutLeft - dt);
    this.blipLeft = Math.max(0, this.blipLeft - dt);

    // ── Gear selection ──
    if (input.reversing) {
      this.gear = -1;
    } else {
      if (this.gear < 1) this.gear = 1;
      const roadRpm = this.wheelRpm(this.gear, road);
      const rpmNow = this.wheelRpm(this.gear, road + Math.min(slip, flare * this.gearTop[this.gear - 1]!));
      if (roadRpm > p.limiterRpm * 1.15 || (this.gear > 1 && roadRpm < p.redlineRpm * 0.2 && road > 1)) {
        // Discontinuity (teleport, scripted advance): pick the right gear for the road speed outright.
        let g = 1;
        while (g < n && this.wheelRpm(g, road) > p.redlineRpm * lerp(p.shiftUpLight, p.shiftUpFull, 0.6)) g++;
        if (g !== this.gear) {
          this.gear = g;
          this.sinceShift = 0;
          this.shifts += 1;
        }
      } else if (input.grounded && this.sinceShift >= clamp(p.shiftTime * SHIFT_INTERVAL_CUTS, SHIFT_INTERVAL_MIN, SHIFT_INTERVAL_MAX)) {
        const upRpm = throttle > 0.05 ? p.redlineRpm * lerp(p.shiftUpLight, p.shiftUpFull, throttle) : p.redlineRpm * 0.985;
        const step = this.gear > 1 ? this.gearTop[this.gear - 1]! / this.gearTop[this.gear - 2]! : 1;
        // A downshift must land below the redline and, on the throttle, below that throttle's
        // upshift point (no hunting). Off the throttle the upshift point is the redline, so braking
        // can drop gears early with rev-matching blips.
        const landing = throttle > 0.05 ? Math.min(upRpm, p.redlineRpm * lerp(p.shiftUpLight, p.shiftUpFull, 0.25)) * 0.92 : p.redlineRpm * 0.9;
        const maxDown = landing / step;
        const downRpm = Math.min(p.redlineRpm * (p.shiftDownFrac + 0.18 * clamp(input.brake, 0, 1)), maxDown);
        if (this.gear < n && rpmNow >= upRpm) {
          this.gear += 1;
          this.sinceShift = 0;
          this.cutLeft = throttle > 0.2 ? p.shiftTime : 0;
          events |= GEAR_EVENT_UPSHIFT;
        } else if (this.gear > 1 && rpmNow < downRpm && road > 0.5) {
          this.gear -= 1;
          this.sinceShift = 0;
          this.blipLeft = 0.11;
          events |= GEAR_EVENT_DOWNSHIFT;
        } else if (this.gear > 1 && throttle > 0.92 && rpmNow < p.redlineRpm * 0.5 && rpmNow * step < p.redlineRpm * 0.8) {
          // Kickdown.
          this.gear -= 1;
          this.sinceShift = 0;
          this.blipLeft = 0.08;
          events |= GEAR_EVENT_DOWNSHIFT;
        }
      }
    }

    // ── Target rpm ──
    const g = this.gear < 1 ? 1 : this.gear;
    const wheel = this.wheelRpm(g, road + Math.min(slip, flare * this.gearTop[g - 1]!));
    let target = Math.max(p.idleRpm, wheel);
    if (this.gear <= 1) {
      // Clutch slip at a launch: the engine revs above the wheels until they catch up.
      const launch = p.idleRpm + throttle * (p.redlineRpm * LAUNCH_RPM_FRAC - p.idleRpm);
      if (wheel < launch) target = Math.max(target, launch);
    }
    if (this.blipLeft > 0) target = Math.max(target, this.rpm * 1.04);

    this.limiter = target >= p.limiterRpm;
    let limiterCut = false;
    if (this.limiter) {
      this.limiterPhase = (this.limiterPhase + dt * LIMITER_HZ) % 1;
      limiterCut = this.limiterPhase >= 0.5;
      target = limiterCut ? p.limiterRpm - LIMITER_DROP_RPM : p.limiterRpm;
      if (!this.wasLimiter) events |= GEAR_EVENT_LIMITER;
    } else {
      this.limiterPhase = 0;
    }
    this.wasLimiter = this.limiter;

    const rising = target > this.rpm;
    const rate = this.cutLeft > 0 || (events & (GEAR_EVENT_UPSHIFT | GEAR_EVENT_DOWNSHIFT)) !== 0 ? 32 : this.limiter ? 40 : rising ? p.revUpRate : p.revDownRate;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));

    // ── Load ──
    this.throttleSmooth += (throttle - this.throttleSmooth) * (1 - Math.exp(-14 * dt));
    let load = this.throttleSmooth;
    if (this.cutLeft > 0) load *= 0.12;
    if (limiterCut) load *= 0.2;
    if (this.blipLeft > 0) load = Math.max(load, 0.65);
    this.load = load;
    this.shifting = this.cutLeft > 0;
    this.cut = this.shifting || limiterCut;

    // ── Lift-off (pops / blow-off) ──
    this.recentThrottle = Math.max(this.recentThrottle * Math.exp(-3 * dt), throttle);
    if (throttle < 0.15 && this.recentThrottle > 0.7 && this.rpmFrac > 0.5) {
      events |= GEAR_EVENT_LIFTOFF;
      this.recentThrottle = 0;
    }

    if (events & (GEAR_EVENT_UPSHIFT | GEAR_EVENT_DOWNSHIFT)) this.shifts += 1;
    this.events = events;
    return events;
  }
}
