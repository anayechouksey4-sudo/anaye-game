/**
 * The persistent node graph: one looping noise source feeding the engine grit, tyre squeal, wind
 * and road rumble; the engine voice; a bus for one-shots; then menu duck → master → highpass →
 * limiter → destination. Built on any BaseAudioContext, so tests can render the exact live mix
 * in an OfflineAudioContext.
 *
 *   noise ─┬─ grit ───────────────┐
 *          │       EngineVoice ───┤
 *          ├─ squeal bp×2 (+ tone) g ┤
 *          ├─ wind bp ────── g ───┼─ duck ─ master ─ highpass ─ limiter ─ destination
 *          └─ road lp ────── g ───┤
 *       one-shots ── sfx bus ─────┘
 */
import { EngineVoice } from './engineVoice';
import { getNoiseBuffer, SmoothParam } from './params';
import type { EnginePreset } from './presets';
import type { SfxOut } from './sfx';

/** Mix levels of the loops at full intensity (before duck / master). */
export const SQUEAL_MIX = 0.2;
export const WIND_MIX = 0.3;
export const ROAD_MIX = 0.22;

export interface LoopFrame {
  /** 0…1 each. */
  squeal: number;
  squealHz: number;
  wind: number;
  windHz: number;
  road: number;
  roadHz: number;
}

export interface MixGraph {
  ctx: BaseAudioContext;
  noise: AudioBufferSourceNode;
  engine: EngineVoice;
  sfx: SfxOut;
  duck: GainNode;
  master: GainNode;
  /** Persistent node count (for the debug handle). */
  nodeCount: number;
  p: {
    squealGain: SmoothParam;
    squealA: SmoothParam;
    squealB: SmoothParam;
    squealTone: SmoothParam;
    windGain: SmoothParam;
    windFreq: SmoothParam;
    roadGain: SmoothParam;
    roadFreq: SmoothParam;
    duck: SmoothParam;
    master: SmoothParam;
  };
  /** Everything except the engine voice, for teardown. */
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
}

export function createMixGraph(ctx: BaseAudioContext, preset: EnginePreset, tier01: number): MixGraph {
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  noise.loop = true;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 4;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 35;
  highpass.Q.value = 0.7;
  const master = ctx.createGain();
  master.gain.value = 0;
  const duck = ctx.createGain();
  duck.gain.value = 1;
  duck.connect(master).connect(highpass).connect(limiter).connect(ctx.destination);

  const engine = new EngineVoice(ctx, noise, preset);
  engine.setPreset(preset, tier01);
  engine.output.connect(duck);

  // Tyre squeal: two resonant bands of noise about half an octave apart, warbling together.
  const squealA = ctx.createBiquadFilter();
  squealA.type = 'bandpass';
  squealA.Q.value = 9;
  squealA.frequency.value = 950;
  const squealB = ctx.createBiquadFilter();
  squealB.type = 'bandpass';
  squealB.Q.value = 12;
  squealB.frequency.value = 1450;
  const squealGain = ctx.createGain();
  squealGain.gain.value = 0;
  noise.connect(squealA).connect(squealGain);
  noise.connect(squealB).connect(squealGain);
  squealGain.connect(duck);
  const squealLfo = ctx.createOscillator();
  squealLfo.frequency.value = 7.5;
  const squealLfoDepth = ctx.createGain();
  squealLfoDepth.gain.value = 70; // cents
  squealLfo.connect(squealLfoDepth);
  squealLfoDepth.connect(squealA.detune);
  squealLfoDepth.connect(squealB.detune);
  // A quiet tonal core under the noise bands: on a phone speaker it reads as a squeal, not a hiss.
  const squealTone = ctx.createOscillator();
  squealTone.type = 'triangle';
  squealTone.frequency.value = 950;
  const squealToneGain = ctx.createGain();
  squealToneGain.gain.value = 0.18;
  squealTone.connect(squealToneGain).connect(squealGain);
  squealLfoDepth.connect(squealTone.detune);

  const windFilter = ctx.createBiquadFilter();
  windFilter.type = 'bandpass';
  windFilter.Q.value = 0.6;
  windFilter.frequency.value = 400;
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  noise.connect(windFilter).connect(windGain).connect(duck);

  const roadFilter = ctx.createBiquadFilter();
  roadFilter.type = 'lowpass';
  roadFilter.Q.value = 0.9;
  roadFilter.frequency.value = 160;
  const roadGain = ctx.createGain();
  roadGain.gain.value = 0;
  noise.connect(roadFilter).connect(roadGain).connect(duck);

  const sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  sfxBus.connect(duck);

  const t = ctx.currentTime;
  noise.start(t);
  squealLfo.start(t);
  squealTone.start(t);
  engine.start(t);

  const nodes: AudioNode[] = [noise, squealA, squealB, squealGain, squealLfo, squealLfoDepth, squealTone, squealToneGain, windFilter, windGain, roadFilter, roadGain, sfxBus, duck, master, highpass, limiter];
  return {
    ctx,
    noise,
    engine,
    sfx: { ctx, dest: sfxBus },
    duck,
    master,
    nodeCount: nodes.length + EngineVoice.NODE_COUNT,
    p: {
      squealGain: new SmoothParam(squealGain.gain, 0.045),
      squealA: new SmoothParam(squealA.frequency, 0.08),
      squealB: new SmoothParam(squealB.frequency, 0.08),
      squealTone: new SmoothParam(squealTone.frequency, 0.08),
      windGain: new SmoothParam(windGain.gain, 0.12),
      windFreq: new SmoothParam(windFilter.frequency, 0.15),
      roadGain: new SmoothParam(roadGain.gain, 0.1),
      roadFreq: new SmoothParam(roadFilter.frequency, 0.15),
      duck: new SmoothParam(duck.gain, 0.08, 0),
      master: new SmoothParam(master.gain, 0.05, 0),
    },
    nodes,
    sources: [noise, squealLfo, squealTone],
  };
}

/** Per audio frame: loop levels and pitches. Allocation-free. */
export function updateLoops(g: MixGraph, f: LoopFrame, t: number): void {
  g.p.squealGain.set(f.squeal * SQUEAL_MIX, t);
  g.p.squealA.set(f.squealHz, t);
  g.p.squealB.set(f.squealHz * 1.52, t);
  g.p.squealTone.set(f.squealHz * 1.01, t);
  g.p.windGain.set(f.wind * WIND_MIX, t);
  g.p.windFreq.set(f.windHz, t);
  g.p.roadGain.set(f.road * ROAD_MIX, t);
  g.p.roadFreq.set(f.roadHz, t);
}

export function disposeMixGraph(g: MixGraph): void {
  g.engine.dispose();
  for (const src of g.sources) {
    try {
      src.stop();
    } catch {
      // not started
    }
  }
  for (const node of g.nodes) node.disconnect();
}
