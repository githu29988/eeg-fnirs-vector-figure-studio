/**
 * 2x2 covariance + eigen decomposition for confidence-ellipse drawing.
 */

export interface Ellipse {
  cx: number;
  cy: number;
  /** Major-axis radius. */
  rx: number;
  /** Minor-axis radius. */
  ry: number;
  /** Rotation in radians (counter-clockwise). */
  angle: number;
}

export function computeConfidenceEllipse(
  points: Array<{ x: number; y: number }>,
  /** Chi-square multiplier. 5.991 = 95% for 2 d.o.f. */
  chiSq = 5.991,
): Ellipse | null {
  const n = points.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n - 1;
  syy /= n - 1;
  sxy /= n - 1;

  // Eigenvalues of [[sxx, sxy], [sxy, syy]].
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const inner = Math.max(0, (tr * tr) / 4 - det);
  const sqrt = Math.sqrt(inner);
  const lambda1 = tr / 2 + sqrt;
  const lambda2 = tr / 2 - sqrt;

  const angle = Math.atan2(2 * sxy, sxx - syy) / 2;
  const rx = Math.sqrt(Math.max(lambda1, 0) * chiSq);
  const ry = Math.sqrt(Math.max(lambda2, 0) * chiSq);
  return { cx: mx, cy: my, rx, ry, angle };
}
