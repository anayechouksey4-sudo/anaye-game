/**
 * Small WebAudio helpers shared by the voices: a smoothed AudioParam writer that skips
 * negligible changes (the audio loop calls it ~60×/s per param; skipping keeps the automation
 * timeline short), a shared white-noise buffer and a soft-clip curve.
 */

export class SmoothParam {
  readonly param: AudioParam;
  /** setTargetAtTime time constant, s. */
  private readonly timeConstant: number;
  /** Relative change below which an update is skipped. */
  private readonly epsilon: number;
  private last = Number.NaN;

  constructor(param: AudioParam, timeConstant: number, epsilon = 0.004) {
    this.param = param;
    this.timeConstant = timeConstant;
    this.epsilon = epsilon;
  }

  /** Glide toward `value` starting at context time `t`. */
  set(value: number, t: number): void {
    const last = this.last;
    if (last === value) return;
    if (last === last && Math.abs(value - last) <= this.epsilon * Math.max(Math.abs(value), Math.abs(last), 1e-3)) return;
    this.last = value;
    this.param.setTargetAtTime(value, t, this.timeConstant);
  }

  /** Jump without gliding (preset switch, reset). */
  jump(value: number, t: number): void {
    this.last = value;
    this.param.cancelScheduledValues(t);
    this.param.setValueAtTime(value, t);
  }

  /** The value the param is gliding to (NaN before the first set). */
  get target(): number {
    return this.last;
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 2 s of white noise per context, built once (deterministic LCG so offline renders repeat). */
export function getNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (buffer) return buffer;
  const length = Math.max(1, Math.round(ctx.sampleRate * 2));
  buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2f6b9d1;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0xffffffff) * 2 - 1;
  }
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/**
 * tanh soft clip with a touch of asymmetry (even harmonics). `hardness` 0…1. Normalised so ±1 in
 * gives about ±1 out.
 */
export function makeDriveCurve(hardness: number, size = 1024): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(size * 4));
  const k = 1 + Math.max(0, Math.min(1, hardness)) * 7;
  const asym = 0.12 * hardness;
  const norm = Math.tanh(k * (1 + asym));
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * (x + asym * x * x)) / norm;
  }
  return curve;
}
