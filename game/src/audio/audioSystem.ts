/**
 * The game's sound and haptics: one AudioContext, the persistent node graph of mixGraph.ts and a
 * requestAnimationFrame loop that steers it from `carRuntime` at up to ~60 Hz (setTargetAtTime
 * glides, no per-frame allocation), plus one-shots for game events and navigator.vibrate.
 *
 * Mobile rules: the context is created and resumed on the first activating gesture (pointerup /
 * touchend / click / keydown; a touch pointerdown doesn't count in Chrome), suspended while the
 * tab is hidden and after a moment with the sound off, and ducked while the ☰ menu is open (the
 * simulation is paused then, so the loops fall back to idle). Settings apply live.
 */
import { CAR_CLASSES, estimateTopSpeedKmh, isCarClassId, type CarPhysicsParams } from '@shared/protocol';
import { resolveCarId } from '../car/catalog';
import { PHYSICS_DT } from '../config';
import { carRuntime } from '../car/runtime';
import { onGameEvent, type GameEventMap } from '../game/events';
import { selectionState, useSelection, type GameSettings } from '../state/selection';
import { gameState, useGameStore } from '../state/store';
import { installAudioDebug, type AudioDebug } from './audioDebug';
import { engineReadout } from './engineReadout';
import type { EngineFrame } from './engineVoice';
import { GEAR_EVENT_LIFTOFF, GEAR_EVENT_UPSHIFT, Gearbox, type GearboxInput } from './gearbox';
import { Haptics } from './haptics';
import { IMPACT_HIT, IMPACT_LAND, ImpactDetector } from './impacts';
import { createMixGraph, disposeMixGraph, updateLoops, type LoopFrame, type MixGraph } from './mixGraph';
import { getEnginePreset, type EnginePreset } from './presets';
import {
  backfirePop,
  blowOff,
  checkpointChime,
  countdownBeep,
  fallWhoosh,
  finishFanfare,
  impactThud,
  respawnBlip,
  type SfxOut,
} from './sfx';

/** Master level at volume 1 (headroom for the limiter). */
const MASTER_LEVEL = 0.8;
/** Duck factor while the menu is open. */
const MENU_DUCK = 0.3;
/** Engine level while paused (it idles under the menu). */
const PAUSED_ENGINE_LEVEL = 0.4;
/** Suspend the context this long after the sound is switched off, ms (saves battery). */
const MUTE_SUSPEND_MS = 1500;
/** Minimum time between two audio frames, ms (caps updates near 60 Hz on 90/120 Hz screens). */
const MIN_FRAME_MS = 12;
/** Speed for full wind, m/s (≈ 270 km/h). */
const WIND_FULL_MS = 75;

const GESTURE_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function engineTier01(physics: CarPhysicsParams, carId: string): number {
  const k = isCarClassId(carId) ? CAR_CLASSES[carId] : CAR_CLASSES.hypercar;
  const tier = 1 + (physics.engineTorque - k.torqueBase) / Math.max(1, k.torquePerTier);
  return clamp01((tier - 1) / 4);
}

export class AudioSystem {
  readonly debug: AudioDebug;
  private ctx: AudioContext | null = null;
  private graph: MixGraph | null = null;
  // Per-frame inputs, reused (the loop allocates nothing).
  private readonly loops: LoopFrame = { squeal: 0, squealHz: 950, wind: 0, windHz: 400, road: 0, roadHz: 160 };
  private readonly gearIn: GearboxInput = { dt: 0, carSpeed: 0, driveSpeed: 0, throttle: 0, brake: 0, grounded: true, reversing: false };
  private readonly engineFrame: EngineFrame = { firingHz: 0, load: 0, rpmFrac: 0, level: 1 };
  private disposed = false;
  private readonly gearbox: Gearbox;
  private readonly impacts = new ImpactDetector();
  private readonly haptics = new Haptics();
  private preset: EnginePreset;
  private carId: string;
  private tier01 = 0.5;
  private surfaceGrip = 1;
  private settings: GameSettings;
  private menuOpen: boolean;
  private hidden: boolean;
  private raf = 0;
  private lastFrameAt = 0;
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  private gestureListening = false;
  private lastPopAt = 0;
  private lastBlowOffAt = 0;
  private lastStepCount = -1;
  private readonly cleanups: (() => void)[] = [];

