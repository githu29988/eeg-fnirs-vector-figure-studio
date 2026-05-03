import { useMemo, useRef, useState } from 'react';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceCollide,
  type Simulation,
} from 'd3';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import {
  ColormapSelect,
  ControlGroup,
  NumberSlider,
  Toggle,
} from '../../components/Controls';
import { mulberry32 } from '../../lib/random';
import { getColormap, type ColormapName } from '../../lib/colormaps';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';

interface GraphNode {
  id: string;
  group: 'EEG' | 'fNIRS';
  /** Optional fixed x/y for force simulation. */
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
  alpha: number;
}

function generateGraph(
  seed: number,
  eegN: number,
  fnirsN: number,
  density: number,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const rng = mulberry32(seed);
  const nodes: GraphNode[] = [];
  for (let i = 0; i < eegN; i++) nodes.push({ id: `E${i + 1}`, group: 'EEG' });
  for (let i = 0; i < fnirsN; i++) nodes.push({ id: `F${i + 1}`, group: 'fNIRS' });
  const links: GraphLink[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // Cross-modal pairs are denser to mimic attention bridges.
      const cross = nodes[i].group !== nodes[j].group;
      const p = (cross ? 1.4 : 0.7) * density;
      if (rng() < p) {
        const alpha = Math.pow(rng(), 1.6);
        links.push({ source: nodes[i].id, target: nodes[j].id, alpha });
      }
    }
  }
  return { nodes, links };
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

