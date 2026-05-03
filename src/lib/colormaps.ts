import {
  interpolateViridis,
  interpolateMagma,
  interpolateInferno,
  interpolateCividis,
  interpolatePlasma,
  interpolateTurbo,
} from 'd3';

/**
 * Perceptually uniform color maps in CIELAB space. These are the only
 * colour ramps we expose for *quantitative* data — Jet/Rainbow are
 * intentionally excluded because they introduce non-monotonic luminance
 * artefacts that mislead viewers and degrade colour-blind accessibility.
 */
export const SEQUENTIAL_COLORMAPS = {
  viridis: interpolateViridis,
  magma: interpolateMagma,
  inferno: interpolateInferno,
  cividis: interpolateCividis,
  plasma: interpolatePlasma,
} as const;

export type SequentialColormapName = keyof typeof SEQUENTIAL_COLORMAPS;

export const DIVERGING_COLORMAPS = {
  /**
   * RdBu-like diverging that is luminance-symmetric around the midpoint.
   * Built ad-hoc because d3-scale-chromatic's RdBu is not quite uniform.
   */
  coolwarm: (t: number): string => {
    const x = Math.max(0, Math.min(1, t));
    if (x < 0.5) {
      const k = x * 2;
      return interpolateCividis(0.15 + 0.35 * (1 - k));
    }
    const k = (x - 0.5) * 2;
    return interpolateMagma(0.35 + 0.5 * k);
  },
  turbo: interpolateTurbo,
} as const;

export type DivergingColormapName = keyof typeof DIVERGING_COLORMAPS;

export type ColormapName = SequentialColormapName | DivergingColormapName;

export function getColormap(name: ColormapName): (t: number) => string {
  if (name in SEQUENTIAL_COLORMAPS) {
    return SEQUENTIAL_COLORMAPS[name as SequentialColormapName];
  }
  return DIVERGING_COLORMAPS[name as DivergingColormapName];
}

export const COLORMAP_OPTIONS: { value: ColormapName; label: string }[] = [
  { value: 'viridis', label: 'Viridis（默认）' },
  { value: 'magma', label: 'Magma' },
  { value: 'inferno', label: 'Inferno' },
  { value: 'cividis', label: 'Cividis（色弱友好）' },
  { value: 'plasma', label: 'Plasma' },
  { value: 'coolwarm', label: 'Cool–Warm（双向）' },
  { value: 'turbo', label: 'Turbo（慎用）' },
];

/**
 * Build N evenly spaced colours from a colour-map. Useful for legends
 * and discrete classification palettes.
 */
export function sampleColormap(
  name: ColormapName,
  n: number,
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [getColormap(name)(0.5)];
  const interp = getColormap(name);
  return Array.from({ length: n }, (_, i) => interp(i / (n - 1)));
}
