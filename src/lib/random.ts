/**
 * Tiny seeded PRNGs. We avoid pulling a dep for this — figures need
 * reproducible demo data so screenshots compare cleanly between PRs.
 */

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randn(rng: () => number): number {
  // Box-Muller. We discard the second sample for simplicity.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export function range(start: number, stop?: number, step = 1): number[] {
  const [from, to] = stop === undefined ? [0, start] : [start, stop];
  const out: number[] = [];
  for (let v = from; step > 0 ? v < to : v > to; v += step) out.push(v);
  return out;
}

export function linspace(start: number, end: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (end - start) / (n - 1);
  return Array.from({ length: n }, (_, i) => start + step * i);
}
