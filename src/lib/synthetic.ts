/**
 * Reproducible synthetic-data generators shared across charts.
 *
 * Every chart in the studio ships with a deterministic generator
 * function so authors can demo, screenshot-test, and prototype
 * without real data. Each generator takes a `seed` (and optionally
 * size/noise parameters) and returns the same dataset on every call.
 */
import { mulberry32, randn, linspace } from './random';

// --- Binary-classification scores ----------------------------------------

export interface BinaryScores {
  /** 0/1 ground truth labels. */
  y: number[];
  /** Predicted positive-class probability in [0, 1]. */
  scores: number[];
}

export function generateBinaryScores(
  seed: number,
  n: number,
  positiveRate = 0.5,
  /** Higher = better separation between classes. */
  separation = 1.4,
): BinaryScores {
  const rng = mulberry32(seed);
  const y = new Array<number>(n);
  const scores = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const positive = rng() < positiveRate ? 1 : 0;
    y[i] = positive;
    const mean = positive ? separation : -separation;
    const z = randn(rng) + mean;
    scores[i] = 1 / (1 + Math.exp(-z));
  }
  return { y, scores };
}

// --- Time-series helpers -------------------------------------------------

export interface TimeSeries {
  t: number[];
  v: number[];
}

export function generateEegLikeSeries(
  seed: number,
  durationSeconds: number,
  fs: number,
  bandHz: [number, number] = [4, 30],
): TimeSeries {
  const rng = mulberry32(seed);
  const n = Math.max(2, Math.round(durationSeconds * fs));
  const t = linspace(0, durationSeconds, n);
  const components = 8;
  const phases = Array.from({ length: components }, () => rng() * 2 * Math.PI);
  const freqs = Array.from(
    { length: components },
    () => bandHz[0] + rng() * (bandHz[1] - bandHz[0]),
  );
  const amps = Array.from({ length: components }, () => 0.4 + rng() * 0.8);
  const v = t.map((tt) => {
    let s = 0;
    for (let i = 0; i < components; i++) {
      s += amps[i] * Math.sin(2 * Math.PI * freqs[i] * tt + phases[i]);
    }
    s += randn(rng) * 0.6;
    return s;
  });
  return { t, v };
}

export function generateHrfLikeSeries(
  seed: number,
  durationSeconds: number,
  fs: number,
): TimeSeries {
  const rng = mulberry32(seed);
  const n = Math.max(2, Math.round(durationSeconds * fs));
  const t = linspace(0, durationSeconds, n);
  // A canonical haemodynamic response: gamma-ish bump around 6 s after each event.
  const eventTimes = [10, 30, 55, 78, 105, 130, 158];
  const v = t.map((tt) => {
    let s = 0;
    for (const e of eventTimes) {
      const dt = tt - e;
      if (dt < 0) continue;
      s +=
        Math.pow(dt, 5) * Math.exp(-dt) * 1e-2 -
        Math.pow(dt - 6, 4) * Math.exp(-(dt - 6)) * 5e-4;
    }
    s += randn(rng) * 0.05;
    return s;
  });
  return { t, v };
}

// --- 2D point clouds (manifolds, scatter) --------------------------------

export interface LabelledPoint {
  x: number;
  y: number;
  label: number;
}

export function generateClusterCloud(
  seed: number,
  classes: number,
  perClass: number,
  spread = 0.6,
): LabelledPoint[] {
  const rng = mulberry32(seed);
  const points: LabelledPoint[] = [];
  for (let c = 0; c < classes; c++) {
    const cx = Math.cos((2 * Math.PI * c) / classes) * 3.4;
    const cy = Math.sin((2 * Math.PI * c) / classes) * 3.4;
    for (let i = 0; i < perClass; i++) {
      points.push({
        x: cx + randn(rng) * spread,
        y: cy + randn(rng) * spread,
        label: c,
      });
    }
  }
  return points;
}

// --- Matrix helpers ------------------------------------------------------

export type Matrix = number[][];

export function generateLeadLagMatrix(seed: number, n: number): Matrix {
  const rng = mulberry32(seed);
  const lags: Matrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 0),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        lags[i][j] = 0;
      } else {
        // Antisymmetric base + weak noise.
        const base = (i - j) / n;
        const noise = randn(rng) * 0.08;
        lags[i][j] = base + noise;
      }
    }
  }
  return lags;
}

export function generateSignificanceMatrix(
  seed: number,
  n: number,
  density = 0.35,
): Matrix {
  const rng = mulberry32(seed);
  const out: Matrix = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => 1),
  );
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        out[i][j] = 1;
        continue;
      }
      // Most off-diagonal cells are non-significant; some hot blocks are.
      const inHotBlock =
        (i < n / 3 && j < n / 3) || (i >= 2 * n / 3 && j >= 2 * n / 3);
      const p = inHotBlock ? rng() * 0.05 : density + rng() * (1 - density);
      out[i][j] = Math.max(0, Math.min(1, p));
    }
  }
  return out;
}
