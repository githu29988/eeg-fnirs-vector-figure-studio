import { useMemo, useRef, useState } from 'react';
import { line as d3line } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import { sampleColormap } from '../../lib/colormaps';
import { generateBinaryScores } from '../../lib/synthetic';
import type { ExpertSchema } from '../../components/ExpertPanel';
import {
  InspirationPanel,
  type InspirationPreset,
} from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import {
  bootstrapAucCi,
  computePr,
  computeRoc,
  type RocCurve,
  type PrCurve,
} from './metrics';

interface ModelSpec {
  name: string;
  /** Higher = better separation. */
  separation: number;
  /** Bootstrap seed offset so models look independently sampled. */
  seedOffset: number;
}

const DEFAULT_MODELS: ModelSpec[] = [
  { name: 'CNN-only', separation: 0.55, seedOffset: 1 },
  { name: 'GAT-only', separation: 0.85, seedOffset: 2 },
  { name: 'CNN + GAT (fused)', separation: 1.6, seedOffset: 3 },
];

interface ComputedModel {
  spec: ModelSpec;
  roc: RocCurve;
  pr: PrCurve;
  ci: { lo: number; hi: number };
}

function RocPrChart() {
  const [n, setN] = useState(420);
  const [showCi, setShowCi] = useState(true);
  const [bootstrapIter, setBootstrapIter] = useState(120);
  const [prevalence, setPrevalence] = useState(0.5);
  const svgRef = useRef<SVGSVGElement>(null);

  const models = useMemo<ComputedModel[]>(() => {
    return DEFAULT_MODELS.map((spec) => {
      const data = generateBinaryScores(
        100 * spec.seedOffset,
        n,
        prevalence,
        spec.separation,
      );
      const roc = computeRoc(data);
      const pr = computePr(data);
      const ci = bootstrapAucCi(data, bootstrapIter, 31 * spec.seedOffset);
      return { spec, roc, pr, ci };
    });
  }, [n, prevalence, bootstrapIter]);

  const expertSchema: ExpertSchema = [
    {
      label: 'Sample',
      fields: [
        { type: 'number', key: 'n', label: 'n per model', min: 40, max: 5000, step: 20, value: n, onChange: setN, slider: true },
        { type: 'number', key: 'pi', label: 'positive prevalence', min: 0.05, max: 0.95, step: 0.01, value: prevalence, onChange: setPrevalence, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: 'Bootstrap',
      fields: [
        { type: 'number', key: 'bi', label: 'iterations', min: 20, max: 1000, step: 10, value: bootstrapIter, onChange: setBootstrapIter, slider: true },
      ],
    },
    {
      label: 'Display',
      fields: [
        { type: 'toggle', key: 'ci', label: '95% CI in legend', value: showCi, onChange: setShowCi },
        { type: 'info', key: 'm', label: 'models', value: String(DEFAULT_MODELS.length) },
      ],
    },
  ];

  const palette = sampleColormap('viridis', DEFAULT_MODELS.length);

  const W = 760;
  const H = 420;
  const margin = { top: 36, right: 16, bottom: 56, left: 60 };
  const panelGap = 48;
  const panelW = (W - margin.left - margin.right - panelGap) / 2;
  const panelH = H - margin.top - margin.bottom;

  const xAxis = buildLinearAxis({
    domain: [0, 1],
    range: [0, panelW],
    ticks: [0, 0.25, 0.5, 0.75, 1],
    format: (v) => v.toFixed(2),
  });
  const yAxis = buildLinearAxis({
    domain: [0, 1],
    range: [panelH, 0],
    ticks: [0, 0.25, 0.5, 0.75, 1],
    format: (v) => v.toFixed(2),
  });

  const rocPath = d3line<[number, number]>()
    .x((d) => xAxis.scale(d[0]))
    .y((d) => yAxis.scale(d[1]));
  const prPath = d3line<[number, number]>()
    .x((d) => xAxis.scale(d[0]))
    .y((d) => yAxis.scale(d[1]));

  const inspirations: InspirationPreset[] = [
    {
      id: 'review',
      label: 'Conference baseline',
      hint: 'review',
      description: 'n=420, 120-iter bootstrap, default models.',
      apply: () => {
        setN(420);
        setBootstrapIter(120);
        setPrevalence(0.5);
        setShowCi(true);
      },
    },
    {
      id: 'rare',
      label: 'Rare-disease screening',
      hint: 'clinical',
      description: 'Low prevalence flips PR — AP collapses, ROC unaffected.',
      apply: () => {
        setN(900);
        setBootstrapIter(200);
        setPrevalence(0.05);
        setShowCi(true);
      },
    },
    {
      id: 'tight',
      label: 'Tight CI',
      hint: 'publication',
      description: 'Big bootstrap (B=600) for camera-ready figures.',
      apply: () => {
        setN(600);
        setBootstrapIter(600);
        setPrevalence(0.5);
        setShowCi(true);
      },
    },
    {
      id: 'noci',
      label: 'Curves only',
      hint: 'minimal',
      description: 'Hide CIs to declutter for poster panels.',
      apply: () => {
        setShowCi(false);
      },
    },
  ];

  return (
    <ChartShell
      filename="roc-pr-curves"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={<InspirationPanel presets={inspirations} />}
      inspector={
        <>
          <ControlGroup label="Sample size n">
            <NumberSlider
              label="n per model"
              value={n}
              min={80}
              max={2000}
              step={20}
              onChange={setN}
            />
          </ControlGroup>
          <ControlGroup label="Display">
            <Toggle
              label="Bootstrap 95% CI in legend"
              checked={showCi}
              onChange={setShowCi}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Synthetic binary classifiers parameterised by a class-separation{' '}
          parameter. Each model uses a fixed seed so the figure is fully
          reproducible. AUC and AP are computed with the trapezoidal rule;
          confidence intervals come from a {bootstrapIter}-iteration bootstrap.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="Publication-ready ROC and Precision–Recall curves"
          caption={`AUC ranges with 95% CI from a bootstrap (B=${bootstrapIter}). Synthetic data, n=${n}.`}
        >
          {/* Two side-by-side panels */}
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {/* ---- ROC ---- */}
            <Panel
              x={0}
              w={panelW}
              h={panelH}
              title="ROC"
              xLabel="False positive rate"
              yLabel="True positive rate"
              xAxis={xAxis}
              yAxis={yAxis}
              palette={palette}
              models={models}
              showCi={showCi}
              kind="roc"
              line={rocPath}
            />
            {/* ---- PR ---- */}
            <Panel
              x={panelW + panelGap}
              w={panelW}
              h={panelH}
              title="Precision–Recall"
              xLabel="Recall"
              yLabel="Precision"
              xAxis={xAxis}
              yAxis={yAxis}
              palette={palette}
              models={models}
              showCi={showCi}
              kind="pr"
              line={prPath}
            />
          </g>
        </FigureFrame>
      }
    />
  );
}

interface PanelProps {
  x: number;
  w: number;
  h: number;
  title: string;
  xLabel: string;
  yLabel: string;
  xAxis: ReturnType<typeof buildLinearAxis>;
  yAxis: ReturnType<typeof buildLinearAxis>;
  palette: string[];
  models: ComputedModel[];
  showCi: boolean;
  kind: 'roc' | 'pr';
  line: ReturnType<typeof d3line<[number, number]>>;
}

function Panel({
  x,
  w,
  h,
  title,
  xLabel,
  yLabel,
  xAxis,
  yAxis,
  palette,
  models,
  showCi,
  kind,
  line,
}: PanelProps) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text
        x={w / 2}
        y={-12}
        textAnchor="middle"
        fontSize={13}
        fontWeight={600}
        fill="currentColor"
      >
        {title}
      </text>
      <YAxis axis={yAxis} offset={0} label={yLabel} gridExtent={w} />
      <XAxis axis={xAxis} offset={h} label={xLabel} gridExtent={h} />

      {/* Reference diagonal for ROC. */}
      {kind === 'roc' ? (
        <line
          x1={xAxis.scale(0)}
          x2={xAxis.scale(1)}
          y1={yAxis.scale(0)}
          y2={yAxis.scale(1)}
          stroke="currentColor"
          strokeOpacity={0.25}
          strokeDasharray="4 4"
          strokeWidth={1}
        />
      ) : null}

      {models.map((m, i) => {
        const path =
          kind === 'roc'
            ? line(m.roc.points.map((p) => [p.fpr, p.tpr] as [number, number]))
            : line(m.pr.points.map((p) => [p.recall, p.precision] as [number, number]));
        return (
          <path
            key={`${m.spec.name}-${kind}`}
            d={path ?? undefined}
            fill="none"
            stroke={palette[i]}
            strokeWidth={2}
          />
        );
      })}

      <Legend
        x={w - 6}
        y={h - 6}
        anchor="end"
        models={models}
        palette={palette}
        showCi={showCi}
        metric={kind === 'roc' ? 'AUC' : 'AP'}
      />
    </g>
  );
}

