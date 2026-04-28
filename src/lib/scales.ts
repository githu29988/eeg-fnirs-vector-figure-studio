/**
 * Helpers around d3-scale that emit React-friendly axis primitives.
 *
 * d3-axis is imperative — it mutates SVG nodes through a selection.
 * Inside a React render that fights with the virtual DOM, so we
 * compute ticks, format strings, and offsets here and let the chart
 * components emit `<line>` / `<text>` declaratively.
 */
import { scaleLinear, scaleBand, scalePoint, type ScaleLinear } from 'd3';

export interface AxisTick {
  value: number;
  position: number;
  label: string;
}

export interface LinearAxisConfig {
  domain: [number, number];
  range: [number, number];
  tickCount?: number;
  /** Pinned tick values (e.g. [0, 0.5, 1] for ROC). */
  ticks?: number[];
  /** Custom formatter; default is `.precision()` based on tick spacing. */
  format?: (value: number) => string;
  /** Force the domain to be "nice" (rounded-out). */
  nice?: boolean;
}

export interface LinearAxis {
  scale: ScaleLinear<number, number>;
  ticks: AxisTick[];
  domain: [number, number];
  range: [number, number];
}

export function buildLinearAxis(cfg: LinearAxisConfig): LinearAxis {
  let scale = scaleLinear().domain(cfg.domain).range(cfg.range);
  if (cfg.nice) scale = scale.nice();
  const tickValues = cfg.ticks ?? scale.ticks(cfg.tickCount ?? 6);
  const format = cfg.format ?? defaultFormat(tickValues);
  return {
    scale,
    domain: scale.domain() as [number, number],
    range: scale.range() as [number, number],
    ticks: tickValues.map((value) => ({
      value,
      position: scale(value),
      label: format(value),
    })),
  };
}

function defaultFormat(values: number[]): (v: number) => string {
  if (values.length < 2) {
    return (v) => formatSmart(v);
  }
  const span = Math.abs(values[values.length - 1] - values[0]);
  if (span >= 1000) return (v) => v.toFixed(0);
  if (span >= 10) return (v) => v.toFixed(1);
  if (span >= 1) return (v) => v.toFixed(2);
  if (span >= 0.01) return (v) => v.toFixed(3);
  return (v) => v.toExponential(1);
}

function formatSmart(v: number): string {
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000 || abs < 0.001) return v.toExponential(1);
  return v.toFixed(2);
}

export { scaleLinear, scaleBand, scalePoint };
