import { useMemo, useRef, useState } from 'react';
import { chord, ribbon, arc as d3arc } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
} from '../../components/Controls';
import { sampleColormap, type ColormapName } from '../../lib/colormaps';
import { mulberry32, randn } from '../../lib/random';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

const REGIONS = [
  'L. Frontal',
  'R. Frontal',
  'L. Central',
  'R. Central',
  'L. Temporal',
  'R. Temporal',
  'L. Parietal',
  'R. Parietal',
  'L. Occipital',
  'R. Occipital',
];

function generateAttentionTensor(
  seed: number,
  T: number,
  N: number,
): number[][][] {
  const rng = mulberry32(seed);
  const out: number[][][] = [];
  for (let t = 0; t < T; t++) {
    const slice: number[][] = Array.from({ length: N }, () =>
      Array.from({ length: N }, () => 0),
    );
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const phase = (t / T) * 2 * Math.PI + (i + j) * 0.4;
        const base = 0.4 + 0.4 * Math.sin(phase);
        const cluster = i % 2 === j % 2 ? 0.4 : 0;
        slice[i][j] = Math.max(0, base + cluster + randn(rng) * 0.05);
      }
    }
    out.push(slice);
  }
  return out;
}

function DynamicChordChart() {
  const [t, setT] = useState(8);
  const [colormap, setColormap] = useState<ColormapName>('magma');
  const [seed, setSeed] = useState(53);
  const [padAngle, setPadAngle] = useState(0.04);
  const [ribbonOpacity, setRibbonOpacity] = useState(0.55);
  const svgRef = useRef<SVGSVGElement>(null);

  const T = 32;
  const tensor = useMemo(() => generateAttentionTensor(seed, T, REGIONS.length), [seed]);

  const expertSchema: ExpertSchema = [
    {
      label: '时间',
      fields: [
        { type: 'number', key: 't', label: `帧 / ${T - 1}`, min: 0, max: T - 1, step: 1, value: t, onChange: setT, slider: true },
        { type: 'info', key: 'T', label: '总帧数 T', value: String(T) },
        { type: 'number', key: 'seed', label: '随机种子', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
      ],
    },
    {
      label: '布局',
      fields: [
        { type: 'number', key: 'pad', label: '间隔角（rad）', min: 0, max: 0.2, step: 0.005, value: padAngle, onChange: setPadAngle, slider: true, format: (v) => v.toFixed(3) },
        { type: 'info', key: 'N', label: '脑区数 N', value: String(REGIONS.length) },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'number', key: 'ro', label: '丝带不透明度', min: 0, max: 1, step: 0.05, value: ribbonOpacity, onChange: setRibbonOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
  ];
  const slice = tensor[Math.min(T - 1, Math.max(0, t))];

  const W = 720;
  const H = 720;
  const cx = W / 2;
  const cy = H / 2 - 12;
  const innerR = 240;
  const outerR = 270;

  const palette = sampleColormap(colormap, REGIONS.length);

  const chordGen = chord().padAngle(padAngle).sortSubgroups((a, b) => b - a);
  // d3 ribbon/arc generators carry generic typings that fight with our use
  // of plain JS arc + ribbon objects. Cast the call sites locally rather
  // than importing the half-dozen helper types.
  type AnyArg = unknown;
  const ribbonGen = (ribbon().radius(innerR)) as unknown as (d: AnyArg) => string;
  const arcGen = (d3arc().innerRadius(innerR).outerRadius(outerR)) as unknown as (
    d: AnyArg,
  ) => string;

  const chords = chordGen(slice);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'preictal',
              label: '发作前快照',
              hint: 't=4',
              description: '发作起始前的早期窗口。',
              apply: () => {
                setT(4);
                setRibbonOpacity(0.55);
              },
            },
            {
              id: 'ictal',
              label: '发作期峰值',
              hint: 't=12',
              description: '远距离耦合峰值帧。',
              apply: () => {
                setT(12);
                setRibbonOpacity(0.7);
              },
            },
            {
              id: 'sparse',
              label: '稀疏丝带',
              hint: '极简',
              description: '细丝带 — 减轻密集网络的拥挤。',
              apply: () => {
                setRibbonOpacity(0.3);
                setPadAngle(0.06);
              },
            },
            {
              id: 'cividis',
              label: 'Cividis 色带',
              hint: '色彩',
              description: '和弦轮的色盲友好变体。',
              apply: () => {
                setColormap('cividis');
              },
            },
          ]}
        />
      }
      filename="dynamic-chord"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="时间切片">
            <NumberSlider
              label={`t / ${T - 1}`}
              value={t}
              min={0}
              max={T - 1}
              step={1}
              onChange={setT}
            />
          </ControlGroup>
          <ControlGroup label="配色">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          在时间切片 <code>t</code> 上的
          <code>T × N × N</code> 注意力张量静态快照。外环列出 10 个
          皮层脑区；每条丝带的厚度编码两脑区之间的双向注意力权重。拖动
          <strong>t</strong> 可扫过时间。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={'Dynamic connectivity attention chord · slice $t = ' + t + '$'}
          caption="Synthetic 10×10 attention tensor with phase-shifted hemispheric clustering."
        >
          <g transform={`translate(${cx}, ${cy})`}>
            {chords.groups.map((g, i) => (
              <g key={i}>
                <path d={arcGen(g)} fill={palette[i]} stroke="white" strokeWidth={0.5} />
                {(() => {
                  const angle = (g.startAngle + g.endAngle) / 2 - Math.PI / 2;
                  const r = outerR + 18;
                  const tx = Math.cos(angle) * r;
                  const ty = Math.sin(angle) * r;
                  const rotate = (angle * 180) / Math.PI;
                  return (
                    <text
                      transform={`translate(${tx}, ${ty}) rotate(${rotate})`}
                      textAnchor={Math.cos(angle) < 0 ? 'end' : 'start'}
                      dominantBaseline="middle"
                      fontSize={11}
                      fontWeight={500}
                      fill="#0d1117"
                    >
                      {REGIONS[i]}
                    </text>
                  );
                })()}
              </g>
            ))}
            {chords.map((c, i) => (
              <path
                key={i}
                d={ribbonGen(c)}
                fill={palette[c.source.index]}
                fillOpacity={ribbonOpacity}
                stroke="white"
                strokeWidth={0.4}
              />
            ))}
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'dynamic-chord',
  title: '动态连接注意力图',
  titleEn: 'Dynamic Connectivity Chord',
  category: 'clinical',
  summary:
    '可按时间切片查看的 T × N × N 注意力张量和弦图，具半球聚类。',
  component: DynamicChordChart,
});
