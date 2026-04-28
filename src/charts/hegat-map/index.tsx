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
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes, links } = useMemo(
    () => generateGraph(7, eegN, fnirsN, density),
    [eegN, fnirsN, density],
  );

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
    for (let i = 0; i < 250; i++) sim.tick();
    return simNodes;
  }, [nodes, links, cx, cy]);

  const posIndex = new Map(positions.map((p) => [p.id, p]));

  return (
    <ChartShell
      filename="hegat-map"
      getSvg={() => svgRef.current}
      inspector={
        <>
          <ControlGroup label="Nodes">
            <NumberSlider
              label="EEG nodes"
              value={eegN}
              min={4}
              max={24}
              step={1}
              onChange={setEegN}
            />
            <NumberSlider
              label="fNIRS nodes"
              value={fnirsN}
              min={4}
              max={24}
              step={1}
              onChange={setFnirsN}
            />
          </ControlGroup>
          <ControlGroup label="Edges">
            <NumberSlider
              label="density"
              value={density}
              min={0.05}
              max={0.6}
              step={0.01}
              onChange={setDensity}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>
          <ControlGroup label="Display">
            <Toggle label="Show node labels" checked={showLabels} onChange={setShowLabels} />
            <ColormapSelect value={colormap} onChange={setColormap} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          Heterogeneous graph attention network. EEG electrodes (circles)
          and fNIRS channels (triangles) are bridged by cross-modal
          attention edges whose width and opacity encode{' '}
          <code>α<sub>ij</sub></code>. Layout is a deterministic 250-tick
          force simulation seeded from a fixed circular initial state.
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
  title: 'Heterogeneous Graph Attention Map',
  titleZh: '异构图注意力网络图',
  category: 'architecture',
  summary:
    'Force-directed bipartite-leaning graph between EEG electrodes and fNIRS channels with attention-weighted edges.',
  component: HeGATChart,
});

