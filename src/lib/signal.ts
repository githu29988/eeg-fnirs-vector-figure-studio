/**
 * Tiny zero-dependency DSP helpers used by chart-side
 * post-processing of loaded EDF channels.
 *
 * Goals: small, allocation-light, good enough for visualisation.
 * Not a substitute for MNE-Python — for publication-grade
 * filtering the user is expected to pre-process upstream.
 */

/** Decimate a signal by an integer factor with a simple anti-alias
 * boxcar (mean of `factor` samples). Cheap; aliasing is acceptable
 * for visualisation-only downsampling.
 */
export function decimate(
  samples: Float32Array,
  factor: number,
): Float32Array {
  if (factor <= 1) return samples;
  const outLen = Math.floor(samples.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j++) sum += samples[base + j];
    out[i] = sum / factor;
  }
  return out;
}

/** RBJ band-pass biquad (constant-skirt-gain peak ≈ Q). */
function biquadBandpass(fs: number, f0: number, Q: number) {
  const w0 = (2 * Math.PI * f0) / fs;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Q);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

/** Apply a single biquad filter in direct-form-I. Returns a new buffer. */
function biquadFilter(
  x: Float32Array,
  c: ReturnType<typeof biquadBandpass>,
): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0,
    x2 = 0,
    y1 = 0,
    y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}

/** Cascaded 2× RBJ band-pass (≈ 4th order). Forward-only — there is
 * a small phase delay (~1 sample at peak), acceptable for
 * envelope-style visualisation.
 */
export function bandpass(
  samples: Float32Array,
  fs: number,
  lo: number,
  hi: number,
): Float32Array {
  const f0 = (lo + hi) / 2;
  const bw = hi - lo;
  const Q = f0 / bw;
  const c = biquadBandpass(fs, f0, Q);
  const y1 = biquadFilter(samples, c);
  return biquadFilter(y1, c);
}

/** Centred sliding-window RMS envelope. `windowSec` is the boxcar
 * length. At the edges the window is clipped, so the envelope is
 * defined for every sample (no NaNs) but slightly noisier near the
 * boundaries. O(n) via a running sum-of-squares.
 */
export function rmsEnvelope(
  samples: Float32Array,
  fs: number,
  windowSec: number,
): Float32Array {
  const half = Math.max(0, Math.round((windowSec * fs) / 2));
  const out = new Float32Array(samples.length);
  if (samples.length === 0) return out;
  let sumSq = 0;
  let lo = 0;
  let hi = -1; // inclusive bounds of the running window
  for (let i = 0; i < samples.length; i++) {
    const newLo = Math.max(0, i - half);
    const newHi = Math.min(samples.length - 1, i + half);
    while (hi < newHi) {
      hi++;
      sumSq += samples[hi] * samples[hi];
    }
    while (lo < newLo) {
      sumSq -= samples[lo] * samples[lo];
      lo++;
    }
    const denom = newHi - newLo + 1;
    out[i] = Math.sqrt(Math.max(0, sumSq) / denom);
  }
  return out;
}

/** Resample a Float32Array to `targetLen` via linear interpolation.
 * Used to align a high-fs EEG envelope with a coarser fNIRS axis.
 */
export function resampleLinear(
  samples: Float32Array,
  targetLen: number,
): Float32Array {
  if (samples.length === targetLen) return samples;
  const out = new Float32Array(targetLen);
  if (targetLen === 0) return out;
  if (samples.length === 1) {
    out.fill(samples[0]);
    return out;
  }
  if (targetLen === 1) {
    // Single output sample: take the source midpoint.
    out[0] = samples[Math.floor((samples.length - 1) / 2)];
    return out;
  }
  const ratio = (samples.length - 1) / (targetLen - 1);
  for (let i = 0; i < targetLen; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const t = x - i0;
    out[i] = samples[i0] * (1 - t) + samples[i1] * t;
  }
  return out;
}
