/**
 * One-shot synthesized effects: start lights, checkpoint chime, finish fanfare, fall whoosh,
 * respawn blip, impact thuds, backfire pops and turbo blow-off. Each call builds a couple of
 * short-lived nodes that disconnect themselves when they finish (events are rare, so these small
 * allocations never touch the per-frame path).
 */
import { getNoiseBuffer } from './params';

export interface SfxOut {
  ctx: BaseAudioContext;
  dest: AudioNode;
}

interface ToneSpec {
  type: OscillatorType;
  /** Start / end frequency, Hz (exponential glide when they differ). */
  f0: number;
  f1?: number;
  /** Start time (context seconds). */
  t: number;
  dur: number;
  gain: number;
  attack?: number;
  detune?: number;
}

interface NoiseSpec {
  t: number;
  dur: number;
  gain: number;
  filter: BiquadFilterType;
  f0: number;
  f1?: number;
  q?: number;
  attack?: number;
}

const SILENT = 0.0001;

function envelope(param: AudioParam, t: number, attack: number, peak: number, dur: number): void {
  param.setValueAtTime(SILENT, t);
  param.linearRampToValueAtTime(Math.max(SILENT, peak), t + attack);
  param.exponentialRampToValueAtTime(SILENT, t + Math.max(attack + 0.01, dur));
}

export function playTone(out: SfxOut, spec: ToneSpec): void {
  const { ctx } = out;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.f0, spec.t);
  if (spec.f1 !== undefined && spec.f1 !== spec.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.f1), spec.t + spec.dur);
  if (spec.detune) osc.detune.value = spec.detune;
  envelope(g.gain, spec.t, spec.attack ?? 0.005, spec.gain, spec.dur);
  osc.connect(g).connect(out.dest);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
  osc.start(spec.t);
  osc.stop(spec.t + spec.dur + 0.05);
}

export function playNoise(out: SfxOut, spec: NoiseSpec): void {
  const { ctx } = out;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = spec.filter;
  filter.frequency.setValueAtTime(spec.f0, spec.t);
  if (spec.f1 !== undefined && spec.f1 !== spec.f0) filter.frequency.exponentialRampToValueAtTime(Math.max(20, spec.f1), spec.t + spec.dur);
  filter.Q.value = spec.q ?? 1;
  const g = ctx.createGain();
  envelope(g.gain, spec.t, spec.attack ?? 0.004, spec.gain, spec.dur);
  src.connect(filter).connect(g).connect(out.dest);
  src.onended = () => {
    src.disconnect();
    filter.disconnect();
    g.disconnect();
  };
  // Random offset so back-to-back bursts don't sound identical.
  src.start(spec.t, Math.random() * 1.5);
  src.stop(spec.t + spec.dur + 0.05);
}

/** Start lights: 3 · 2 · 1 short beeps, GO an octave up and longer. */
export function countdownBeep(out: SfxOut, step: number): void {
  const t = out.ctx.currentTime + 0.005;
  if (step > 0) {
    playTone(out, { type: 'square', f0: 880, t, dur: 0.17, gain: 0.16 });
    playTone(out, { type: 'sine', f0: 1760, t, dur: 0.12, gain: 0.06 });
  } else {
    playTone(out, { type: 'square', f0: 1760, t, dur: 0.55, gain: 0.15 });
    playTone(out, { type: 'sine', f0: 880, t, dur: 0.45, gain: 0.12 });
    playTone(out, { type: 'triangle', f0: 2637, t: t + 0.02, dur: 0.35, gain: 0.05 });
  }
}

/** Two bell strikes (E6 → B6) with a quiet inharmonic partial each. */
export function checkpointChime(out: SfxOut): void {
  const t = out.ctx.currentTime + 0.005;
  const notes = [1318.5, 1975.5];
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i]!;
    const ti = t + i * 0.085;
    playTone(out, { type: 'sine', f0: f, t: ti, dur: 0.6, gain: 0.2, attack: 0.003 });
    playTone(out, { type: 'sine', f0: f * 2.76, t: ti, dur: 0.25, gain: 0.04, attack: 0.002 });
    playTone(out, { type: 'triangle', f0: f / 2, t: ti, dur: 0.3, gain: 0.05 });
  }
}

