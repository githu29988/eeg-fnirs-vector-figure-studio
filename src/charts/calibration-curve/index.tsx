import { useMemo, useRef, useState } from 'react';
import { line as d3line } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import { sampleColormap } from '../../lib/colormaps';
import { generateBinaryScores } from '../../lib/synthetic';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

interface ModelSpec {
  name: string;
  separation: number;
  /** Logistic shift towards over- (>1) or under-confidence (<1). */
  calibrationShift: number;
  seedOffset: number;
}

const MODELS: ModelSpec[] = [
  { name: 'CNN-only (over-confident)', separation: 0.55, calibrationShift: 1.8, seedOffset: 1 },
  { name: 'GAT-only', separation: 0.85, calibrationShift: 1.0, seedOffset: 2 },
  { name: 'CNN + GAT (well-calibrated)', separation: 1.6, calibrationShift: 0.95, seedOffset: 3 },
];

interface CalibrationBin {
  binCenter: number;
  meanScore: number;
  fractionPositive: number;
  count: number;
}

interface ModelCalibration {
  spec: ModelSpec;
  bins: CalibrationBin[];
  ece: number;
}

function applyCalibrationShift(scores: number[], shift: number): number[] {
  if (shift === 1) return scores;
  // Logit-space scaling: logit(p) <- logit(p) * shift.
  return scores.map((p) => {
    const eps = 1e-6;
    const clipped = Math.min(1 - eps, Math.max(eps, p));
    const z = Math.log(clipped / (1 - clipped)) * shift;
    return 1 / (1 + Math.exp(-z));
  });
}

function computeCalibration(
  y: number[],
  scores: number[],
  bins: number,
): { bins: CalibrationBin[]; ece: number } {
  const out: CalibrationBin[] = Array.from({ length: bins }, (_, b) => ({
    binCenter: (b + 0.5) / bins,
    meanScore: 0,
    fractionPositive: 0,
    count: 0,
  }));
  const sumScore = new Array(bins).fill(0);
  const sumY = new Array(bins).fill(0);

  for (let i = 0; i < scores.length; i++) {
    const idx = Math.min(bins - 1, Math.floor(scores[i] * bins));
    sumScore[idx] += scores[i];
    sumY[idx] += y[i];
    out[idx].count += 1;
  }

  let ece = 0;
  for (let b = 0; b < bins; b++) {
    if (out[b].count > 0) {
      out[b].meanScore = sumScore[b] / out[b].count;
      out[b].fractionPositive = sumY[b] / out[b].count;
      ece += (out[b].count / scores.length) *
        Math.abs(out[b].fractionPositive - out[b].meanScore);
    }
  }
  return { bins: out, ece };
}