function Legend({
  x,
  y,
  anchor,
  models,
  palette,
  showCi,
  metric,
}: {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  models: ComputedModel[];
  palette: string[];
  showCi: boolean;
  metric: 'AUC' | 'AP';
}) {
  const rowH = 16;
  const totalH = models.length * rowH + 8;
  return (
    <g transform={`translate(${x}, ${y - totalH})`}>
      <rect
        x={anchor === 'end' ? -200 : 0}
        y={0}
        width={200}
        height={totalH}
        rx={4}
        fill="white"
        fillOpacity={0.92}
        stroke="currentColor"
        strokeOpacity={0.3}
      />
      {models.map((m, i) => {
        const value = metric === 'AUC' ? m.roc.auc : m.pr.ap;
        const ci = showCi ? `  [${m.ci.lo.toFixed(2)}, ${m.ci.hi.toFixed(2)}]` : '';
        const label = `${m.spec.name}  ${metric} = ${value.toFixed(3)}${ci}`;
        return (
          <g key={m.spec.name} transform={`translate(${anchor === 'end' ? -190 : 10}, ${rowH * (i + 0.7)})`}>
            <line x1={0} x2={18} y1={0} y2={0} stroke={palette[i]} strokeWidth={2} />
            <text x={24} y={3} fontSize={11} fill="currentColor">
              {label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

registerChart({
  id: 'roc-pr-curves',
  title: '出版级 ROC / PR 曲线',
  titleEn: 'ROC & Precision–Recall Curves',
  category: 'evaluation',
  summary: '多模型 ROC 与 PR 曲线并列展示，附带 AUC、AP 与 bootstrap 95% 置信区间。',
  component: RocPrChart,
});