function HeGATChart() {
  const [eegN, setEegN] = useState(10);
  const [fnirsN, setFnirsN] = useState(10);
  const [density, setDensity] = useState(0.32);
  const [colormap, setColormap] = useState<ColormapName>('viridis');
  const [showLabels, setShowLabels] = useState(true);
  const [seed, setSeed] = useState(7);
  const [iterations, setIterations] = useState(250);
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes, links } = useMemo(
    () => generateGraph(seed, eegN, fnirsN, density),
    [seed, eegN, fnirsN, density],
  );

  const expertSchema: ExpertSchema = [
    {
      label: '节点',
      fields: [
        { type: 'number', key: 'e', label: 'EEG 节点数', min: 2, max: 64, step: 1, value: eegN, onChange: setEegN, slider: true },
        { type: 'number', key: 'f', label: 'fNIRS 节点数', min: 2, max: 64, step: 1, value: fnirsN, onChange: setFnirsN, slider: true },
      ],
    },
    {
      label: '边',
      fields: [
        { type: 'number', key: 'd', label: '密度', min: 0.05, max: 0.9, step: 0.01, value: density, onChange: setDensity, slider: true, format: (v) => v.toFixed(2) },
        { type: 'number', key: 'seed', label: '随机种子', min: 0, max: 9999, step: 1, value: seed, onChange: setSeed },
      ],
    },
    {
      label: '力导向布局',
      fields: [
        { type: 'number', key: 'it', label: '仿真迭代次数', min: 50, max: 1500, step: 10, value: iterations, onChange: setIterations, slider: true },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'lbl', label: '节点标签', value: showLabels, onChange: setShowLabels },
        { type: 'colormap', key: 'cmap', value: colormap, onChange: setColormap },
        { type: 'info', key: 'l', label: '渲染边数', value: String(links.length) },
      ],
    },
  ];

  const W = 720;
  const H = 540;
  const cx = W / 2;
  const cy = H / 2 - 16;
  const interp = getColormap(colormap);

  // Run a fixed-iteration force simulation deterministically.
  const positions = useMemo(() => {
    const simNodes: SimNode[] = nodes.map((n, i) => ({
      ...n,
      x: cx + Math.cos((i * 2 * Math.PI) / nodes.length) * 120,
      y: cy + Math.sin((i * 2 * Math.PI) / nodes.length) * 120,
    }));
    const simLinks = links.map((l) => ({ ...l }));
    const sim: Simulation<SimNode, undefined> = forceSimulation(simNodes)
      .force(
        'link',
        forceLink(simLinks)
          .id((d) => (d as SimNode).id)
          .distance(140)
          .strength((d) => 0.1 + 0.9 * (d as unknown as GraphLink).alpha),
      )
      .force('charge', forceManyBody().strength(-220))
      .force('center', forceCenter(cx, cy))
      .force('collide', forceCollide(18))
      .stop();
    for (let i = 0; i < iterations; i++) sim.tick();
    return simNodes;
  }, [nodes, links, cx, cy, iterations]);

  const posIndex = new Map(positions.map((p) => [p.id, p]));

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'sparse',
              label: '稀疏网络',
              hint: '极简',
              description: '低密度 — 仅突出高注意力边。',
              apply: () => {
                setEegN(8);
                setFnirsN(8);
                setDensity(0.18);
                setIterations(300);
              },
            },
            {
              id: 'dense',
              label: '稠密网络',
              hint: '丰富',
              description: '多边 — 压测布局求解器。',
              apply: () => {
                setEegN(14);
                setFnirsN(14);
                setDensity(0.55);
                setIterations(450);
              },
            },
            {
              id: 'hub',
              label: '中枢-辐状',
              hint: '拓扑',
              description: '中等密度加上额外求解迭代。',
              apply: () => {
                setEegN(10);
                setFnirsN(10);
                setDensity(0.42);
                setIterations(500);
              },
            },
            {
              id: 'magma',
              label: 'Magma 色带',
              hint: '色彩',
              description: '暖色调色带，投影仪友好。',
              apply: () => {
                setColormap('magma');
              },
            },
          ]}
        />
      }
      filename="hegat-map"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="节点">
            <NumberSlider
              label="EEG 节点数"
              value={eegN}
              min={4}
              max={24}
              step={1}
              onChange={setEegN}
            />
            <NumberSlider
              label="fNIRS 节点数"
              value={fnirsN}
              min={4}
              max={24}
              step={1}
              onChange={setFnirsN}
            />
          </ControlGroup>
          <ControlGroup label="边">
            <NumberSlider
              label="密度"
              value={density}
              min={0.05}
              max={0.6}
              step={0.01}
              onChange={setDensity}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="显示节点标签" checked={showLabels} onChange={setShowLabels} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          异构图注意力网络。EEG 电极（圆圈）与 fNIRS 通道（三角形）通过
          跨模态注意力边连接，边的宽度与不透明度编码{' '}
          <code>α<sub>ij</sub></code>。布局为确定性 250 次迭代的力导向仿
          真，初始位置为固定环形。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H + 80}
          title={'Heterogeneous Graph Attention Network · $\\alpha_{ij}$ edges'}
          caption={`EEG (○) ↔ fNIRS (△) bipartite-leaning graph with deterministic D3 force layout.`}
        >
          {/* Edges */}
          <g>
            {links.map((l, i) => {
              const a = posIndex.get(l.source);
              const b = posIndex.get(l.target);
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={interp(l.alpha)}
                  strokeWidth={0.6 + l.alpha * 3.2}
                  strokeOpacity={0.25 + l.alpha * 0.6}
                />
              );
            })}
          </g>
          {/* Nodes */}
          <g>
            {positions.map((p) => (
              <g key={p.id} transform={`translate(${p.x}, ${p.y})`}>
                {p.group === 'EEG' ? (
                  <circle r={9} fill="white" stroke="#0d1117" strokeWidth={1.5} />
                ) : (
                  <polygon
                    points="0,-10 9,7 -9,7"
                    fill="white"
                    stroke="#0d1117"
                    strokeWidth={1.5}
                  />
                )}
                {showLabels ? (
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    fontSize={9}
                    fontFamily='"JetBrains Mono", monospace'
                    fill="#0d1117"
                  >
                    {p.id}
                  </text>
                ) : null}
              </g>
            ))}
          </g>
          {/* Legend */}
          <g transform={`translate(${W - 220}, ${H - 56})`}>
            <rect width={210} height={48} rx={4} fill="white" fillOpacity={0.92} stroke="currentColor" strokeOpacity={0.3} />
            <g transform="translate(14, 16)">
              <circle r={6} fill="white" stroke="#0d1117" strokeWidth={1.5} />
              <text x={14} y={4} fontSize={11} fill="currentColor">EEG electrode</text>
            </g>
            <g transform="translate(14, 36)">
              <polygon points="0,-7 7,5 -7,5" fill="white" stroke="#0d1117" strokeWidth={1.5} />
              <text x={14} y={4} fontSize={11} fill="currentColor">fNIRS channel</text>
            </g>
          </g>
        </FigureFrame>
      }
    />
  );
}

registerChart({
  id: 'hegat-map',
  title: '异构图注意力网络图',
  titleEn: 'Heterogeneous Graph Attention Map',
  category: 'architecture',
  summary:
    'EEG 电极与 fNIRS 通道之间的力导向近二分图，边以注意力加权。',
  component: HeGATChart,
});

