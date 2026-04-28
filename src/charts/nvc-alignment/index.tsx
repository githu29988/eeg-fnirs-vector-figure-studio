import { useMemo, useRef, useState } from 'react';
import { line as d3line, curveMonotoneX } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import {
  generateEegLikeSeries,
  generateHrfLikeSeries,
} from '../../lib/synthetic';
import { registerChart } from '../../registry';

interface SeizureBand {
  start: number;
  end: number;
  kind: 'inter' | 'pre' | 'ictal';
}

const BANDS: SeizureBand[] = [
  { start: 0, end: 25, kind: 'inter' },
  { start: 25, end: 55, kind: 'pre' },
  { start: 55, end: 90, kind: 'ictal' },
  { start: 90, end: 130, kind: 'pre' },
  { start: 130, end: 180, kind: 'inter' },
];

function NVCChart() {
  const [duration, setDuration] = useState(180);
  const [eegFs, setEegFs] = useState(120);
  const [hrfFs, setHrfFs] = useState(10);
  const [showBands, setShowBands] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const eeg = useMemo(
    () => generateEegLikeSeries(11, duration, eegFs),
    [duration, eegFs],
  );
  const hbo = useMemo(
    () => generateHrfLikeSeries(13, duration, hrfFs),
    [duration, hrfFs],
  );
  const hbr = useMemo(() => {
    // HbR roughly anti-correlates with HbO with a small lag.
    const out = generateHrfLikeSeries(17, duration, hrfFs);
    return { t: out.t, v: out.v.map((v) => -v * 0.7) };
  }, [duration, hrfFs]);

  const W = 820;
  const H = 460;
  const margin = { top: 36, right: 70, bottom: 60, left: 70 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const xAxis = buildLinearAxis({
    domain: [0, duration],
    range: [0, innerW],
    tickCount: 8,
    format: (v) => `${v.toFixed(0)}s`,
  });

  const eegMax = Math.max(...eeg.v.map(Math.abs));
  const eegAxis = buildLinearAxis({
    domain: [-eegMax, eegMax],
    range: [innerH, 0],
    tickCount: 5,
    format: (v) => v.toFixed(1),
  });

  const hbMax = Math.max(
    ...hbo.v.map(Math.abs),
    ...hbr.v.map(Math.abs),
  );
  const hbAxis = buildLinearAxis({
    domain: [-hbMax, hbMax],
    range: [innerH, 0],
    tickCount: 5,
    format: (v) => v.toFixed(2),
  });

  const eegLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => eegAxis.scale(d.v));
  const hboLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => hbAxis.scale(d.v))
    .curve(curveMonotoneX);
  const hbrLine = d3line<{ t: number; v: number }>()
    .x((d) => xAxis.scale(d.t))
    .y((d) => hbAxis.scale(d.v))
    .curve(curveMonotoneX);

  const bandColors: Record<SeizureBand['kind'], string> = {
    inter: 'rgba(125, 211, 252, 0.12)',
    pre: 'rgba(251, 191, 36, 0.18)',
    ictal: 'rgba(239, 68, 68, 0.20)',
  };
  const bandLabels: Record<SeizureBand['kind'], string> = {
    inter: 'Inter-ictal',
    pre: 'Pre-ictal',
    ictal: 'Ictal',
  };

  const eegPoints = useMemo(
    () => eeg.t.map((t, i) => ({ t, v: eeg.v[i] })),
    [eeg.t, eeg.v],
  );
  const hboPoints = useMemo(
    () => hbo.t.map((t, i) => ({ t, v: hbo.v[i] })),
    [hbo.t, hbo.v],
  );
  const hbrPoints = useMemo(
    () => hbr.t.map((t, i) => ({ t, v: hbr.v[i] })),
    [hbr.t, hbr.v],
  );

  return (
    <ChartShell
      filename="nvc-alignment"
      getSvg={() => svgRef.current}
      inspector={
        <>
          <ControlGroup label="Recording">
            <NumberSlider
              label="duration (s)"
              value={duration}
              min={60}
              max={240}
              step={10}
              onChange={setDuration}
            />
            <NumberSlider
              label="EEG fs (Hz)"
              value={eegFs}
              min={32}
              max={250}
              step={2}
              onChange={setEegFs}
            />
            <NumberSlider
              label="fNIRS fs (Hz)"
              value={hrfFs}
              min={2}
              max={20}
              step={1}
              onChange={setHrfFs}
            />
          </ControlGroup>
          <ControlGroup label="Annotations">
            <Toggle
              label="Show seizure bands"
              checked={showBands}
              onChange={setShowBands}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Dual-axis time series aligned on a shared timestamp. EEG (left)
          retains raw spikes while HbO/HbR (right) are smoothed via a
          monotone-cubic spline so the slow neurovascular response stays
          visually separable. Background bands flag inter-ictal,
          pre-ictal, and ictal periods.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="Neurovascular coupling alignment"
          caption={'EEG (μV) on the left axis · $\\Delta$HbO/HbR (μmol/L) on the right axis.'}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* Seizure bands */}
            {showBands
              ? BANDS.map((b, i) => (
                  <g key={i}>
                    <rect
                      x={xAxis.scale(b.start)}
                      width={xAxis.scale(b.end) - xAxis.scale(b.start)}
                      y={0}
                      height={innerH}
                      fill={bandColors[b.kind]}
                    />
                    <text
                      x={(xAxis.scale(b.start) + xAxis.scale(b.end)) / 2}
                      y={-8}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#0d1117"
                    >
                      {bandLabels[b.kind]}
                    </text>
                  </g>
                ))
              : null}

            <YAxis axis={eegAxis} offset={0} label="EEG (μV)" gridExtent={innerW} />
            <XAxis axis={xAxis} offset={innerH} label="Time (s)" gridExtent={innerH} />

            {/* Right axis (no grid) */}
            <g transform={`translate(${innerW}, 0)`}>
              <line x1={0} x2={0} y1={0} y2={innerH} stroke="currentColor" strokeWidth={1} />
              {hbAxis.ticks.map((t, i) => (
                <g key={i} transform={`translate(0, ${t.position})`}>
                  <line x1={0} x2={5} stroke="currentColor" strokeWidth={1} />
                  <text x={9} y={4} fontSize={11} fontFamily='"JetBrains Mono", monospace' fill="currentColor">
                    {t.label}
                  </text>
                </g>
              ))}
              <text
                transform={`translate(48, ${innerH / 2}) rotate(-90)`}
                textAnchor="middle"
                fontSize={12}
                fill="currentColor"
              >
                ΔHbO/HbR (μmol/L)
              </text>
            </g>

            <path d={eegLine(eegPoints) ?? undefined} stroke="#0d1117" strokeWidth={0.7} fill="none" opacity={0.85} />
            <path d={hboLine(hboPoints) ?? undefined} stroke="#dc2626" strokeWidth={2} fill="none" />
            <path d={hbrLine(hbrPoints) ?? undefined} stroke="#1d4ed8" strokeWidth={2} fill="none" />

            {/* Legend */}
            <g transform={`translate(${innerW - 220}, 12)`}>
              <rect width={220} height={56} rx={4} fill="white" fillOpacity={0.92} stroke="currentColor" strokeOpacity={0.3} />
              <g transform="translate(10, 18)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#0d1117" strokeWidth={0.7} />
                <text x={26} y={4} fontSize={11} fill="currentColor">
                  EEG (μV)
                </text>
              </g>
              <g transform="translate(10, 36)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#dc2626" strokeWidth={2} />
                <text x={26} y={4} fontSize={11} fill="currentColor">
                  ΔHbO
                </text>
              </g>
              <g transform="translate(120, 36)">
                <line x1={0} x2={20} y1={0} y2={0} stroke="#1d4ed8" strokeWidth={2} />
                <text x={26} y={4} fontSize={11} fill="currentColor">
                  ΔHbR
                </text>
              </g>
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'nvc-alignment',
  title: 'Neurovascular Coupling Alignment',
  titleZh: '神经血管耦合对齐时序图',
  category: 'physiology',
  summary:
    'Dual-axis EEG vs HbO/HbR time series aligned on a shared timestamp with seizure-stage shading.',
  component: NVCChart,
});
