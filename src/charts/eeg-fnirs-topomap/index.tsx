import { useMemo, useRef, useState } from 'react';
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
import {
  EEG_10_20,
  FNIRS_OPTODES,
  FNIRS_PAIRS,
  getOptode,
} from './positions';

interface ScalpField {
  /** Activation values for each EEG electrode, normalised to [-1, 1]. */
  values: number[];
}

function generateScalpField(seed: number): ScalpField {
  const rng = mulberry32(seed);
  // Two Gaussian sources on the scalp.
  const blobs = [
    { cx: -0.4, cy: 0.4, amp: 1.0, sigma: 0.45 },
    { cx: 0.5, cy: -0.4, amp: -0.8, sigma: 0.5 },
  ];
  const values = EEG_10_20.map((e) => {
    let v = 0;
    for (const b of blobs) {
      const d2 = (e.x - b.cx) ** 2 + (e.y - b.cy) ** 2;
      v += b.amp * Math.exp(-d2 / (2 * b.sigma * b.sigma));
    }
    v += randn(rng) * 0.06;
    return v;
  });
  const max = Math.max(...values.map(Math.abs));
  return { values: values.map((v) => v / (max || 1)) };
}

function interpolateAtPoint(x: number, y: number, field: ScalpField): number {
  // Inverse-distance-weighted interpolation, p=2.
  let num = 0;
  let den = 0;
  for (let i = 0; i < EEG_10_20.length; i++) {
    const e = EEG_10_20[i];
    const d2 = (x - e.x) ** 2 + (y - e.y) ** 2;
    const w = 1 / (d2 + 0.005);
    num += w * field.values[i];
    den += w;
  }
  return num / den;
}

