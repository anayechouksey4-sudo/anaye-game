/**
 * Synthesized engine: three oscillators locked to the firing frequency (main, detuned partner,
 * sub) → drive gain → soft-clip waveshaper → resonant low-pass whose cutoff tracks the harmonics
 * the load "opens up" → an amplitude lump at a fraction of the firing rate (uneven-firing burble),
 * plus band-passed noise for intake / mechanical grit and an optional turbo whistle.
 *
 * Works on any BaseAudioContext (the live context, or an OfflineAudioContext in tests). The noise
 * input is shared with the rest of the mix: pass the looping noise source node.
 *
 *   osc×3 → gain×3 ─┐
 *                   pre → shaper → lowpass ─┐
 *        noise → bandpass → grit ───────────┤→ lump (AM ← lfo·depth) → out
 *                       whistle osc → gain ─┘
 */
import { makeDriveCurve, SmoothParam } from './params';
import type { EnginePreset } from './presets';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Lowest low-pass cutoff, Hz: phone speakers reproduce little below ~300 Hz, so idle keeps some upper harmonics. */
const MIN_CUTOFF_HZ = 420;
const MAX_CUTOFF_HZ = 9000;

export interface EngineFrame {
  /** Firing frequency, Hz. */
  firingHz: number;
  /** 0…1 */
  load: number;
  /** rpm / redline. */
  rpmFrac: number;
  /** Extra level multiplier (fades the engine while paused / muted), 0…1. */
  level: number;
}

export class EngineVoice {
  /** Persistent nodes per voice (3 osc + 3 gain, pre, shaper, filter, lump, lfo, depth, grit bp + gain, whistle osc + gain, out). */
  static readonly NODE_COUNT = 17;
  readonly output: GainNode;
  private readonly ctx: BaseAudioContext;
  private preset: EnginePreset;
  /** Engine Tier as 0…1 (tier 1 → 0, tier 5 → 1): more grit and bite at higher tiers. */
  private tier01 = 0.5;

  private readonly oscs: OscillatorNode[] = [];
  private readonly oscGains: GainNode[] = [];
  private readonly oscFreq: SmoothParam[] = [];
  private readonly pre: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly filter: BiquadFilterNode;
  private readonly lump: GainNode;
  private readonly lfo: OscillatorNode;
  private readonly lfoDepth: GainNode;
  private readonly gritFilter: BiquadFilterNode;
  private readonly grit: GainNode;
  private readonly whistle: OscillatorNode;
  private readonly whistleGain: GainNode;

  private readonly preP: SmoothParam;
  private readonly cutoffP: SmoothParam;
  private readonly lfoFreqP: SmoothParam;
  private readonly gritFreqP: SmoothParam;
  private readonly gritGainP: SmoothParam;
  private readonly whistleFreqP: SmoothParam;
  private readonly whistleGainP: SmoothParam;
  private readonly outP: SmoothParam;
  private started = false;

  constructor(ctx: BaseAudioContext, noise: AudioNode, preset: EnginePreset) {
    this.ctx = ctx;
    this.preset = preset;
    this.output = ctx.createGain();
    this.output.gain.value = 0;

    this.pre = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.lump = ctx.createGain();
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoDepth = ctx.createGain();
    this.gritFilter = ctx.createBiquadFilter();
    this.gritFilter.type = 'bandpass';
    this.gritFilter.Q.value = 1.4;
    this.grit = ctx.createGain();
    this.grit.gain.value = 0;
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;

    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.connect(g).connect(this.pre);
      this.oscs.push(osc);
      this.oscGains.push(g);
      this.oscFreq.push(new SmoothParam(osc.frequency, 0.018, 0.001));
    }
    this.pre.connect(this.shaper).connect(this.filter).connect(this.lump).connect(this.output);
    noise.connect(this.gritFilter).connect(this.grit).connect(this.lump);
    this.whistle.connect(this.whistleGain).connect(this.lump);
    this.lfo.connect(this.lfoDepth).connect(this.lump.gain);

    this.preP = new SmoothParam(this.pre.gain, 0.03);
    this.cutoffP = new SmoothParam(this.filter.frequency, 0.03);
    this.lfoFreqP = new SmoothParam(this.lfo.frequency, 0.02, 0.002);
    this.gritFreqP = new SmoothParam(this.gritFilter.frequency, 0.03);
    this.gritGainP = new SmoothParam(this.grit.gain, 0.04);
    this.whistleFreqP = new SmoothParam(this.whistle.frequency, 0.05);
    this.whistleGainP = new SmoothParam(this.whistleGain.gain, 0.06);
    this.outP = new SmoothParam(this.output.gain, 0.035);

