import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
} from '../../components/Controls';
import { sampleColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

interface AblationStep {
  label: string;
  /** Test-set accuracy when removing the components listed here. */
  accuracy: number;
}

const DEFAULT_STEPS: AblationStep[] = [
  { label: 'Full model (CNN + GAT + cross-modal)', accuracy: 0.92 },
  { label: '− Cross-modal attention', accuracy: 0.879 },
  { label: '− GAT branch (CNN-only)', accuracy: 0.83 },
  { label: '− CNN branch (GAT-only)', accuracy: 0.811 },
  { label: '− Multimodal data (EEG-only)', accuracy: 0.762 },
  { label: '− Temporal regularisation', accuracy: 0.71 },
];

function AblationFunnel() {
  const [maxWidth, setMaxWidth] = useState(420);
  const [colormap, setColormap] = useState<ColormapName>('viridis');
  const [stepHeight, setStepHeight] = useState(64);
  const [fillOpacity, setFillOpacity] = useState(0.85);
  const svgRef = useRef<SVGSVGElement>(null);

  const steps = DEFAULT_STEPS;

  const expertSchema: ExpertSchema = [
    {
      label: 'Geometry',
      fields: [
        { type: 'number', key: 'mw', label: 'top trapezoid width (px)', min: 200, max: 600, step: 10, value: maxWidth, onChange: setMaxWidth, slider: true },
        { type: 'number', key: 'sh', label: 'step height (px)', min: 36, max: 120, step: 2, value: stepHeight, onChange: setStepHeight, slider: true },
      ],
    },
    {
      label: 'Display',
      fields: [
        { type: 'number', key: 'op', label: 'fill opacity', min: 0.2, max: 1, step: 0.05, value: fillOpacity, onChange: setFillOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: 'Steps',
      fields: [
        { type: 'info', key: 's', label: 'count', value: String(steps.length) },
      ],
    },
  ];
  const palette = useMemo(
    () => sampleColormap(colormap, steps.length),
    [colormap, steps.length],
  );

  const W = 760;
  const H = 60 + steps.length * stepHeight;
  const margin = { top: 36, right: 240, bottom: 32, left: 72 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const stepH = innerH / steps.length;
  const accuracies = steps.map((s) => s.accuracy);
  const maxAcc = Math.max(...accuracies);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'compact',
              label: 'Compact print',
              hint: 'A4',
              description: 'Narrow funnel for column-width prints.',
              apply: () => {
                setMaxWidth(300);
                setStepHeight(48);
                setFillOpacity(0.85);
              },
            },
            {
              id: 'poster',
              label: 'Poster scale',
              hint: 'poster',
              description: 'Wide steps and tall rows for A0 posters.',
              apply: () => {
                setMaxWidth(520);
                setStepHeight(80);
                setFillOpacity(0.85);
              },
            },
            {
              id: 'outline',
              label: 'Outline only',
              hint: 'minimal',
              description: 'Low fill, lets typography lead.',
              apply: () => {
                setFillOpacity(0.18);
              },
            },
            {
              id: 'magma',
              label: 'Magma palette',
              hint: 'palette',
              description: 'Thermal warmth for review-friendly contrast.',
              apply: () => {
                setColormap('magma');
              },
            },
          ]}
        />
      }
      filename="ablation-funnel"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="Funnel width">
            <NumberSlider
              label="Top trapezoid width (px)"
              value={maxWidth}
              min={240}
              max={520}
              step={10}
              onChange={setMaxWidth}
            />
          </ControlGroup>
          <ControlGroup label="Palette">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Each trapezoid encodes test accuracy after removing one model
          component. Width drops are cumulative: the funnel narrowing
          visualises how multi-modal fusion compounds gains beyond either
          modality alone.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="Ablation contribution funnel"
          caption="Synthetic ablation study; accuracies are illustrative."
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            {steps.map((step, i) => {
              const top = i * stepH;
              const bottom = (i + 1) * stepH;
              const wTop = (steps[i].accuracy / maxAcc) * maxWidth;
              const wBot = (steps[Math.min(i + 1, steps.length - 1)].accuracy / maxAcc) * maxWidth;
              const cx = innerW / 2;
              const points: [number, number][] = [
                [cx - wTop / 2, top],
                [cx + wTop / 2, top],
                [cx + wBot / 2, bottom],
                [cx - wBot / 2, bottom],
              ];
              const path = `M${points.map((p) => p.join(',')).join(' L')} Z`;
              const delta =
                i === 0 ? 0 : steps[i].accuracy - steps[i - 1].accuracy;
              return (
                <g key={i}>
                  <path d={path} fill={palette[i]} fillOpacity={fillOpacity} stroke="white" strokeWidth={1} />
                  <text
                    x={cx}
                    y={top + stepH / 2 + 4}
                    textAnchor="middle"
                    fontSize={13}
                    fontWeight={600}
                    fill="white"
                    style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.4)', strokeWidth: 2 }}
                  >
                    {step.accuracy.toFixed(3)}
                  </text>

                  {/* Side annotation */}
                  <text
                    x={innerW + 18}
                    y={top + stepH / 2 - 4}
                    fontSize={11}
                    fontWeight={500}
                    fill="currentColor"
                  >
                    {step.label}
                  </text>
                  <text
                    x={innerW + 18}
                    y={top + stepH / 2 + 12}
                    fontSize={10}
                    fill={delta < 0 ? '#b91c1c' : '#0f766e'}
                    fontFamily='"JetBrains Mono", monospace'
                  >
                    {i === 0
                      ? 'baseline'
                      : `Δ = ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(2)}%`}
                  </text>
                </g>
              );
            })}
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'ablation-funnel',
  title: 'Ablation Contribution Funnel',
  titleZh: '消融实验贡献度漏斗图',
  category: 'evaluation',
  summary:
    'Trapezoidal funnel encoding cumulative accuracy after removing each model component.',
  component: AblationFunnel,
});
