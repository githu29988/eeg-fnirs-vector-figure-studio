import { mulberry32 } from '../../lib/random';
import type { BinaryScores } from '../../lib/synthetic';

export interface RocPoint {
  fpr: number;
  tpr: number;
  threshold: number;
}

export interface PrPoint {
  recall: number;
  precision: number;
  threshold: number;
}

export interface RocCurve {
  points: RocPoint[];
  auc: number;
}

export interface PrCurve {
  points: PrPoint[];
  ap: number;
}

interface SortedScores {
  scores: number[];
  y: number[];
  pos: number;
  neg: number;
}

function sortByScoreDesc({ y, scores }: BinaryScores): SortedScores {
  const order = scores
    .map((s, i) => ({ s, y: y[i] }))
    .sort((a, b) => b.s - a.s);
  const sortedScores = order.map((o) => o.s);
  const sortedY = order.map((o) => o.y);
  const pos = sortedY.reduce((a, b) => a + b, 0);
  return { scores: sortedScores, y: sortedY, pos, neg: sortedY.length - pos };
}

export function computeRoc(input: BinaryScores): RocCurve {
  const { scores, y, pos, neg } = sortByScoreDesc(input);
  if (pos === 0 || neg === 0) {
    return { points: [], auc: NaN };
  }

  const points: RocPoint[] = [{ fpr: 0, tpr: 0, threshold: Infinity }];
  let tp = 0;
  let fp = 0;
  let prevScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] !== prevScore && i > 0) {
      points.push({ fpr: fp / neg, tpr: tp / pos, threshold: prevScore });
    }
    if (y[i] === 1) tp += 1;
    else fp += 1;
    prevScore = scores[i];
  }
  points.push({ fpr: fp / neg, tpr: tp / pos, threshold: prevScore });

  let auc = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].fpr - points[i - 1].fpr;
    auc += dx * (points[i].tpr + points[i - 1].tpr) * 0.5;
  }
  return { points, auc };
}

export function computePr(input: BinaryScores): PrCurve {
  const { scores, y, pos } = sortByScoreDesc(input);
  if (pos === 0) {
    return { points: [], ap: NaN };
  }

  const points: PrPoint[] = [];
  let tp = 0;
  let fp = 0;
  let prevScore = Number.POSITIVE_INFINITY;

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] !== prevScore && i > 0) {
      const recall = tp / pos;
      const precision = tp / Math.max(1, tp + fp);
      points.push({ recall, precision, threshold: prevScore });
    }
    if (y[i] === 1) tp += 1;
    else fp += 1;
    prevScore = scores[i];
  }
  points.push({
    recall: tp / pos,
    precision: tp / Math.max(1, tp + fp),
    threshold: prevScore,
  });
  if (points[0].recall !== 0) {
    points.unshift({
      recall: 0,
      precision: points[0].precision,
      threshold: Infinity,
    });
  }

  let ap = 0;
  for (let i = 1; i < points.length; i++) {
    const dr = points[i].recall - points[i - 1].recall;
    ap += dr * points[i].precision;
  }
  return { points, ap };
}

/**
 * Bootstrap a 95% confidence interval for AUC by resampling with
 * replacement. Defaults to 200 iterations which is enough to give a
 * stable interval for n ≳ 200 samples in interactive demos.
 */
export function bootstrapAucCi(
  input: BinaryScores,
  iterations = 200,
  seed = 7,
): { lo: number; hi: number } {
  const rng = mulberry32(seed);
  const aucs: number[] = [];
  const n = input.y.length;
  for (let it = 0; it < iterations; it++) {
    const yi: number[] = new Array(n);
    const si: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(rng() * n);
      yi[i] = input.y[idx];
      si[i] = input.scores[idx];
    }
    const r = computeRoc({ y: yi, scores: si });
    if (Number.isFinite(r.auc)) aucs.push(r.auc);
  }
  if (aucs.length === 0) return { lo: NaN, hi: NaN };
  aucs.sort((a, b) => a - b);
  const lo = aucs[Math.floor(0.025 * aucs.length)];
  const hi = aucs[Math.floor(0.975 * aucs.length)];
  return { lo, hi };
}