    this.applyPreset();
  }

  start(when = this.ctx.currentTime): void {
    if (this.started) return;
    this.started = true;
    for (const osc of this.oscs) osc.start(when);
    this.lfo.start(when);
    this.whistle.start(when);
  }

  /** Switch car / tier. Changes timbre in place (no graph rebuild). */
  setPreset(preset: EnginePreset, tier01: number): void {
    const tier = clamp(tier01, 0, 1);
    if (preset === this.preset && Math.abs(tier - this.tier01) < 1e-3) return;
    const changed = preset !== this.preset;
    this.preset = preset;
    this.tier01 = tier;
    if (changed) this.applyPreset();
  }

  get presetId(): string {
    return this.preset.id;
  }

  private applyPreset(): void {
    const p = this.preset;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const spec = p.osc[i]!;
      const osc = this.oscs[i]!;
      osc.type = spec.type;
      osc.detune.setValueAtTime(spec.detune, t);
      this.oscGains[i]!.gain.setValueAtTime(spec.gain, t);
    }
    this.shaper.curve = makeDriveCurve(p.drive);
    this.filter.Q.setValueAtTime(p.filterQ, t);
    this.lump.gain.setValueAtTime(1 - p.lumpDepth * 0.5, t);
    this.lfoDepth.gain.setValueAtTime(p.lumpDepth * 0.5, t);
  }

  /** Per audio frame (~30–60 Hz). Allocation-free. */
  update(frame: EngineFrame, t: number): void {
    const p = this.preset;
    const f0 = clamp(frame.firingHz, 8, 2000);
    const load = clamp(frame.load, 0, 1);
    const rev = clamp(frame.rpmFrac, 0, 1.2);
    const tier = this.tier01;

    for (let i = 0; i < 3; i++) this.oscFreq[i]!.set(f0 * p.osc[i]!.ratio, t);
    this.lfoFreqP.set(f0 * p.lumpRatio, t);

    // More drive under load (harder into the shaper = more harmonics), a little more at high tiers.
    this.preP.set(lerp(0.45, 1.5 + 0.4 * tier, load) * (0.85 + 0.25 * rev), t);
    const brightness = clamp(0.12 + 0.58 * load + 0.3 * rev + 0.08 * tier, 0, 1);
    this.cutoffP.set(clamp(f0 * lerp(p.harmonicsMin, p.harmonicsMax, brightness), MIN_CUTOFF_HZ, MAX_CUTOFF_HZ), t);

    this.gritFreqP.set(clamp(f0 * p.gritRatio, 200, 7000), t);
    this.gritGainP.set(p.grit * (0.25 + 0.75 * load) * (0.5 + 0.5 * rev) * (0.7 + 0.6 * tier) * 0.22, t);

    if (p.whistle > 0) {
      const spool = load * rev * rev;
      this.whistleFreqP.set(clamp(f0 * p.whistleRatio * (0.6 + 0.4 * spool), 300, 9500), t);
      this.whistleGainP.set(p.whistle * spool * (0.5 + 0.5 * tier) * 0.035, t);
    } else {
      this.whistleGainP.set(0, t);
    }

    const level = p.level * (0.34 + 0.66 * load) * (0.72 + 0.28 * Math.min(rev, 1)) * (0.9 + 0.2 * tier);
    this.outP.set(level * clamp(frame.level, 0, 1), t);
  }

  /** Stop and disconnect everything (the context may be closed right after). */
  dispose(): void {
    const stop = (n: OscillatorNode) => {
      try {
        if (this.started) n.stop();
      } catch {
        // already stopped
      }
      n.disconnect();
    };
    for (const osc of this.oscs) stop(osc);
    stop(this.lfo);
    stop(this.whistle);
    for (const g of this.oscGains) g.disconnect();
    this.pre.disconnect();
    this.shaper.disconnect();
    this.filter.disconnect();
    this.gritFilter.disconnect();
    this.grit.disconnect();
    this.whistleGain.disconnect();
    this.lfoDepth.disconnect();
    this.lump.disconnect();
    this.output.disconnect();
  }
}
