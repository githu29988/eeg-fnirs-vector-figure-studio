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
      label: '几何',
      fields: [
        { type: 'number', key: 'mw', label: '顶部梯形宽度（px）', min: 200, max: 600, step: 10, value: maxWidth, onChange: setMaxWidth, slider: true },
        { type: 'number', key: 'sh', label: '每级高度（px）', min: 36, max: 120, step: 2, value: stepHeight, onChange: setStepHeight, slider: true },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'number', key: 'op', label: '填充不透明度', min: 0.2, max: 1, step: 0.05, value: fillOpacity, onChange: setFillOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: '消融步骤',
      fields: [
        { type: 'info', key: 's', label: '数量', value: String(steps.length) },
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
              label: '紧凑打印',
              hint: 'A4',
              description: '狭长漏斗，适合栏宽印刷。',
              apply: () => {
                setMaxWidth(300);
                setStepHeight(48);
                setFillOpacity(0.85);
              },
            },
            {
              id: 'poster',
              label: '海报尺寸',
              hint: '海报',
              description: '宽梯与高行，适合 A0 海报。',
              apply: () => {
                setMaxWidth(520);
                setStepHeight(80);
                setFillOpacity(0.85);
              },
            },
            {
              id: 'outline',
              label: '仅轮廓',
              hint: '极简',
              description: '低填充，文字排版为主。',
              apply: () => {
                setFillOpacity(0.18);
              },
            },
            {
              id: 'magma',
              label: 'Magma 色带',
              hint: '色彩',
              description: '温暖热力尺度，复审友好。',
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
          <ControlGroup label="漏斗宽度">
            <NumberSlider
              label="顶部梯形宽度（px）"
              value={maxWidth}
              min={240}
              max={520}
              step={10}
              onChange={setMaxWidth}
            />
          </ControlGroup>
          <ControlGroup label="配色">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          每个梯形编码去除某一模型组件后的测试准确率。宽度减损为累加型，
          漏斗逐级收窄进一步呈现多模态融合如何叠加增益，超越单一模态。
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
  title: '消融实验贡献度漏斗图',
  titleEn: 'Ablation Contribution Funnel',
  category: 'evaluation',
  summary:
    '梯形漏斗图，编码逐个去除模型组件后的累计准确率变化。',
  component: AblationFunnel,
});