function CalibrationChart() {
  const [n, setN] = useState(900);
  const [bins, setBins] = useState(10);
  const [prevalence, setPrevalence] = useState(0.5);
  const svgRef = useRef<SVGSVGElement>(null);

  const expertSchema: ExpertSchema = [
    {
      label: 'Sample',
      fields: [
        { type: 'number', key: 'n', label: 'n per model', min: 100, max: 5000, step: 50, value: n, onChange: setN, slider: true },
        { type: 'number', key: 'pi', label: 'positive prevalence', min: 0.05, max: 0.95, step: 0.01, value: prevalence, onChange: setPrevalence, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: 'Reliability bins',
      fields: [
        { type: 'number', key: 'b', label: 'bin count', min: 4, max: 30, step: 1, value: bins, onChange: setBins, slider: true },
      ],
    },
    {
      label: 'Models',
      fields: [
        { type: 'info', key: 'm', label: 'count', value: String(MODELS.length) },
      ],
    },
  ];

  const models = useMemo<ModelCalibration[]>(() => {
    return MODELS.map((spec) => {
      const data = generateBinaryScores(
        100 * spec.seedOffset,
        n,
        prevalence,
        spec.separation,
      );
      const adjusted = {
        y: data.y,
        scores: applyCalibrationShift(data.scores, spec.calibrationShift),
      };
      const { bins: b, ece } = computeCalibration(adjusted.y, adjusted.scores, bins);
      return { spec, bins: b, ece };
    });
  }, [n, bins, prevalence]);

  const palette = sampleColormap('viridis', MODELS.length);

  const W = 720;
  const H = 480;
  const margin = { top: 36, right: 24, bottom: 64, left: 64 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  const xAxis = buildLinearAxis({
    domain: [0, 1],
    range: [0, innerW],
    ticks: [0, 0.25, 0.5, 0.75, 1],
    format: (v) => v.toFixed(2),
  });
  const yAxis = buildLinearAxis({
    domain: [0, 1],
    range: [innerH, 0],
    ticks: [0, 0.25, 0.5, 0.75, 1],
    format: (v) => v.toFixed(2),
  });

  const linePath = d3line<CalibrationBin>()
    .x((d) => xAxis.scale(d.meanScore))
    .y((d) => yAxis.scale(d.fractionPositive))
    .defined((d) => d.count > 0);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'balanced',
              label: 'Balanced cohort',
              hint: 'baseline',
              description: 'n=900, π=0.50, 10 reliability bins.',
              apply: () => {
                setN(900);
                setPrevalence(0.5);
                setBins(10);
              },
            },
            {
              id: 'rare',
              label: 'Rare-event cohort',
              hint: 'clinical',
              description: 'Low prevalence — calibration tilts upper-left.',
              apply: () => {
                setN(2000);
                setPrevalence(0.08);
                setBins(8);
              },
            },
            {
              id: 'finegrain',
              label: 'Fine-grained bins',
              hint: 'audit',
              description: '20 bins to expose miscalibration pockets.',
              apply: () => {
                setN(3000);
                setPrevalence(0.5);
                setBins(20);
              },
            },
          ]}
        />
      }
      filename="calibration-curve"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="Sample size">
            <NumberSlider
              label="n per model"
              value={n}
              min={150}
              max={4000}
              step={50}
              onChange={setN}
            />
          </ControlGroup>
          <ControlGroup label="Bins">
            <NumberSlider
              label="reliability bins"
              value={bins}
              min={5}
              max={20}
              step={1}
              onChange={setBins}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Reliability diagram showing the fraction of positives observed in
          each predicted-probability bin. The dashed diagonal is perfect
          calibration. The Expected Calibration Error (ECE) in the legend is
          the size-weighted gap between the diagonal and each model's curve.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="Calibration curve · reliability diagram"
          caption={`ECE computed across ${bins} equal-width probability bins.`}
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <YAxis axis={yAxis} offset={0} label="Fraction positive" gridExtent={innerW} />
            <XAxis axis={xAxis} offset={innerH} label="Predicted probability" gridExtent={innerH} />

            <line
              x1={xAxis.scale(0)}
              x2={xAxis.scale(1)}
              y1={yAxis.scale(0)}
              y2={yAxis.scale(1)}
              stroke="currentColor"
              strokeOpacity={0.35}
              strokeDasharray="4 4"
              strokeWidth={1}
            />

            {models.map((m, i) => (
              <g key={m.spec.name}>
                <path
                  d={linePath(m.bins) ?? undefined}
                  fill="none"
                  stroke={palette[i]}
                  strokeWidth={2}
                />
                {m.bins.map((b, bi) =>
                  b.count > 0 ? (
                    <circle
                      key={bi}
                      cx={xAxis.scale(b.meanScore)}
                      cy={yAxis.scale(b.fractionPositive)}
                      r={Math.max(2, Math.sqrt(b.count) * 0.4)}
                      fill={palette[i]}
                      fillOpacity={0.7}
                      stroke="white"
                      strokeWidth={0.5}
                    />
                  ) : null,
                )}
              </g>
            ))}

            <g transform={`translate(${innerW - 220}, ${20})`}>
              <rect
                x={0}
                y={0}
                width={220}
                height={MODELS.length * 18 + 12}
                rx={4}
                fill="white"
                fillOpacity={0.92}
                stroke="currentColor"
                strokeOpacity={0.3}
              />
              {models.map((m, i) => (
                <g key={m.spec.name} transform={`translate(10, ${(i + 0.7) * 18})`}>
                  <line x1={0} x2={18} y1={0} y2={0} stroke={palette[i]} strokeWidth={2} />
                  <text x={24} y={4} fontSize={11} fill="currentColor">
                    {m.spec.name}  ECE={m.ece.toFixed(3)}
                  </text>
                </g>
              ))}
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'calibration-curve',
  title: '校准曲线',
  titleEn: 'Calibration Curve',
  category: 'evaluation',
  summary: '可靠性图：每个分箱标记的大小编码样本量，并标注各模型的 ECE。',
  component: CalibrationChart,
});
