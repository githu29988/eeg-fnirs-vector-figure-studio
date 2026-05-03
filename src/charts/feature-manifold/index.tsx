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
      label: 'Embedding',
      fields: [
        { type: 'select', key: 'emb', label: 'algorithm', value: embedding, onChange: (v) => setEmbedding(v as Embedding), options: [
          { value: 'umap-like', label: 'UMAP-like' },
          { value: 'tsne-like', label: 't-SNE-like' },
        ] },
        { type: 'number', key: 'seed', label: 'seed override', min: 0, max: 9999, step: 1, value: seed, onChange: setSeedOverride },
      ],
    },
    {
      label: 'Density',
      fields: [
        { type: 'number', key: 'pc', label: 'points / class', min: 20, max: 5000, step: 10, value: perClass, onChange: setPerClass, slider: true },
        { type: 'number', key: 'sp', label: 'cluster spread', min: 0.05, max: 2, step: 0.01, value: spread, onChange: setSpread, slider: true, format: (v) => v.toFixed(2) },
      ],
    },
    {
      label: 'Display',
      fields: [
        { type: 'toggle', key: 'el', label: 'Confidence ellipses', value: showEllipses, onChange: setShowEllipses },
        { type: 'number', key: 'pr', label: 'point radius (px)', min: 0.5, max: 6, step: 0.1, value: pointRadius, onChange: setPointRadius, slider: true, format: (v) => v.toFixed(1) },
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
              label: 'Tight clusters',
              hint: 'separable',
              description: 'Low spread, ellipses on — separability story.',
              apply: () => {
                setSpread(0.35);
                setShowEllipses(true);
              },
            },
            {
              id: 'overlap',
              label: 'Overlapping clusters',
              hint: 'difficult',
              description: 'High spread — motivates richer features.',
              apply: () => {
                setSpread(1.1);
                setShowEllipses(true);
              },
            },
            {
              id: 'tsne',
              label: 't-SNE-like view',
              hint: 'embedding',
              description: 'Switch projection method to t-SNE-like.',
              apply: () => {
                setEmbedding('tsne-like');
              },
            },
            {
              id: 'umap',
              label: 'UMAP-like view',
              hint: 'embedding',
              description: 'Switch back to the UMAP-style projection.',
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
          <ControlGroup label="Embedding">
            <Select
              label="Algorithm"
              value={embedding}
              options={[
                { value: 'umap-like', label: 'UMAP-like' },
                { value: 'tsne-like', label: 't-SNE-like' },
              ]}
              onChange={setEmbedding}
            />
          </ControlGroup>
          <ControlGroup label="Density">
            <NumberSlider
              label="points per class"
              value={perClass}
              min={50}
              max={1500}
              step={10}
              onChange={setPerClass}
            />
            <NumberSlider
              label="cluster spread"
              value={spread}
              min={0.2}
              max={1.6}
              step={0.05}
              onChange={setSpread}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="Annotations">
            <Toggle
              label="95% confidence ellipses"
              checked={showEllipses}
              onChange={setShowEllipses}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          A synthetic 4-class manifold with seeded Gaussian clusters. The
          axes are unitless embedding coordinates. Confidence ellipses use
          the per-class 2×2 covariance with a χ² cutoff of 5.991 (95%).
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
  summary: '按类别上色的二维嵌入散点，可选叠加每类 95% 置信椭圆。',
  component: FeatureManifold,
});