/** Rising arpeggio into a major chord; a personal best adds a sparkle run on top. */
export function finishFanfare(out: SfxOut, isBest: boolean): void {
  const t = out.ctx.currentTime + 0.01;
  const arp = [523.25, 659.25, 783.99, 1046.5];
  for (let i = 0; i < arp.length; i++) {
    playTone(out, { type: 'square', f0: arp[i]!, t: t + i * 0.1, dur: 0.16, gain: 0.09 });
    playTone(out, { type: 'triangle', f0: arp[i]! * 2, t: t + i * 0.1, dur: 0.16, gain: 0.05 });
  }
  const chordT = t + arp.length * 0.1;
  for (const f of [1046.5, 1318.5, 1568]) {
    playTone(out, { type: 'sawtooth', f0: f, t: chordT, dur: 1.1, gain: 0.045, attack: 0.02, detune: 6 });
    playTone(out, { type: 'triangle', f0: f, t: chordT, dur: 1.2, gain: 0.07, attack: 0.01, detune: -6 });
  }
  playTone(out, { type: 'sine', f0: 261.6, t: chordT, dur: 1.2, gain: 0.12, attack: 0.01 });
  if (isBest) {
    const sparkle = [2093, 2637, 3136, 4186, 3136, 4186];
    for (let i = 0; i < sparkle.length; i++) {
      playTone(out, { type: 'sine', f0: sparkle[i]!, t: chordT + 0.15 + i * 0.07, dur: 0.22, gain: 0.05, attack: 0.002 });
    }
  }
}

/** Falling into the void: a downward noise sweep with a sinking tone. */
export function fallWhoosh(out: SfxOut): void {
  const t = out.ctx.currentTime + 0.005;
  playNoise(out, { t, dur: 0.75, gain: 0.32, filter: 'bandpass', f0: 2400, f1: 180, q: 1.8, attack: 0.12 });
  playTone(out, { type: 'triangle', f0: 700, f1: 70, t, dur: 0.7, gain: 0.08, attack: 0.05 });
}

/** Car reappears: two quick rising blips. */
export function respawnBlip(out: SfxOut, delay = 0): void {
  const t = out.ctx.currentTime + 0.005 + delay;
  playTone(out, { type: 'sine', f0: 440, f1: 1320, t, dur: 0.11, gain: 0.16 });
  playTone(out, { type: 'sine', f0: 1320, f1: 1760, t: t + 0.1, dur: 0.12, gain: 0.12 });
}

/**
 * Hard landing / hit. `intensity` 0…1. Landings are a low body thump plus a burst of suspension
 * and tyre noise; `metallic` adds a short clank for side hits (walls, pendulums, shutters).
 */
export function impactThud(out: SfxOut, intensity: number, metallic: boolean): void {
  const k = Math.max(0, Math.min(1, intensity));
  const t = out.ctx.currentTime + 0.002;
  playTone(out, { type: 'sine', f0: 140, f1: 42, t, dur: 0.18 + 0.25 * k, gain: 0.25 + 0.45 * k, attack: 0.003 });
  // Phone speakers can't play the sub thump: the mid "body" and noise carry the hit there.
  playNoise(out, { t, dur: 0.1 + 0.18 * k, gain: 0.18 + 0.4 * k, filter: 'lowpass', f0: 900 + 1400 * k, f1: 160, q: 0.8 });
  playTone(out, { type: 'triangle', f0: 260, f1: 120, t, dur: 0.1 + 0.08 * k, gain: 0.1 + 0.2 * k });
  if (metallic) {
    playNoise(out, { t, dur: 0.09 + 0.1 * k, gain: 0.12 + 0.25 * k, filter: 'bandpass', f0: 2600, f1: 1800, q: 5 });
    playTone(out, { type: 'triangle', f0: 420, t, dur: 0.2 + 0.15 * k, gain: 0.06 + 0.1 * k });
    playTone(out, { type: 'sine', f0: 1130, t, dur: 0.15 + 0.1 * k, gain: 0.04 + 0.06 * k });
  }
}

/** One exhaust pop (overrun crackle / backfire), `delay` s from now. */
export function backfirePop(out: SfxOut, intensity: number, delay: number): void {
  const k = Math.max(0, Math.min(1, intensity));
  const t = out.ctx.currentTime + 0.003 + delay;
  playNoise(out, { t, dur: 0.05 + 0.05 * k, gain: 0.25 + 0.35 * k, filter: 'bandpass', f0: 500 + Math.random() * 500, q: 1.2, attack: 0.001 });
  playTone(out, { type: 'sine', f0: 180, f1: 60, t, dur: 0.07, gain: 0.15 + 0.2 * k, attack: 0.001 });
}

/** Turbo blow-off valve "pssh". */
export function blowOff(out: SfxOut, intensity: number): void {
  const k = Math.max(0, Math.min(1, intensity));
  const t = out.ctx.currentTime + 0.004;
  playNoise(out, { t, dur: 0.28 + 0.15 * k, gain: 0.08 + 0.12 * k, filter: 'highpass', f0: 3500, f1: 1800, q: 0.9, attack: 0.01 });
  playNoise(out, { t, dur: 0.18, gain: 0.04 + 0.05 * k, filter: 'bandpass', f0: 5200, f1: 2600, q: 3, attack: 0.005 });
}
