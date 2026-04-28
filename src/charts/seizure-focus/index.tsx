import { useMemo, useRef, useState } from 'react';
import { contours } from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import { mulberry32, randn } from '../../lib/random';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

interface AnatomicalLandmark {
  name: string;
  /** Coordinates in unit head disc. */
  x: number;
  y: number;
}

const LANDMARKS: AnatomicalLandmark[] = [
  { name: 'F. lobe', x: 0.0, y: 0.55 },
  { name: 'L. temp.', x: -0.65, y: 0.05 },
  { name: 'R. temp.', x: 0.65, y: 0.05 },
  { name: 'Parietal', x: 0.0, y: -0.35 },
  { name: 'Occipital', x: 0.0, y: -0.78 },
];

interface FocusBlob {
  cx: number;
  cy: number;
  amp: number;
  sigma: number;
}

function generateFocusField(seed: number, gridSize: number): number[] {
  const rng = mulberry32(seed);
  const blobs: FocusBlob[] = [
    { cx: -0.4, cy: -0.05, amp: 1.2, sigma: 0.18 }, // primary focus, left temporal
    { cx: -0.15, cy: 0.18, amp: 0.55, sigma: 0.22 },
    { cx: 0.4, cy: -0.4, amp: 0.32, sigma: 0.32 },
  ];
  const values: number[] = new Array(gridSize * gridSize).fill(0);
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = (j / (gridSize - 1)) * 2 - 1;
      const y = (i / (gridSize - 1)) * 2 - 1;
      if (x * x + y * y > 1) {
        values[i * gridSize + j] = 0;
        continue;
      }
      let v = 0;
      for (const b of blobs) {
        const d2 = (x - b.cx) ** 2 + (y - b.cy) ** 2;
        v += b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
      }
      v += randn(rng) * 0.04;
      values[i * gridSize + j] = Math.max(0, v);
    }
  }
  return values;
}