function TopomapChart() {
  const [showEeg, setShowEeg] = useState(true);
  const [showFnirs, setShowFnirs] = useState(true);
  const [eegOpacity, setEegOpacity] = useState(0.6);
  const [colormap, setColormap] = useState<ColormapName>('coolwarm');
  const [resolution, setResolution] = useState(48);
  const [seed, setSeed] = useState(7);
  const [showLabels, setShowLabels] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const field = useMemo(() => generateScalpField(seed), [seed]);

  const expertSchema: ExpertSchema = [
    {
      label: 'Layers',
      fields: [
        { type: 'toggle', key: 'eeg', label: 'EEG topomap layer', value: showEeg, onChange: setShowEeg },
        { type: 'toggle', key: 'fnirs', label: 'fNIRS optodes layer', value: showFnirs, onChange: setShowFnirs },
        { type: 'toggle', key: 'lbl', label: 'Channel labels', value: showLabels, onChange: setShowLabels },
      ],
    },
    {
      label: 'EEG field',
      fields: [
        { type: 'number', key: 'op', label: 'opacity', min: 0, max: 1, step: 0.05, value: eegOpacity, onChange: setEegOpacity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'number', key: 'res', label: 'grid resolution', min: 12, max: 160, step: 2, value: resolution, onChange: setResolution, slider: true },
        { type: 'number', key: 'seed', label: 'seed', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
      ],
    },
    {
      label: 'Hardware',
      fields: [
        { type: 'info', key: 'eN', label: 'EEG electrodes', value: String(EEG_10_20.length) },
        { type: 'info', key: 'oN', label: 'fNIRS optodes', value: String(FNIRS_OPTODES.length) },
        { type: 'info', key: 'pN', label: 'fNIRS S–D pairs', value: String(FNIRS_PAIRS.length) },
      ],
    },
  ];

  const W = 640;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2 - 24;
  const radius = 240;

  const interp = getColormap(colormap);

  // Build a coarse rectangular grid clipped to the head circle.
  const grid = useMemo(() => {
    const pixels: { x: number; y: number; v: number }[] = [];
    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const u = (i + 0.5) / resolution;
        const v = (j + 0.5) / resolution;
        const xUnit = u * 2 - 1;
        const yUnit = v * 2 - 1;
        if (xUnit * xUnit + yUnit * yUnit > 1) continue;
        const value = interpolateAtPoint(xUnit, yUnit, field);
        pixels.push({
          x: cx + xUnit * radius,
          y: cy - yUnit * radius,
          v: value,
        });
      }
    }
    return pixels;
  }, [field, resolution, cx, cy, radius]);

  const cellSize = (2 * radius) / resolution;
  const tFromV = (v: number) => 0.5 + v * 0.5;

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'eeg',
              label: 'EEG only',
              hint: 'modal',
              description: 'Hide fNIRS — inspect alpha/beta scalp pattern.',
              apply: () => {
                setShowEeg(true);
                setShowFnirs(false);
                setEegOpacity(1);
                setShowLabels(true);
              },
            },
            {
              id: 'fnirs',
              label: 'fNIRS only',
              hint: 'modal',
              description: 'Hide EEG — see HbO/HbR optical channels.',
              apply: () => {
                setShowEeg(false);
                setShowFnirs(true);
                setShowLabels(true);
              },
            },
            {
              id: 'fused',
              label: 'Fused multimodal',
              hint: 'figure',
              description: 'Both modalities, semi-transparent overlay.',
              apply: () => {
                setShowEeg(true);
                setShowFnirs(true);
                setEegOpacity(0.55);
                setShowLabels(true);
              },
            },
            {
              id: 'highres',
              label: 'High-res grid',
              hint: 'export',
              description: 'Resolution 96 for poster-grade interpolation.',
              apply: () => {
                setResolution(96);
              },
            },
          ]}
        />
      }
      filename="eeg-fnirs-topomap"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="Layers">
            <Toggle label="Show EEG topomap" checked={showEeg} onChange={setShowEeg} />
            <Toggle label="Show fNIRS optodes" checked={showFnirs} onChange={setShowFnirs} />
          </ControlGroup>
          <ControlGroup label="EEG layer opacity">
            <NumberSlider
              label="opacity"
              value={eegOpacity}
              min={0}
              max={1}
              step={0.05}
              onChange={setEegOpacity}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="Interpolation grid">
            <NumberSlider
              label="resolution"
              value={resolution}
              min={20}
              max={80}
              step={4}
              onChange={setResolution}
            />
          </ControlGroup>
          <ControlGroup label="Color map">
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Azimuthal equidistant projection of the 10-20 system over the unit
          head disc. The EEG layer is an inverse-distance interpolation over
          a square grid clipped to the head circle. fNIRS source–detector
          pairs are drawn as Banana-shape arcs to evoke the typical photon
          path between neighbouring optodes.
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title="EEG–fNIRS co-registration topomap"
          caption="Synthetic dipolar scalp field with overlaid 10-20 electrodes and fNIRS optodes."
        >
          <defs>
            <clipPath id="head-clip">
              <circle cx={cx} cy={cy} r={radius} />
            </clipPath>
          </defs>

          {/* Head outline + nose + ears */}
          <g fill="none" stroke="#0d1117" strokeWidth={1.5}>
            <circle cx={cx} cy={cy} r={radius} />
            {/* Nose */}
            <polyline
              points={`${cx - 14},${cy - radius + 4} ${cx},${cy - radius - 22} ${cx + 14},${cy - radius + 4}`}
            />
            {/* Ears */}
            <ellipse cx={cx - radius} cy={cy} rx={10} ry={28} />
            <ellipse cx={cx + radius} cy={cy} rx={10} ry={28} />
          </g>

          {/* EEG topomap heat layer */}
          {showEeg ? (
            <g clipPath="url(#head-clip)" opacity={eegOpacity}>
              {grid.map((p, i) => (
                <rect
                  key={i}
                  x={p.x - cellSize / 2}
                  y={p.y - cellSize / 2}
                  width={cellSize + 1}
                  height={cellSize + 1}
                  fill={interp(tFromV(p.v))}
                />
              ))}
            </g>
          ) : null}

          {/* EEG electrodes */}
          {EEG_10_20.map((e, i) => (
            <g
              key={e.name}
              transform={`translate(${cx + e.x * radius}, ${cy - e.y * radius})`}
            >
              <circle r={5} fill="white" stroke="#0d1117" strokeWidth={1} />
              <circle r={3} fill={showEeg ? interp(tFromV(field.values[i])) : '#0d1117'} />
              {showLabels ? (
                <text
                  x={6}
                  y={-6}
                  fontSize={10}
                  fontFamily='"JetBrains Mono", monospace'
                  fill="#0d1117"
                >
                  {e.name}
                </text>
              ) : null}
            </g>
          ))}

          {/* fNIRS optodes + pairs */}
          {showFnirs ? (
            <g>
              {FNIRS_PAIRS.map((p, i) => {
                const a = getOptode(p.source);
                const b = getOptode(p.detector);
                if (!a || !b) return null;
                const ax = cx + a.x * radius;
                const ay = cy - a.y * radius;
                const bx = cx + b.x * radius;
                const by = cy - b.y * radius;
                // Banana-shape: cubic bezier bulging upwards.
                const ux = (by - ay) / Math.hypot(bx - ax, by - ay);
                const uy = -(bx - ax) / Math.hypot(bx - ax, by - ay);
                const bulge = 14;
                const c1 = [ax + ux * bulge, ay + uy * bulge];
                const c2 = [bx + ux * bulge, by + uy * bulge];
                return (
                  <path
                    key={i}
                    d={`M${ax},${ay} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${bx},${by}`}
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    fill="none"
                    opacity={0.5}
                  />
                );
              })}
              {FNIRS_OPTODES.map((o) => (
                <g
                  key={o.name}
                  transform={`translate(${cx + o.x * radius}, ${cy - o.y * radius})`}
                >
                  {o.type === 'source' ? (
                    <rect x={-4} y={-4} width={8} height={8} fill="#dc2626" stroke="white" />
                  ) : (
                    <rect
                      x={-4}
                      y={-4}
                      width={8}
                      height={8}
                      fill="#1d4ed8"
                      stroke="white"
                      transform="rotate(45)"
                    />
                  )}
                  {showLabels ? (
                    <text
                      x={6}
                      y={-6}
                      fontSize={9}
                      fontFamily='"JetBrains Mono", monospace'
                      fill={o.type === 'source' ? '#7f1d1d' : '#1e3a8a'}
                    >
                      {o.name}
                    </text>
                  ) : null}
                </g>
              ))}
            </g>
          ) : null}

          {/* Legend */}
          <g transform={`translate(${cx - radius}, ${cy + radius + 32})`}>
            <g>
              <rect x={0} y={-5} width={10} height={10} fill="#dc2626" />
              <text x={16} y={4} fontSize={11} fill="currentColor">
                fNIRS source
              </text>
            </g>
            <g transform="translate(120, 0)">
              <rect x={0} y={-5} width={10} height={10} fill="#1d4ed8" transform="rotate(45)" />
              <text x={16} y={4} fontSize={11} fill="currentColor">
                fNIRS detector
              </text>
            </g>
            <g transform="translate(260, 0)">
              <line x1={0} y1={0} x2={20} y2={0} stroke="#fbbf24" strokeWidth={1.5} />
              <text x={26} y={4} fontSize={11} fill="currentColor">
                Photon path (S→D)
              </text>
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'eeg-fnirs-topomap',
  title: 'EEG–fNIRS Co-registration Topomap',
  titleZh: '脑电-近红外共注册拓扑图',
  category: 'physiology',
  summary:
    'Azimuthal-equidistant 10-20 head map overlaid with fNIRS source/detector pairs and Banana-shape photon paths.',
  component: TopomapChart,
});
