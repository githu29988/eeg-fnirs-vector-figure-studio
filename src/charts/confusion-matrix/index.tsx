import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { mulberry32, randn } from '../../lib/random';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import { registerChart } from '../../registry';

const DEFAULT_LABELS = ['Inter-ictal', 'Pre-ictal', 'Ictal', 'Post-ictal'];

interface CmInputs {
  seed: number;
  n: number;
  labels: string[];
  /** Higher = better classifier. */
  separation: number;
}

function buildConfusionMatrix({
  seed,
  n,
  labels,
  separation,
}: CmInputs): number[][] {
  const k = labels.length;
  const rng = mulberry32(seed);
  const cm: number[][] = Array.from({ length: k }, () =>
    Array.from({ length: k }, () => 0),
  );
  for (let i = 0; i < n; i++) {
    const trueClass = Math.floor(rng() * k);
    // Score the correct class higher; others get small noisy scores.
    const scores = new Array(k).fill(0).map((_, c) => {
      const mu = c === trueClass ? separation : 0;
      return mu + randn(rng);
    });
    let best = 0;
    for (let c = 1; c < k; c++) if (scores[c] > scores[best]) best = c;
    cm[trueClass][best] += 1;
  }
  return cm;
}

function ConfusionMatrixChart() {
  const [n, setN] = useState(720);
  const [separation, setSeparation] = useState(1.6);
  const [normalize, setNormalize] = useState(true);
  const [colormap, setColormap] = useState<ColormapName>('viridis');
  const svgRef = useRef<SVGSVGElement>(null);

  const labels = DEFAULT_LABELS;
  const cm = useMemo(
    () => buildConfusionMatrix({ seed: 42, n, labels, separation }),
    [n, labels, separation],
  );

  const W = 640;
  const H = 480;
  const margin = { top: 36, right: 64, bottom: 80, left: 110 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const k = labels.length;
  const cellW = innerW / k;
  const cellH = innerH / k;

  const interp = getColormap(colormap);
  const rowSums = cm.map((row) => row.reduce((a, b) => a + b, 0));

  const cellValue = (i: number, j: number) =>
    normalize && rowSums[i] > 0 ? cm[i][j] / rowSums[i] : cm[i][j];
  const maxVal = Math.max(
    ...cm.flatMap((row, i) => row.map((_, j) => cellValue(i, j))),
  );

  return (
    <ChartShell
      filename="confusion-matrix"
      getSvg={() => svgRef.current}
      inspector={
        <>
          <ControlGroup label="Sample size">
            <NumberSlider
              label="n"
              value={n}
              min={120}
              max={4000}
              step={40}
              onChange={setN}
            />
          </ControlGroup>
          <ControlGroup label="Classifier strength">
            <NumberSlider
              label="μ separation"
              value={separation}
              min={0}
              max={4}
              step={0.05}
              onChange={setSeparation}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="Display">
            <Toggle
              label="Row-normalise (recall view)"
              checked={normalize}
              onChange={setNormalize}
            />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Multi-class confusion matrix for a synthetic 4-state seizure stage
          classifier. Each cell encodes <code>row-normalised recall</code> or
          raw counts depending on the toggle. Cell values are rendered as
          plain text for accessibility (screen readers and B/W print).
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={`Confusion matrix · $\\mu = ${separation.toFixed(2)}$`}
          caption={`Synthetic 4-class data, n=${n}.`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {labels.map((_, i) =>
              labels.map((_, j) => {
                const v = cellValue(i, j);
                const t = maxVal === 0 ? 0 : v / maxVal;
                const luminance = t;
                return (
                  <g key={`${i}-${j}`}>
                    <rect
                      x={j * cellW}
                      y={i * cellH}
                      width={cellW}
                      height={cellH}
                      fill={interp(t)}
                      stroke="white"
                      strokeWidth={1}
                    />
                    <text
                      x={j * cellW + cellW / 2}
                      y={i * cellH + cellH / 2 + 4}
                      textAnchor="middle"
                      fontSize={12}
                      fontFamily='"JetBrains Mono", monospace'
                      fill={luminance > 0.55 ? '#0d1117' : '#eef0f5'}
                    >
                      {normalize ? v.toFixed(2) : Math.round(v).toString()}
                    </text>
                  </g>
                );
              }),
            )}

            {/* Axis labels */}
            {labels.map((l, i) => (
              <text
                key={`row-${i}`}
                x={-8}
                y={i * cellH + cellH / 2 + 4}
                textAnchor="end"
                fontSize={11}
                fill="currentColor"
              >
                {l}
              </text>
            ))}
            {labels.map((l, j) => (
              <text
                key={`col-${j}`}
                x={j * cellW + cellW / 2}
                y={innerH + 22}
                textAnchor="middle"
                fontSize={11}
                fill="currentColor"
                transform={`rotate(-30, ${j * cellW + cellW / 2}, ${innerH + 22})`}
              >
                {l}
              </text>
            ))}

            <text
              x={-72}
              y={innerH / 2}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="currentColor"
              transform={`rotate(-90, -72, ${innerH / 2})`}
            >
              True label
            </text>
            <text
              x={innerW / 2}
              y={innerH + 56}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="currentColor"
            >
              Predicted label
            </text>

            {/* Colour bar */}
            <ColorBar
              x={innerW + 18}
              y={0}
              w={14}
              h={innerH}
              interp={interp}
              max={maxVal}
              format={normalize ? (v: number) => v.toFixed(2) : (v: number) => Math.round(v).toString()}
            />
          </g>
        </FigureFrame>
      }
    />
  );
}

function ColorBar({
  x,
  y,
  w,
  h,
  interp,
  max,
  format,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  interp: (t: number) => string;
  max: number;
  format: (v: number) => string;
}) {
  const stops = 32;
  return (
    <g transform={`translate(${x}, ${y})`}>
      {Array.from({ length: stops }).map((_, i) => {
        const t = i / (stops - 1);
        return (
          <rect
            key={i}
            x={0}
            y={(1 - t) * h - h / stops}
            width={w}
            height={h / stops + 1}
            fill={interp(t)}
          />
        );
      })}
      <rect x={0} y={0} width={w} height={h} fill="none" stroke="currentColor" strokeOpacity={0.4} />
      {[0, 0.5, 1].map((t) => (
        <text
          key={t}
          x={w + 4}
          y={(1 - t) * h + 3}
          fontSize={10}
          fill="currentColor"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          {format(t * max)}
        </text>
      ))}
    </g>
  );
}

registerChart({
  id: 'confusion-matrix',
  title: 'Confusion Matrix',
  titleZh: '混淆矩阵',
  category: 'evaluation',
  summary:
    'Multi-class confusion matrix with row-normalised recall view, perceptually uniform colour ramp, and accessible cell labels.',
  component: ConfusionMatrixChart,
});
