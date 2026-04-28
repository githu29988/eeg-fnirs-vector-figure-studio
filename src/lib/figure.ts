/**
 * Common contract for every chart in the studio.
 *
 * Each chart receives a `width`, `height`, dataset, and a registry of
 * shared style tokens (colormap, theme). It returns a self-contained
 * <svg> (or <div> wrapping a <canvas>/<svg>) so the export pipeline
 * has a single, predictable root to serialise.
 */

import type { ColormapName } from './colormaps';

export interface FigureTheme {
  background: string;
  ink: string;
  ink2: string;
  grid: string;
  axis: string;
}

export const LIGHT_THEME: FigureTheme = {
  background: '#ffffff',
  ink: '#0d1117',
  ink2: '#3a4658',
  grid: '#dde2ec',
  axis: '#11161e',
};

export const DARK_THEME: FigureTheme = {
  background: '#0d1117',
  ink: '#eef0f5',
  ink2: '#cdd3dd',
  grid: '#1a212c',
  axis: '#a3acbb',
};

export interface FigureCommonProps {
  width: number;
  height: number;
  theme?: FigureTheme;
  colormap?: ColormapName;
  /** Title rendered above the figure. Supports `$LaTeX$` via KaTeX. */
  title?: string;
  /** Caption rendered below the figure. Supports `$LaTeX$`. */
  caption?: string;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGINS: Margins = {
  top: 36,
  right: 24,
  bottom: 48,
  left: 56,
};

export function innerSize(
  width: number,
  height: number,
  m: Margins = DEFAULT_MARGINS,
) {
  return {
    innerWidth: Math.max(1, width - m.left - m.right),
    innerHeight: Math.max(1, height - m.top - m.bottom),
  };
}