  constructor() {
    const sel = selectionState();
    this.settings = sel.settings;
    this.menuOpen = sel.menuOpen;
    this.hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    this.carId = resolveCarId(sel.carId);
    this.preset = getEnginePreset(this.carId);
    this.gearbox = new Gearbox(this.preset);

    const system = this;
    this.debug = {
      state: 'locked',
      unlocked: false,
      muted: false,
      sound: this.settings.sound,
      volume: this.settings.volume,
      master: 0,
      duck: 1,
      menuOpen: this.menuOpen,
      hidden: this.hidden,
      preset: this.preset.id,
      carId: this.carId,
      engine: { rpm: 0, gear: 1, freq: 0, load: 0, limiter: false, shifting: false, redline: 0, gears: 0, topKmh: 0, shifts: 0 },
      squeal: 0,
      wind: 0,
      road: 0,
      impacts: { landings: 0, hits: 0, lastKind: null, lastIntensity: 0 },
      sfx: { countdown: 0, go: 0, checkpoint: 0, finish: 0, fall: 0, respawn: 0, impact: 0, pop: 0, blowoff: 0 },
      haptics: this.haptics.stats,
      frames: 0,
      nodes: 0,
      get masterValue() {
        return system.graph ? system.graph.master.gain.value : 0;
      },
      get duckValue() {
        return system.graph ? system.graph.duck.gain.value : 1;
      },
      get time() {
        return system.ctx ? system.ctx.currentTime : 0;
      },
    };

    this.refreshCar();
    this.surfaceGrip = gameState().trackLayout?.surfaceGrip ?? 1;
    this.applyMix();

    this.listenForGesture();
    const onVisibility = () => this.onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    this.cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    });

    this.cleanups.push(
      useSelection.subscribe((s, prev) => {
        if (s.settings !== prev.settings) this.onSettings(s.settings);
        if (s.menuOpen !== prev.menuOpen) this.onMenu(s.menuOpen);
        if (s.carId !== prev.carId) this.refreshCar();
      }),
      useGameStore.subscribe((s, prev) => {
        if (s.physics !== prev.physics || s.carId !== prev.carId) this.refreshCar();
        if (s.trackLayout !== prev.trackLayout) this.surfaceGrip = s.trackLayout?.surfaceGrip ?? 1;
      }),
      onGameEvent('countdown', (e) => this.onCountdown(e)),
      onGameEvent('checkpoint', (e) => this.onCheckpoint(e)),
      onGameEvent('finish', (e) => this.onFinish(e)),
      onGameEvent('respawn', (e) => this.onRespawn(e)),
      onGameEvent('restart', () => this.onReset()),
      onGameEvent('teleported', () => this.impacts.reset()),
      installAudioDebug(this.debug),
    );

    this.raf = requestAnimationFrame(this.frame);
  }

  // ───────────────────────── lifecycle ─────────────────────────

  private readonly onGesture = (): void => {
    if (this.disposed) return;
    // Chrome only lets a context start from an activating gesture; a touch pointerdown isn't one
    // (its pointerup / touchend is). Wait for one so the console stays free of autoplay warnings.
    const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
    if (activation && !activation.isActive) return;
    if (!this.ctx) this.createContext();
    this.syncRunning();
  };

  private listenForGesture(): void {
    if (this.gestureListening) return;
    this.gestureListening = true;
    for (const type of GESTURE_EVENTS) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  private stopListeningForGesture(): void {
    if (!this.gestureListening) return;
    this.gestureListening = false;
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, this.onGesture, { capture: true });
  }

  private createContext(): void {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.debug.state = 'unsupported';
      this.stopListeningForGesture();
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
    } catch {
      this.debug.state = 'unsupported';
      this.stopListeningForGesture();
      return;
    }
    this.ctx = ctx;
    ctx.onstatechange = () => {
      if (this.ctx !== ctx) return;
      this.debug.state = ctx.state as AudioDebug['state'];
      if (ctx.state === 'running') {
        this.debug.unlocked = true;
        this.stopListeningForGesture();
      } else if (!this.disposed && ctx.state !== 'closed') {
        // Suspended / interrupted by the system (call, other app): the next tap resumes.
        this.listenForGesture();
      }
    };
    this.debug.state = ctx.state as AudioDebug['state'];
    this.graph = createMixGraph(ctx, this.preset, this.tier01);
    this.debug.nodes = this.graph.nodeCount;
    this.applyMix(true);
  }

  /** Run the context when the sound is on and the tab visible; otherwise suspend (after a grace period when muted). */
  private syncRunning(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    const audible = this.settings.sound && this.settings.volume > 0;
    if (this.hidden) {
      this.clearMuteTimer();
      if (ctx.state === 'running') void ctx.suspend().catch(() => {});
      return;
    }
    if (audible) {
      this.clearMuteTimer();
      if (ctx.state !== 'running') void ctx.resume().catch(() => {});
      return;
    }
    // Muted: let the master gain fade out, then suspend to save battery.
    if (ctx.state === 'running' && this.muteTimer === null) {
      this.muteTimer = setTimeout(() => {
        this.muteTimer = null;
        const c = this.ctx;
        if (c && c.state === 'running' && !(this.settings.sound && this.settings.volume > 0)) void c.suspend().catch(() => {});
      }, MUTE_SUSPEND_MS);
    }
  }

  private clearMuteTimer(): void {
    if (this.muteTimer !== null) {
      clearTimeout(this.muteTimer);
      this.muteTimer = null;
    }
  }

  private onVisibility(): void {
    const hidden = document.visibilityState === 'hidden';
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    this.debug.hidden = hidden;
    if (hidden) this.haptics.cancel();
    this.syncRunning();
  }

  private onSettings(settings: GameSettings): void {
    const hapticsOff = this.settings.haptics && !settings.haptics;
    this.settings = settings;
    if (hapticsOff) this.haptics.cancel();
    this.applyMix();
    this.syncRunning();
  }

  private onMenu(open: boolean): void {
    this.menuOpen = open;
    if (open) this.haptics.cancel();
    this.applyMix();
  }

  /** Master and duck targets from settings + menu. */
  private applyMix(jump = false): void {
    const s = this.settings;
    const audible = s.sound && s.volume > 0;
    const master = audible ? MASTER_LEVEL * s.volume * s.volume : 0;
    const duck = this.menuOpen ? MENU_DUCK : 1;
    const d = this.debug;
    d.sound = s.sound;
    d.volume = s.volume;
    d.muted = !audible;
    d.master = master;
    d.duck = duck;
    d.menuOpen = this.menuOpen;
    const g = this.graph;
    if (!g) return;
    const t = g.ctx.currentTime;
    if (jump) {
      g.p.master.jump(0, t);
      g.p.master.set(master, t);
      g.p.duck.jump(duck, t);
    } else {
      g.p.master.set(master, t);
      g.p.duck.set(duck, t);
    }
  }

  /** Car class or physics changed: engine preset, tier and gearing. */
  private refreshCar(): void {
    const state = gameState();
    const carId = resolveCarId(selectionState().carId);
    const preset = getEnginePreset(carId);
    const physicsCar = isCarClassId(state.carId) ? state.carId : carId;
    const topKmh = estimateTopSpeedKmh(state.physics, physicsCar);
    this.tier01 = engineTier01(state.physics, physicsCar);
    if (preset !== this.preset || carId !== this.carId) this.impacts.reset();
    this.carId = carId;
    this.preset = preset;
    this.gearbox.configure(preset, (Number.isFinite(topKmh) ? topKmh : 250) / 3.6);
    this.graph?.engine.setPreset(preset, this.tier01);
    const d = this.debug;
    d.preset = preset.id;
    d.carId = carId;
    d.engine.redline = preset.redlineRpm;
    d.engine.gears = this.gearbox.gearCount;
    d.engine.topKmh = Math.round(this.gearbox.topSpeed * 3.6 * 10) / 10;
  }

  // ───────────────────────── per frame ─────────────────────────

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = now - this.lastFrameAt;
    if (elapsed < MIN_FRAME_MS) return;
    this.lastFrameAt = now;
    this.tick(Math.min(0.1, elapsed / 1000));
  };

  private tick(realDt: number): void {
    const rt = carRuntime;
    const paused = this.menuOpen;
    const d = this.debug;
    d.frames += 1;
    // The engine follows the simulation's clock (physics steps since the last frame), so the
    // gearbox keeps pace with the car even when the sim runs ahead of or behind real time (slow
    // frames, scripted advance). Paused or before the car exists: real time, engine idling.
    const steps = this.lastStepCount < 0 ? 0 : rt.stepCount - this.lastStepCount;
    this.lastStepCount = rt.stepCount;
    const dt = paused || !rt.ready || steps < 0 ? realDt : Math.min(0.25, steps * PHYSICS_DT);

    // Driven-wheel surface speed: follows wheelspin, and free spin in the air.
    let driveSpeed = 0;
    let drivenGrounded = false;
    if (rt.ready && !paused) {
      const specWheels = rt.spec.wheels;
      for (let i = 0; i < rt.wheels.length; i++) {
        const spec = specWheels[i];
        if (!spec || !spec.driven) continue;
        const w = rt.wheels[i]!;
        const s = Math.abs(w.spinRate) * spec.radius;
        if (s > driveSpeed) driveSpeed = s;
        if (w.inContact) drivenGrounded = true;
      }
    }
    const throttle = paused || !rt.ready ? 0 : rt.throttle;
    const gb = this.gearbox;
    const gin = this.gearIn;
    gin.dt = dt;
    gin.carSpeed = rt.ready && !paused ? Math.abs(rt.forwardSpeed) : 0;
    gin.driveSpeed = driveSpeed;
    gin.throttle = throttle;
    gin.brake = paused ? 0 : rt.brake;
    gin.grounded = drivenGrounded || !rt.ready;
    gin.reversing = !paused && rt.reversing;
    const gearEvents = gb.update(gin);

    const e = d.engine;
    e.rpm = Math.round(gb.rpm);
    e.gear = gb.gear;
    e.freq = Math.round(gb.firingHz * 10) / 10;
    e.load = Math.round(gb.load * 1000) / 1000;
    e.limiter = gb.limiter;
    e.shifting = gb.shifting;
    e.shifts = gb.shifts;
    const r = engineReadout;
    r.gear = gb.gear;
    r.gears = gb.gearCount;
    r.rpm = gb.rpm;
    r.rpmFrac = gb.rpmFrac;
    r.redline = this.preset.redlineRpm;
    r.limiter = gb.limiter;
    r.shifting = gb.shifting;
    r.shifts = gb.shifts;

    // Tyres, wind, road.
    let slip = 0;
    let slipSpeed = 0;
    let grounded = 0;
    if (rt.ready && !paused) {
      for (let i = 0; i < rt.wheels.length; i++) {
        const w = rt.wheels[i]!;
        if (!w.inContact) continue;
        grounded++;
        const weighted = w.slip01 * (i >= 2 ? 1 : 0.85);
        if (weighted > slip) slip = weighted;
        const ss = Math.hypot(w.lateralSlip, w.longitudinalSlip);
        if (ss > slipSpeed) slipSpeed = ss;
      }
    }
    const speed = rt.ready && !paused ? rt.velocity.length() : 0;
    const grip = this.surfaceGrip;
    const surface = grip >= 1 ? 1 : Math.max(0.25, (grip - 0.3) / 0.7);
    const squeal = smoothstep(0.15, 0.85, slip) * smoothstep(0.6, 4, Math.max(speed, slipSpeed * 0.5)) * surface;
    const windN = Math.min(1.3, speed / WIND_FULL_MS);
    const wind = Math.min(1, windN * windN * (grounded === 0 && rt.ready && !paused ? 1.25 : 1));
    const road = grounded > 0 ? smoothstep(0.5, 45, speed) * (0.4 + 0.15 * grounded) : 0;
    d.squeal = Math.round(squeal * 1000) / 1000;
    d.wind = Math.round(wind * 1000) / 1000;
    d.road = Math.round(road * 1000) / 1000;

    // Impacts (haptics work even before the audio is unlocked).
    if (!paused) {
      const impact = this.impacts.update(rt);
      if (impact !== 0) this.onImpact(impact);
    }

    const g = this.graph;
    if (!g || g.ctx.state !== 'running') return;
    const t = g.ctx.currentTime;
    const ef = this.engineFrame;
    ef.firingHz = gb.firingHz;
    ef.load = gb.load;
    ef.rpmFrac = gb.rpmFrac;
    ef.level = paused ? PAUSED_ENGINE_LEVEL : 1;
    g.engine.update(ef, t);
    const loops = this.loops;
    loops.squeal = squeal;
    loops.squealHz = (820 + 380 * slip + Math.min(speed, 60) * 3 - 90 * rt.handbrake) * (grip >= 1 ? 1 : 0.85);
    loops.wind = wind;
    loops.windHz = 300 + 1600 * Math.min(1, windN);
    loops.road = road;
    loops.roadHz = 110 + 220 * Math.min(1, speed / 60);
    updateLoops(g, loops, t);

    if (gearEvents !== 0 && this.audible()) this.onGearEvents(gearEvents, g.sfx);
  }

  private audible(): boolean {
    return !!this.graph && this.graph.ctx.state === 'running' && this.settings.sound && this.settings.volume > 0;
  }

  private onGearEvents(events: number, out: SfxOut): void {
    const p = this.preset;
    const now = performance.now();
    if (events & GEAR_EVENT_LIFTOFF) {
      if (p.crackle > 0 && now - this.lastPopAt > 700) {
        this.lastPopAt = now;
        const n = Math.round(p.crackle * (1 + Math.random() * 3));
        for (let i = 0; i < n; i++) backfirePop(out, 0.35 + 0.55 * Math.random() * p.crackle, 0.04 + i * (0.07 + Math.random() * 0.12));
        this.debug.sfx.pop += n;
      }
      if (p.blowOff > 0 && now - this.lastBlowOffAt > 500) {
        this.lastBlowOffAt = now;
        blowOff(out, p.blowOff * (0.5 + 0.5 * this.tier01));
        this.debug.sfx.blowoff += 1;
      }
    }
    if (events & GEAR_EVENT_UPSHIFT && this.gearbox.rpmFrac > 0.75) {
      if (p.blowOff > 0 && now - this.lastBlowOffAt > 400) {
        this.lastBlowOffAt = now;
        blowOff(out, 0.6 * p.blowOff);
        this.debug.sfx.blowoff += 1;
      } else if (p.crackle > 0 && Math.random() < p.crackle * 0.5 && now - this.lastPopAt > 400) {
        this.lastPopAt = now;
        backfirePop(out, 0.5 * p.crackle, 0.02);
        this.debug.sfx.pop += 1;
      }
    }
  }

  private onImpact(kind: number): void {
    const det = this.impacts;
    const d = this.debug.impacts;
    d.landings = det.landings;
    d.hits = det.hits;
    d.lastKind = kind === IMPACT_LAND ? 'land' : 'hit';
    d.lastIntensity = Math.round(det.intensity * 1000) / 1000;
    if (kind === IMPACT_HIT || det.intensity > 0.12) this.haptics.buzz(kind === IMPACT_HIT ? 'hit' : 'land', det.intensity);
    if (this.audible()) {
      impactThud(this.graph!.sfx, kind === IMPACT_HIT ? 0.25 + 0.75 * det.intensity : det.intensity, kind === IMPACT_HIT);
      this.debug.sfx.impact += 1;
    }
  }

  // ───────────────────────── game events ─────────────────────────

  private onCountdown({ step }: GameEventMap['countdown']): void {
    if (step === 3) this.onReset();
    this.haptics.buzz(step === 0 ? 'go' : 'tick');
    if (!this.audible()) return;
    countdownBeep(this.graph!.sfx, step);
    if (step === 0) this.debug.sfx.go += 1;
    else this.debug.sfx.countdown += 1;
  }

  private onCheckpoint({ index }: GameEventMap['checkpoint']): void {
    // The finish has its own fanfare.
    if (index >= gameState().run.totalCheckpoints) return;
    this.haptics.buzz('checkpoint');
    if (!this.audible()) return;
    checkpointChime(this.graph!.sfx);
    this.debug.sfx.checkpoint += 1;
  }

  private onFinish({ isBest }: GameEventMap['finish']): void {
    this.haptics.buzz(isBest ? 'best' : 'finish');
    if (!this.audible()) return;
    finishFanfare(this.graph!.sfx, isBest);
    this.debug.sfx.finish += 1;
  }

  private onRespawn({ reason }: GameEventMap['respawn']): void {
    this.impacts.reset();
    this.gearbox.reset();
    if (reason === 'fall') this.haptics.buzz('fall');
    if (!this.audible()) return;
    if (reason === 'fall') {
      fallWhoosh(this.graph!.sfx);
      this.debug.sfx.fall += 1;
      respawnBlip(this.graph!.sfx, 0.4);
    } else {
      respawnBlip(this.graph!.sfx);
    }
    this.debug.sfx.respawn += 1;
  }

  private onReset(): void {
    this.impacts.reset();
    this.gearbox.reset();
  }

  // ───────────────────────── teardown ─────────────────────────

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.stopListeningForGesture();
    this.clearMuteTimer();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    const g = this.graph;
    this.graph = null;
    if (g) disposeMixGraph(g);
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      ctx.onstatechange = null;
      if (ctx.state !== 'closed') void ctx.close().catch(() => {});
    }
    this.debug.state = 'closed';
  }
}
