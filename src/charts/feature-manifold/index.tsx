import { useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Select,
  Toggle,
} from '../../components/Controls';
import { XAxis, YAxis } from '../../components/Axis';
import { buildLinearAxis } from '../../lib/scales';
import { sampleColormap } from '../../lib/colormaps';
import { generateClusterCloud } from '../../lib/synthetic';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { computeConfidenceEllipse } from './ellipse';

type Embedding = 'tsne-like' | 'umap-like';

const CLASS_LABELS = ['Inter-ictal', 'Pre-ictal', 'Ictal', 'Post-ictal'];

function FeatureManifold() {
  const [perClass, setPerClass] = useState(220);
  const [spread, setSpread] = useState(0.6);
  const [showEllipses, setShowEllipses] = useState(true);
  const [embedding, setEmbedding] = useState<Embedding>('umap-like');
  const [seedOverride, setSeedOverride] = useState<number | null>(null);
  const [pointRadius, setPointRadius] = useState(2.4);
  const svgRef = useRef<SVGSVGElement>(null);

  const seed = seedOverride ?? (embedding === 'umap-like' ? 19 : 23);
  const points = useMemo(
    () => generateClusterCloud(seed, CLASS_LABELS.length, perClass, spread),
    [seed, perClass, spread],
  );

  const expertSchema: ExpertSchema = [
    {
      label: '嵌入',
      fields: [
        { type: 'select', key: 'emb', label: '算法', value: embedding, onChange: (v) => setEmbedding(v as Embedding), options: [
          { value: 'umap-like', label: 'UMAP-like' },
          { value: 'tsne-like', label: 't-SNE-like' },
        ] },
        { type: 'number', key: 'seed', label: '随机种子覆写', min: 0, max: 9999, step: 1, value: seed, onChange: setSeedOverride },
      ],
    },
    {
      label: '密度',
      fields: [
        { type: 'number', key: 'pc', label: '每类点数', min: 20, max: 5000, step: 10, value: perClass, onChange: setPerClass, slider: true },
        { type: 'number', key: 'sp', label: '簇扩散度', min: 0.05, max: 2, step: 0.01, value: spread, onChange: setSpread, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'el', label: '置信椭圆', value: showEllipses, onChange: setShowEllipses },
        { type: 'number', key: 'pr', label: '点半径（px）', min: 0.5, max: 6, step: 0.1, value: pointRadius, onChange: setPointRadius, slider: true, format: (v) => v.toFixed(1) },
      ],
    },
  ];

  const W = 720;
  const H = 540;
  const margin = { top: 36, right: 24, bottom: 56, left: 56 };
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;

  // Auto-fit axes.
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const pad = 0.6;
  const xAxis = buildLinearAxis({
    domain: [Math.min(...xs) - pad, Math.max(...xs) + pad],
    range: [0, innerW],
    tickCount: 6,
    nice: true,
  });
  const yAxis = buildLinearAxis({
    domain: [Math.min(...ys) - pad, Math.max(...ys) + pad],
    range: [innerH, 0],
    tickCount: 6,
    nice: true,
  });

  const palette = sampleColormap('viridis', CLASS_LABELS.length);

  const ellipses = useMemo(() => {
    return CLASS_LABELS.map((_, c) => {
      const cls = points.filter((p) => p.label === c);
      return computeConfidenceEllipse(cls);
    });
  }, [points]);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'tight',
              label: '紧实簇',
              hint: '可分',
              description: '低扩散度、启用椭圆 — 可分性叙事。',
              apply: () => {
                setSpread(0.35);
                setShowEllipses(true);
              },
            },
            {
              id: 'overlap',
              label: '重叠簇',
              hint: '艰难',
              description: '高扩散度 — 驱动更丰富的特征。',
              apply: () => {
                setSpread(1.1);
                setShowEllipses(true);
              },
            },
            {
              id: 'tsne',
              label: 't-SNE 视图',
              hint: '嵌入',
              description: '切换投影方法为 t-SNE-like。',
              apply: () => {
                setEmbedding('tsne-like');
              },
            },
            {
              id: 'umap',
              label: 'UMAP 视图',
              hint: '嵌入',
              description: '切回 UMAP-like 投影。',
              apply: () => {
                setEmbedding('umap-like');
              },
            },
          ]}
        />
      }
      filename="feature-manifold"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="嵌入">
            <Select
              label="算法"
              value={embedding}
              options={[
                { value: 'umap-like', label: 'UMAP-like' },
                { value: 'tsne-like', label: 't-SNE-like' },
              ]}
              onChange={setEmbedding}
            />
          </ControlGroup>
          <ControlGroup label="密度">
            <NumberSlider
              label="每类点数"
              value={perClass}
              min={50}
              max={1500}
              step={10}
              onChange={setPerClass}
            />
            <NumberSlider
              label="簇扩散度"
              value={spread}
              min={0.2}
              max={1.6}
              step={0.05}
              onChange={setSpread}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="标注">
            <Toggle
              label="95% 置信椭圆"
              checked={showEllipses}
              onChange={setShowEllipses}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          使用随机种子高斯簇生成的合成 4 类流形。坐标轴为无量纲嵌入坐标。置信
          椭圆使用每类的 2×2 协方差与 χ² 阈值 5.991（95%）。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={`Feature manifold · ${embedding === 'umap-like' ? 'UMAP-like' : 't-SNE-like'} embedding`}
          caption="Synthetic clusters; coordinates are unitless. Marker = sample."
        >
          <g transform={`translate(${margin.left}, ${margin.top})`}>
            <YAxis axis={yAxis} offset={0} label="dim 2" gridExtent={innerW} />
            <XAxis axis={xAxis} offset={innerH} label="dim 1" gridExtent={innerH} />

            {points.map((p, i) => (
              <circle
                key={i}
                cx={xAxis.scale(p.x)}
                cy={yAxis.scale(p.y)}
                r={pointRadius}
                fill={palette[p.label]}
                fillOpacity={0.55}
              />
            ))}

            {showEllipses
              ? ellipses.map((e, i) =>
                  e ? (
                    <ellipse
                      key={i}
                      cx={xAxis.scale(e.cx)}
                      cy={yAxis.scale(e.cy)}
                      rx={Math.abs(xAxis.scale(e.cx + e.rx) - xAxis.scale(e.cx))}
                      ry={Math.abs(yAxis.scale(e.cy + e.ry) - yAxis.scale(e.cy))}
                      transform={`rotate(${(-e.angle * 180) / Math.PI}, ${xAxis.scale(e.cx)}, ${yAxis.scale(e.cy)})`}
                      fill="none"
                      stroke={palette[i]}
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                    />
                  ) : null,
                )
              : null}

            {/* Legend */}
            <g transform={`translate(${innerW - 160}, 12)`}>
              <rect
                width={160}
                height={CLASS_LABELS.length * 18 + 12}
                rx={4}
                fill="white"
                fillOpacity={0.9}
                stroke="currentColor"
                strokeOpacity={0.3}
              />
              {CLASS_LABELS.map((l, i) => (
                <g key={l} transform={`translate(10, ${(i + 0.7) * 18})`}>
                  <circle r={5} fill={palette[i]} />
                  <text x={14} y={4} fontSize={11} fill="currentColor">
                    {l}
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
  id: 'feature-manifold',
  title: '特征流形可视化',
  titleEn: 'Feature Manifold (t-SNE / UMAP)',
  category: 'evaluation',
  summary:
    '按类别著色的二维嵌入散点图，可选启用每类 95% 置信植圆。',
  component: FeatureManifold,
});
