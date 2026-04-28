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

interface CubeSpec {
  T: number;
  C: number;
  F: number;
  label: string;
}

const LAYERS: CubeSpec[] = [
  { T: 250, C: 32, F: 32, label: 'Input EEG/fNIRS' },
  { T: 124, C: 64, F: 32, label: 'TCN d=1' },
  { T: 60, C: 128, F: 32, label: 'TCN d=2' },
  { T: 28, C: 256, F: 32, label: 'TCN d=4' },
  { T: 12, C: 512, F: 32, label: 'TCN d=8' },
];

interface IsoCubeProps {
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
  fill: string;
}

function isoProject(x: number, y: number, z: number, alpha: number) {
  // Cabinet projection: depth axis goes up-right at angle alpha.
  return {
    px: x + z * Math.cos(alpha) * 0.5,
    py: y - z * Math.sin(alpha) * 0.5,
  };
}

function IsometricCube({ x, y, w, h, d, fill }: IsoCubeProps) {
  const alpha = (Math.PI / 180) * 30;
  const front = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ] as Array<[number, number]>;
  const top = [
    [x, y],
    [x + w, y],
    isoProject(x + w, y, d, alpha),
    isoProject(x, y, d, alpha),
  ].map((p) => (Array.isArray(p) ? p : [p.px, p.py])) as Array<[number, number]>;
  const side = [
    [x + w, y],
    [x + w, y + h],
    isoProject(x + w, y + h, d, alpha),
    isoProject(x + w, y, d, alpha),
  ].map((p) => (Array.isArray(p) ? p : [p.px, p.py])) as Array<[number, number]>;

  const polyStr = (pts: Array<[number, number]>) =>
    pts.map((p) => p.join(',')).join(' ');
  return (
    <g>
      <polygon points={polyStr(front)} fill={fill} fillOpacity={0.75} stroke="#0d1117" strokeWidth={1} />
      <polygon points={polyStr(top)} fill={fill} fillOpacity={0.55} stroke="#0d1117" strokeWidth={1} />
      <polygon points={polyStr(side)} fill={fill} fillOpacity={0.4} stroke="#0d1117" strokeWidth={1} />
    </g>
  );
}

function SpatiotemporalCnn() {
  const [colormap, setColormap] = useState<ColormapName>('plasma');
  const [gap, setGap] = useState(60);
  const [showShapes, setShowShapes] = useState(true);
  const [scaleW, setScaleW] = useState(80);
  const svgRef = useRef<SVGSVGElement>(null);

  const expertSchema: ExpertSchema = [
    {
      label: 'Layout',
      fields: [
        { type: 'number', key: 'g', label: 'layer gap (px)', min: 16, max: 200, step: 2, value: gap, onChange: setGap, slider: true },
        { type: 'number', key: 'sw', label: 'time-axis scale (px)', min: 30, max: 200, step: 2, value: scaleW, onChange: setScaleW, slider: true },
      ],
    },
    {
      label: 'Display',
      fields: [
        { type: 'toggle', key: 'sh', label: 'Tensor shape labels', value: showShapes, onChange: setShowShapes },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: 'Architecture',
      fields: [
        { type: 'info', key: 'l', label: 'layers', value: String(LAYERS.length) },
      ],
    },
  ];

  const palette = sampleColormap(colormap, LAYERS.length);

  const W = 960;
  const H = 420;
  const margin = { top: 64, right: 24, bottom: 60, left: 24 };
  // Map T/C/F to cube width/height/depth.
  const dims = useMemo(() => {
    const Tmax = Math.max(...LAYERS.map((l) => l.T));
    const Cmax = Math.max(...LAYERS.map((l) => l.C));
    const Fmax = Math.max(...LAYERS.map((l) => l.F));
    return { Tmax, Cmax, Fmax };
  }, []);

  // Layout cubes left-to-right.
  const layout = useMemo(() => {
    const out: Array<{ x: number; y: number; w: number; h: number; d: number }> = [];
    let x = margin.left;
    LAYERS.forEach((l) => {
      const w = 30 + (l.T / dims.Tmax) * scaleW;
      const h = 80 + (l.C / dims.Cmax) * 130;
      const d = 30 + (l.F / dims.Fmax) * 60;
      const y = margin.top + (240 - h) / 2;
      out.push({ x, y, w, h, d });
      x += w + d * 0.5 + gap;
    });
    return out;
  }, [dims, gap, scaleW, margin.left, margin.top]);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'wide',
              label: 'Wide layer pipe',
              hint: 'figure',
              description: 'Wider tensor blocks for inline figures.',
              apply: () => {
                setScaleW(96);
                setGap(72);
                setShowShapes(true);
              },
            },
            {
              id: 'compact',
              label: 'Compact pipe',
              hint: 'paper',
              description: 'Tight spacing — column-width figure.',
              apply: () => {
                setScaleW(64);
                setGap(40);
                setShowShapes(true);
              },
            },
            {
              id: 'shapesoff',
              label: 'Shapes off',
              hint: 'minimal',
              description: 'Hide tensor labels for slide presentations.',
              apply: () => {
                setShowShapes(false);
              },
            },
            {
              id: 'viridis',
              label: 'Viridis palette',
              hint: 'palette',
              description: 'Switch from plasma to viridis.',
              apply: () => {
                setColormap('viridis');
              },
            },
          ]}
        />
      }
      filename="spatiotemporal-cnn"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="Spacing">
            <NumberSlider
              label="layer gap"
              value={gap}
              min={30}
              max={140}
              step={4}
              onChange={setGap}
            />
          </ControlGroup>
          <ControlGroup label="Palette">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Pseudo-3D feature volumes drawn in cabinet projection. Width
          encodes the time dimension <code>T</code>, height encodes channels{' '}
          <code>C</code>, and depth encodes the temporal receptive field{' '}
          <code>F</code>. Dilation factors are annotated above each cube.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={'Spatiotemporal CNN architecture · $T \\times C \\times F$'}
          caption="Cabinet projection. Dilation factors increase exponentially in the temporal axis."
        >
          {layout.map((l, i) => (
            <g key={i}>
              <IsometricCube x={l.x} y={l.y} w={l.w} h={l.h} d={l.d} fill={palette[i]} />
              {/* Layer label */}
              <text
                x={l.x + l.w / 2}
                y={l.y - 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={600}
                fill="#0d1117"
              >
                {LAYERS[i].label}
              </text>
              {showShapes ? (
                <text
                  x={l.x + l.w / 2}
                  y={l.y + l.h + 36}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="#334155"
                >
                  T={LAYERS[i].T}, C={LAYERS[i].C}, F={LAYERS[i].F}
                </text>
              ) : null}
              {/* Connector */}
              {i < layout.length - 1 ? (
                <path
                  d={`M${l.x + l.w + l.d * 0.5},${l.y + l.h / 2} L${layout[i + 1].x},${layout[i + 1].y + layout[i + 1].h / 2}`}
                  stroke="#0d1117"
                  strokeWidth={1.2}
                  fill="none"
                  markerEnd="url(#st-arrow)"
                />
              ) : null}
            </g>
          ))}
          <defs>
            <marker id="st-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 Z" fill="#0d1117" />
            </marker>
          </defs>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'spatiotemporal-cnn',
  title: 'Spatiotemporal CNN Architecture',
  titleZh: '时空卷积架构示意图',
  category: 'architecture',
  summary:
    'Cabinet-projection cube sequence visualising T × C × F tensor evolution through dilated TCN blocks.',
  component: SpatiotemporalCnn,
});