function SeizureFocusChart() {
  const [gridSize, setGridSize] = useState(60);
  const [thresholds, setThresholds] = useState(8);
  const [colormap, setColormap] = useState<ColormapName>('inferno');
  const [showLandmarks, setShowLandmarks] = useState(true);
  const [seed, setSeed] = useState(31);
  const [labelOpacity, setLabelOpacity] = useState(0.7);
  const svgRef = useRef<SVGSVGElement>(null);

  const field = useMemo(() => generateFocusField(seed, gridSize), [seed, gridSize]);

  const expertSchema: ExpertSchema = [
    {
      label: 'Grid',
      fields: [
        { type: 'number', key: 'grid', label: 'resolution', min: 16, max: 240, step: 2, value: gridSize, onChange: setGridSize, slider: true },
        { type: 'number', key: 'seed', label: 'seed', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
      ],
    },
    {
      label: 'Contours',
      fields: [
        { type: 'number', key: 't', label: 'threshold count', min: 2, max: 32, step: 1, value: thresholds, onChange: setThresholds, slider: true },
      ],
    },
    {
      label: 'Display',
      fields: [
        { type: 'toggle', key: 'lm', label: 'Anatomical landmarks', value: showLandmarks, onChange: setShowLandmarks },
        { type: 'number', key: 'lo', label: 'landmark opacity', min: 0, max: 1, step: 0.05, value: labelOpacity, onChange: setLabelOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
  ];
  const max = useMemo(() => Math.max(...field), [field]);

  const W = 640;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2 - 24;
  const radius = 240;

  const interp = getColormap(colormap);

  // Build contour polygons.
  const contourGen = useMemo(() => {
    const t = Array.from(
      { length: thresholds },
      (_, i) => ((i + 1) / thresholds) * max,
    );
    return contours().size([gridSize, gridSize]).thresholds(t)(field);
  }, [field, gridSize, max, thresholds]);

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'crisp',
              label: 'Crisp focus',
              hint: 'figure',
              description: 'High grid + many thresholds — sharp contour rings.',
              apply: () => {
                setGridSize(96);
                setThresholds(12);
                setShowLandmarks(true);
              },
            },
            {
              id: 'fast',
              label: 'Quick preview',
              hint: 'preview',
              description: 'Coarse grid for fast rerender during exploration.',
              apply: () => {
                setGridSize(40);
                setThresholds(6);
              },
            },
            {
              id: 'reseed',
              label: 'Resample focus',
              hint: 'shuffle',
              description: 'Move the synthetic focus to a new location.',
              apply: () => {
                setSeed((s) => s + 1);
              },
            },
            {
              id: 'magma',
              label: 'Magma palette',
              hint: 'palette',
              description: 'Warm magma instead of inferno for thermal contrast.',
              apply: () => {
                setColormap('magma');
              },
            },
          ]}
        />
      }
      filename="seizure-focus"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="Grid">
            <NumberSlider
              label="resolution"
              value={gridSize}
              min={30}
              max={120}
              step={4}
              onChange={setGridSize}
            />
          </ControlGroup>
          <ControlGroup label="Contours">
            <NumberSlider
              label="threshold count"
              value={thresholds}
              min={3}
              max={16}
              step={1}
              onChange={setThresholds}
            />
          </ControlGroup>
          <ControlGroup label="Display">
            <Toggle label="Anatomical landmarks" checked={showLandmarks} onChange={setShowLandmarks} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Importance scores from a graph attention classifier are
          interpolated to a grid and contoured. The hottest blob
          corresponds to the seizure focus; secondary blobs hint at
          propagation. Anatomical labels are decorative; swap them for
          your own atlas as needed.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="Seizure focus localisation"
          caption="d3-contour over a 2D importance grid clipped to the unit head disc."
        >
          <defs>
            <clipPath id="focus-clip" clipPathUnits="userSpaceOnUse">
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
          </defs>
          {/* Head outline (decorative; field is already zero outside disc) */}
          <circle cx={cx} cy={cy} r={radius} fill="#fafafa" stroke="#0d1117" strokeWidth={1.5} />

          <g clipPath="url(#focus-clip)">
            {contourGen.flatMap((c, i) => {
              const t = (i + 1) / contourGen.length;
              const fill = interp(t);
              const stroke = interp(Math.min(1, t + 0.1));
              const strokeW = 0.8;
              return c.coordinates.flatMap((polygon, pi) =>
                polygon.map((ring, ri) => {
                  const points = ring
                    .map(([x, y]) => {
                      const px = cx - radius + x * ((2 * radius) / (gridSize - 1));
                      const py = cy - radius + y * ((2 * radius) / (gridSize - 1));
                      return `${px.toFixed(2)},${py.toFixed(2)}`;
                    })
                    .join(' ');
                  return (
                    <polygon
                      key={`${i}-${pi}-${ri}`}
                      points={points}
                      fill={ri === 0 ? fill : '#fafafa'}
                      fillOpacity={ri === 0 ? 0.65 : 1}
                      stroke={stroke}
                      strokeWidth={strokeW}
                      strokeOpacity={ri === 0 ? 0.85 : 0}
                    />
                  );
                }),
              );
            })}
          </g>

          {/* Landmarks */}
          {showLandmarks
            ? LANDMARKS.map((l) => (
                <g
                  key={l.name}
                  transform={`translate(${cx + l.x * radius}, ${cy - l.y * radius})`}
                  opacity={labelOpacity}
                >
                  <circle r={3} fill="#0d1117" />
                  <text x={6} y={4} fontSize={11} fontWeight={500} fill="#0d1117">
                    {l.name}
                  </text>
                </g>
              ))
            : null}

          {/* Color bar */}
          <g transform={`translate(${cx + radius + 24}, ${cy - radius})`}>
            {Array.from({ length: 32 }).map((_, k) => {
              const t = k / 31;
              return (
                <rect
                  key={k}
                  x={0}
                  y={(1 - t) * (2 * radius) - radius / 16}
                  width={14}
                  height={radius / 16 + 1}
                  fill={interp(t)}
                />
              );
            })}
            <rect x={0} y={0} width={14} height={2 * radius} fill="none" stroke="#0d1117" strokeOpacity={0.4} />
            {[0, 0.5, 1].map((t) => (
              <text
                key={t}
                x={20}
                y={(1 - t) * 2 * radius + 4}
                fontSize={10}
                fontFamily='"JetBrains Mono", monospace'
                fill="#0d1117"
              >
                {(t * max).toFixed(2)}
              </text>
            ))}
            <text
              transform={`translate(54, ${radius}) rotate(-90)`}
              textAnchor="middle"
              fontSize={11}
              fill="#0d1117"
            >
              Focus score
            </text>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'seizure-focus',
  title: 'Seizure Focus Localisation',
  titleZh: '癫痫病灶定位矢量图',
  category: 'clinical',
  summary:
    'Contour map of GAT importance scores over the head disc with anatomical landmark overlays.',
  component: SeizureFocusChart,
});
