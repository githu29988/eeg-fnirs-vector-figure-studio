import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import {
  generateLeadLagMatrix,
  generateSignificanceMatrix,
} from '../../lib/synthetic';
import { registerChart } from '../../registry';

function regionLabel(i: number, eegCount: number): string {
  if (i < eegCount) return `EEG${(i + 1).toString().padStart(2, '0')}`;
  return `fNIRS${(i - eegCount + 1).toString().padStart(2, '0')}`;
}

function pStars(p: number): string {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

function LeadLagChart() {
  const [n, setN] = useState(14);
  const [colormap, setColormap] = useState<ColormapName>('coolwarm');
  const [showStars, setShowStars] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const lags = useMemo(() => generateLeadLagMatrix(11, n), [n]);
  const pvals = useMemo(() => generateSignificanceMatrix(13, n), [n]);
  const eegCount = Math.ceil(n / 2);

  const W = 700;
  const H = 580;
  const margin = { top: 100, right: 80, bottom: 80, left: 110 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const cell = Math.min(innerW, innerH) / n;

  const interp = getColormap(colormap);
  const max = Math.max(...lags.flat().map(Math.abs));

  const cmap = (v: number) => interp(0.5 + v / (2 * max + 1e-9));

  return (
    <ChartShell
      filename="lead-lag-matrix"
      getSvg={() => svgRef.current}
      inspector={
        <>
          <ControlGroup label="Channels">
            <NumberSlider
              label="N (EEG + fNIRS)"
              value={n}
              min={6}
              max={28}
              step={2}
              onChange={setN}
            />
          </ControlGroup>
          <ControlGroup label="Display">
            <Toggle
              label="Show significance stars"
              checked={showStars}
              onChange={setShowStars}
            />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Cross-modal cross-correlation lag matrix. Positive values indicate
          row leads column; negative values indicate the opposite. Stars use
          conventional p-value cutoffs (<code>* p&lt;0.05</code>,{' '}
          <code>** p&lt;0.01</code>, <code>*** p&lt;0.001</code>).
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={'Cross-modal lead–lag matrix · $\\tau_{ij}$ (s)'}
          caption={`Synthetic ${n}×${n} lag matrix split between EEG and fNIRS channels.`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {lags.map((row, i) =>
              row.map((v, j) => {
                const star = pStars(pvals[i][j]);
                const fill = cmap(v);
                const dark = Math.abs(v / max) > 0.4;
                return (
                  <g key={`${i}-${j}`}>
                    <rect
                      x={j * cell}
                      y={i * cell}
                      width={cell}
                      height={cell}
                      fill={fill}
                      stroke="white"
                      strokeWidth={0.5}
                    />
                    {showStars && star ? (
                      <text
                        x={j * cell + cell / 2}
                        y={i * cell + cell / 2 + 3}
                        textAnchor="middle"
                        fontSize={Math.max(7, cell * 0.4)}
                        fill={dark ? '#0d1117' : '#eef0f5'}
                        fontWeight={700}
                      >
                        {star}
                      </text>
                    ) : null}
                  </g>
                );
              }),
            )}

            {/* EEG / fNIRS divider */}
            {[eegCount].map((idx) => (
              <g key="div">
                <line
                  x1={idx * cell}
                  x2={idx * cell}
                  y1={0}
                  y2={n * cell}
                  stroke="black"
                  strokeWidth={1.5}
                />
                <line
                  x1={0}
                  x2={n * cell}
                  y1={idx * cell}
                  y2={idx * cell}
                  stroke="black"
                  strokeWidth={1.5}
                />
              </g>
            ))}

            {/* Diagonal */}
            <line
              x1={0}
              x2={n * cell}
              y1={0}
              y2={n * cell}
              stroke="black"
              strokeOpacity={0.6}
              strokeDasharray="3 3"
              strokeWidth={1}
            />

            {/* Row labels */}
            {Array.from({ length: n }).map((_, i) => (
              <text
                key={`r-${i}`}
                x={-6}
                y={i * cell + cell / 2 + 3}
                textAnchor="end"
                fontSize={9}
                fontFamily='"JetBrains Mono", monospace'
                fill="currentColor"
              >
                {regionLabel(i, eegCount)}
              </text>
            ))}
            {/* Column labels */}
            {Array.from({ length: n }).map((_, j) => (
              <text
                key={`c-${j}`}
                x={j * cell + cell / 2}
                y={-6}
                textAnchor="start"
                fontSize={9}
                fontFamily='"JetBrains Mono", monospace'
                fill="currentColor"
                transform={`rotate(-60, ${j * cell + cell / 2}, ${-6})`}
              >
                {regionLabel(j, eegCount)}
              </text>
            ))}

            {/* Color bar */}
            <g transform={`translate(${n * cell + 16}, 0)`}>
              {Array.from({ length: 32 }).map((_, k) => {
                const t = k / 31;
                return (
                  <rect
                    key={k}
                    x={0}
                    y={(1 - t) * (n * cell) - (n * cell) / 32}
                    width={14}
                    height={(n * cell) / 32 + 1}
                    fill={interp(t)}
                  />
                );
              })}
              <rect x={0} y={0} width={14} height={n * cell} fill="none" stroke="black" strokeOpacity={0.4} />
              {[-max, 0, max].map((v, i) => (
                <text
                  key={i}
                  x={20}
                  y={(1 - (v / max + 1) / 2) * (n * cell) + 3}
                  fontSize={10}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="currentColor"
                >
                  {v.toFixed(2)} s
                </text>
              ))}
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'lead-lag-matrix',
  title: 'Cross-modal Lead–Lag Matrix',
  titleZh: '跨模态超前-滞后相关矩阵',
  category: 'clinical',
  summary:
    'Symmetric matrix of cross-correlation lags between EEG and fNIRS channels with significance stars.',
  component: LeadLagChart,
});
