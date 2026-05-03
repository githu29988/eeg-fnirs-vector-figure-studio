import { useEffect, useMemo, useRef, useState } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ChartShell } from '../../components/ChartShell';
import { ControlGroup, NumberSlider, Toggle } from '../../components/Controls';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { renderInlineLatex } from '../../lib/latex';
import { registerChart } from '../../registry';

/* ----------------------------- types -----------------------------------*/

type Category =
  | 'eeg'
  | 'fnirs'
  | 'hrf'
  | 'graph'
  | 'gate'
  | 'output';

interface PanelSpec {
  id: string;
  col: number;
  /** 0 = top row, 1 = bottom row. */
  row: number;
  /** 1 = single row, 2 = spans both rows (centered vertically). */
  rowSpan?: 1 | 2;
  category: Category;
  header: string;
  /** Each entry is a single line; '' means an empty spacer. */
  body: string[];
}

type Anchor = 'right' | 'left' | 'top' | 'bottom' | 'center';

interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  fromAnchor?: Anchor;
  toAnchor?: Anchor;
  /** Source y-offset within the panel as a fraction (0=top..1=bottom). */
  fromYFrac?: number;
  toYFrac?: number;
  category: Category;
  style?: 'solid' | 'dashed' | 'dotted';
  thickness?: number;
  /** Optional inline label rendered next to the arrow midpoint. */
  label?: string;
}

/* ------------------------- color palette -------------------------------*/

interface CategoryStyle {
  fill: string;
  edge: string;
  text: string;
  legend: string;
}

const PALETTE: Record<Category, CategoryStyle> = {
  eeg: {
    fill: '#E8F1FB',
    edge: '#1F4E79',
    text: '#1F4E79',
    legend: 'EEG path',
  },
  fnirs: {
    fill: '#FBE8E8',
    edge: '#A02323',
    text: '#A02323',
    legend: 'fNIRS path',
  },
  hrf: {
    fill: '#FFF4D6',
    edge: '#8A6A0A',
    text: '#8A6A0A',
    legend: 'Learnable HRF time-shift',
  },
  graph: {
    fill: '#EDE5F7',
    edge: '#5A3A8C',
    text: '#5A3A8C',
    legend: 'Heterogeneous graph + GAT',
  },
  gate: {
    fill: '#FCE4C9',
    edge: '#A35100',
    text: '#A35100',
    legend: 'Gated fusion',
  },
  output: {
    fill: '#E1F2E2',
    edge: '#1F6F2A',
    text: '#1F6F2A',
    legend: 'Classifier  /  output',
  },
};

/* --------------------- GAT-CMC-Net default preset ----------------------*/

const GAT_CMC_NET_PANELS: PanelSpec[] = [
  // Column 0 — Input
  {
    id: 'eeg-in',
    col: 0,
    row: 0,
    category: 'eeg',
    header: 'EEG  Input',
    body: [
      '$\\mathbf{X}^{E}\\in\\mathbb{R}^{N_E\\times T_E}$',
      '$f_E = 256$ Hz',
      'window  $W = 30$ s',
    ],
  },
  {
    id: 'fnirs-in',
    col: 0,
    row: 1,
    category: 'fnirs',
    header: 'fNIRS  Input',
    body: [
      '$\\mathbf{X}^{F}\\in\\mathbb{R}^{N_F\\times 2\\times T_F}$',
      'HbO  /  HbR',
      '$f_F \\approx 10$ Hz',
    ],
  },
  // Column 1 — Encoder
  {
    id: 'eeg-enc',
    col: 1,
    row: 0,
    category: 'eeg',
    header: 'EEG  Encoder',
    body: [
      'DSConv1D  +  STFT-2D',
      'temporal  $\\oplus$  spectral',
      '$\\mathbf{H}^{E}\\in\\mathbb{R}^{N_E\\times d_E}$',
    ],
  },
  {
    id: 'fnirs-enc',
    col: 1,
    row: 1,
    category: 'fnirs',
    header: 'fNIRS  Encoder',
    body: [
      'Conv1D  +  slow-stat',
      'HbO  /  HbR  dual-stream',
      '$\\mathbf{H}^{F}\\in\\mathbb{R}^{N_F\\times d_F}$',
    ],
  },
  // Column 2 — Graph + HRF
  {
    id: 'graph',
    col: 2,
    row: 0,
    category: 'graph',
    header: 'Heterogeneous  Graph',
    body: [
      'EEG  +  fNIRS  nodes',
      'three edge types',
      'sparse learnable gates',
    ],
  },
  {
    id: 'hrf',
    col: 2,
    row: 1,
    category: 'hrf',
    header: 'Learnable  HRF  Shift',
    body: [
      '$\\tilde{x}^{F}_j(t)=\\sum_{\\Delta} g(\\Delta;\\tau_j)\\,x^{F}_j(t-\\Delta)$',
      '$\\tau_j \\in [\\tau_{\\min},\\tau_{\\max}]$',
      'Gaussian soft-shift kernel',
    ],
  },
  // Column 3 — GAT (spans both rows)
  {
    id: 'gat',
    col: 3,
    row: 0,
    rowSpan: 2,
    category: 'graph',
    header: 'Multi-Head  Heterogeneous  GAT',
    body: [
      '',
      '$e_{ij}=\\mathrm{LeakyReLU}\\bigl(\\mathbf{a}^{\\top}[\\mathbf{W}_{r}\\mathbf{h}_i\\,\\Vert\\,\\mathbf{W}_{r\'}\\mathbf{h}_j]\\bigr)$',
      '$\\alpha_{ij}=\\mathrm{softmax}_{j\\in\\mathcal{N}(i)}\\,(e_{ij})$',
      '',
      '$\\mathbf{h}_i^{(l+1)}=\\Vert_{k=1}^{K}\\,\\sigma\\!\\left(\\sum_{j}\\alpha_{ij}^{(k)}\\mathbf{W}_{r_j}^{(k)}\\mathbf{h}_j^{(l)}\\right)$',
      '',
      '$L = 3$ layers,  $K = 4$ heads',
    ],
  },
  // Column 4 — Gated Fusion (spans both rows)
  {
    id: 'fuse',
    col: 4,
    row: 0,
    rowSpan: 2,
    category: 'gate',
    header: 'Gated  Cross-Modal  Fusion',
    body: [
      '',
      '$\\mathbf{g}=\\sigma\\!\\bigl(\\mathbf{W}_g[\\mathbf{h}^{E}\\,\\Vert\\,\\mathbf{h}^{F}]+\\mathbf{b}_g\\bigr)$',
      '',
      '$\\mathbf{h}=\\mathbf{g}\\odot\\mathbf{h}^{E}+(1-\\mathbf{g})\\odot\\mathbf{h}^{F}$',
      '',
      '$\\mathbf{g}\\in[0,1]^{d_L}$',
      'channel-wise gating',
    ],
  },
  // Column 5 — Output
  {
    id: 'out',
    col: 5,
    row: 0,
    category: 'output',
    header: 'Output',
    body: ['$\\hat{y}\\in[0,1]$', 'event-level', 'SE  /  FA-h', 'Latency'],
  },
  {
    id: 'cls',
    col: 5,
    row: 1,
    category: 'output',
    header: 'Classifier',
    body: ['MLP  +  $\\sigma$', 'Focal Loss', 'IoU  $\\geq$  0.5'],
  },
];

const GAT_CMC_NET_EDGES: EdgeSpec[] = [
  // EEG path along the top row
  { id: 'eeg-1', from: 'eeg-in', to: 'eeg-enc', category: 'eeg' },
  { id: 'eeg-2', from: 'eeg-enc', to: 'graph', category: 'eeg' },
  {
    id: 'eeg-3',
    from: 'graph',
    to: 'gat',
    category: 'eeg',
    toYFrac: 0.18,
  },
  // fNIRS path along the bottom row
  { id: 'fnirs-1', from: 'fnirs-in', to: 'fnirs-enc', category: 'fnirs' },
  { id: 'fnirs-2', from: 'fnirs-enc', to: 'hrf', category: 'fnirs' },
  {
    id: 'fnirs-3',
    from: 'hrf',
    to: 'gat',
    category: 'fnirs',
    toYFrac: 0.82,
  },
  // HRF -> Graph dashed coupling (vertical, bottom -> top)
  {
    id: 'hrf-couple',
    from: 'hrf',
    to: 'graph',
    fromAnchor: 'top',
    toAnchor: 'bottom',
    category: 'hrf',
    style: 'dashed',
    thickness: 1.2,
    label: 'aligned fNIRS features',
  },
  // GAT -> Fusion (mid)
  { id: 'gat-fuse', from: 'gat', to: 'fuse', category: 'graph', thickness: 1.9 },
  // Fusion -> Output (top) and Classifier (bottom)
  { id: 'fuse-out', from: 'fuse', to: 'out', category: 'gate' },
  { id: 'fuse-cls', from: 'fuse', to: 'cls', category: 'gate' },
  // Classifier -> Output internal (dotted)
  {
    id: 'cls-out',
    from: 'cls',
    to: 'out',
    fromAnchor: 'top',
    toAnchor: 'bottom',
    category: 'output',
    style: 'dotted',
    thickness: 1,
  },
];

/* --------------------------- chart impl --------------------------------*/

function ArchitectureOverallChart() {
  const [colSpacing, setColSpacing] = useState(180);
  const [rowSpacing, setRowSpacing] = useState(220);
  const [panelWidth, setPanelWidth] = useState(168);
  const [panelHeight, setPanelHeight] = useState(132);
  const [headerSize, setHeaderSize] = useState(13);
  const [bodySize, setBodySize] = useState(11);
  const [showLegend, setShowLegend] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  // Figure layout.
  //
  // Coordinates are split into two groups:
  //   - "internal" (relative to the FigureFrame children area, which is
  //     translated down by `framePadTop` to leave room for the title)
  //   - "viewport" (the parent <svg> coordinate, including the title
  //     band at the top and caption band at the bottom)
  //
  // The FigureFrame defaults (padTop=28 for title, padBottom=32 for
  // caption) match what we need; we just have to account for them when
  // computing the SVG height so the legend and caption never overlap.
  const margin = { right: 48, left: 48 };
  const colCount = 6;
  // Match the FigureFrame defaults (28 for title band, 32 for caption
  // band when caption is set, 0 otherwise).
  const framePadTop = 28;
  const framePadBottom = showSubtitle ? 32 : 0;
  const panelTop = 8;
  const panelsBottom = panelTop + rowSpacing + panelHeight;
  const legendGap = 24;
  const legendH = showLegend ? 22 : 0;
  const bottomGutter = 16;
  const W = margin.left + margin.right + (colCount - 1) * colSpacing + panelWidth;
  const innerHeight = panelsBottom + legendGap + legendH + bottomGutter;
  const H = innerHeight + framePadTop + framePadBottom;
  const legendY = panelsBottom + legendGap;

  const panelMap = useMemo(() => {
    const out = new Map<string, { x: number; y: number; w: number; h: number; spec: PanelSpec }>();
    for (const p of GAT_CMC_NET_PANELS) {
      const x = margin.left + p.col * colSpacing;
      let y: number;
      let h: number;
      if (p.rowSpan === 2) {
        y = panelTop;
        h = rowSpacing + panelHeight;
      } else {
        y = panelTop + p.row * rowSpacing;
        h = panelHeight;
      }
      out.set(p.id, { x, y, w: panelWidth, h, spec: p });
    }
    return out;
  }, [colSpacing, rowSpacing, panelWidth, panelHeight, margin.left, panelTop]);

  const expertSchema: ExpertSchema = [
    {
      label: '布局',
      fields: [
        {
          type: 'number',
          key: 'col',
          label: '列间距',
          min: 140,
          max: 240,
          step: 2,
          value: colSpacing,
          onChange: setColSpacing,
          slider: true,
        },
        {
          type: 'number',
          key: 'row',
          label: '行间距',
          min: 160,
          max: 320,
          step: 2,
          value: rowSpacing,
          onChange: setRowSpacing,
          slider: true,
        },
        {
          type: 'number',
          key: 'pw',
          label: '面板宽度',
          min: 130,
          max: 220,
          step: 2,
          value: panelWidth,
          onChange: setPanelWidth,
          slider: true,
        },
        {
          type: 'number',
          key: 'ph',
          label: '面板高度',
          min: 100,
          max: 180,
          step: 2,
          value: panelHeight,
          onChange: setPanelHeight,
          slider: true,
        },
      ],
    },
    {
      label: '排版',
      fields: [
        {
          type: 'number',
          key: 'hs',
          label: '标题字号',
          min: 10,
          max: 18,
          step: 0.5,
          value: headerSize,
          onChange: setHeaderSize,
          slider: true,
        },
        {
          type: 'number',
          key: 'bs',
          label: '正文字号',
          min: 8,
          max: 14,
          step: 0.5,
          value: bodySize,
          onChange: setBodySize,
          slider: true,
        },
      ],
    },
    {
      label: '显示',
      fields: [
        { type: 'toggle', key: 'sub', label: '副标题', value: showSubtitle, onChange: setShowSubtitle },
        { type: 'toggle', key: 'leg', label: '底部图例', value: showLegend, onChange: setShowLegend },
      ],
    },
  ];

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'gat-cmc',
              label: 'GAT-CMC-Net',
              hint: '出版级',
              description: '完整带 KaTeX 公式与底部图例的整体架构图。',
              apply: () => {
                setColSpacing(180);
                setRowSpacing(220);
                setPanelWidth(168);
                setPanelHeight(132);
                setHeaderSize(13);
                setBodySize(11);
                setShowLegend(true);
                setShowSubtitle(true);
              },
            },
            {
              id: 'compact',
              label: '紧凑期刊版',
              hint: '论文',
              description: '更紧的排版与稍小的字号，适合期刊单栏宽度。',
              apply: () => {
                setColSpacing(150);
                setRowSpacing(190);
                setPanelWidth(140);
                setPanelHeight(110);
                setHeaderSize(11.5);
                setBodySize(9.5);
                setShowLegend(true);
                setShowSubtitle(true);
              },
            },
            {
              id: 'poster',
              label: '海报版',
              hint: '展板',
              description: '更宽列、更大字号，适合学术海报。',
              apply: () => {
                setColSpacing(210);
                setRowSpacing(260);
                setPanelWidth(196);
                setPanelHeight(158);
                setHeaderSize(15);
                setBodySize(12.5);
                setShowLegend(true);
                setShowSubtitle(true);
              },
            },
            {
              id: 'no-legend',
              label: '隐藏图例',
              hint: '极简',
              description: '隐藏底部图例与副标题，只保留主图。',
              apply: () => {
                setShowLegend(false);
                setShowSubtitle(false);
              },
            },
          ]}
        />
      }
      filename="architecture-overall"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="布局">
            <NumberSlider
              label="列间距"
              value={colSpacing}
              min={140}
              max={240}
              step={2}
              onChange={setColSpacing}
            />
            <NumberSlider
              label="行间距"
              value={rowSpacing}
              min={160}
              max={320}
              step={2}
              onChange={setRowSpacing}
            />
          </ControlGroup>
          <ControlGroup label="显示">
            <Toggle label="副标题" checked={showSubtitle} onChange={setShowSubtitle} />
            <Toggle label="底部图例" checked={showLegend} onChange={setShowLegend} />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          多模态深度学习模型整体架构示意图。每个面板由标题 + 多行正文（支持
          KaTeX 公式）构成；箭头按通路类别着色，虚线表示跨模态对齐 / 耦合。
          预设 <code>GAT-CMC-Net</code> 直接复刻同名模型的 Fig.2 出版级版式。
          编辑 <code>architecture-overall/index.tsx</code> 中的
          <code>GAT_CMC_NET_PANELS</code> / <code>GAT_CMC_NET_EDGES</code>
          可适配其它架构。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H}
          title="GAT-CMC-Net  ·  Overall Architecture"
          caption={
            showSubtitle
              ? 'Heterogeneous Graph  ·  Multi-Head Attention  ·  Learnable HRF Time-Shift  ·  Gated Cross-Modal Fusion'
              : undefined
          }
        >
          <defs>
            {(['eeg', 'fnirs', 'hrf', 'graph', 'gate', 'output'] as Category[]).map(
              (c) => (
                <marker
                  key={c}
                  id={`arch-arrow-${c}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 Z" fill={PALETTE[c].edge} />
                </marker>
              ),
            )}
          </defs>

          {/* edges */}
          <g>
            {GAT_CMC_NET_EDGES.map((e) => {
              const a = panelMap.get(e.from);
              const b = panelMap.get(e.to);
              if (!a || !b) return null;
              const fromAnchor: Anchor = e.fromAnchor ?? 'right';
              const toAnchor: Anchor = e.toAnchor ?? 'left';
              const yFracFrom = e.fromYFrac ?? 0.5;
              const yFracTo = e.toYFrac ?? 0.5;

              const aPt = anchorPoint(a, fromAnchor, yFracFrom);
              const bPt = anchorPoint(b, toAnchor, yFracTo);

              const style = e.style ?? 'solid';
              const dash =
                style === 'dashed' ? '6 4' : style === 'dotted' ? '2 4' : undefined;

              return (
                <g key={e.id}>
                  <path
                    d={curvePath(aPt.x, aPt.y, bPt.x, bPt.y, fromAnchor, toAnchor)}
                    fill="none"
                    stroke={PALETTE[e.category].edge}
                    strokeWidth={e.thickness ?? 1.6}
                    strokeDasharray={dash}
                    markerEnd={`url(#arch-arrow-${e.category})`}
                  />
                  {e.label ? (
                    <foreignObject
                      x={(aPt.x + bPt.x) / 2 + 6}
                      y={(aPt.y + bPt.y) / 2 - 16}
                      width={130}
                      height={36}
                      data-latex={e.label}
                      data-latex-font-size={10}
                    >
                      <div
                        style={{
                          fontFamily:
                            'Inter, "Noto Sans SC", system-ui, sans-serif',
                          fontSize: 10,
                          color: PALETTE[e.category].text,
                          lineHeight: 1.2,
                        }}
                        dangerouslySetInnerHTML={{ __html: renderInlineLatex(e.label) }}
                      />
                    </foreignObject>
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* panels */}
          <g>
            {GAT_CMC_NET_PANELS.map((p) => {
              const slot = panelMap.get(p.id);
              if (!slot) return null;
              return (
                <Panel
                  key={p.id}
                  spec={p}
                  x={slot.x}
                  y={slot.y}
                  w={slot.w}
                  h={slot.h}
                  headerSize={headerSize}
                  bodySize={bodySize}
                />
              );
            })}
          </g>

          {/* legend */}
          {showLegend ? (
            <g transform={`translate(${margin.left}, ${legendY})`}>
              <Legend categories={legendCategories(GAT_CMC_NET_PANELS)} />
            </g>
          ) : null}
        </FigureFrame>
      }
    />
  );
}

/* --------------------------- helpers ----------------------------------*/

function anchorPoint(
  slot: { x: number; y: number; w: number; h: number },
  anchor: Anchor,
  yFrac: number,
): { x: number; y: number } {
  switch (anchor) {
    case 'right':
      return { x: slot.x + slot.w, y: slot.y + slot.h * yFrac };
    case 'left':
      return { x: slot.x, y: slot.y + slot.h * yFrac };
    case 'top':
      return { x: slot.x + slot.w / 2, y: slot.y };
    case 'bottom':
      return { x: slot.x + slot.w / 2, y: slot.y + slot.h };
    default:
      return { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 };
  }
}

function curvePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  from: Anchor,
  to: Anchor,
): string {
  const horizontalPair =
    (from === 'right' && to === 'left') || (from === 'left' && to === 'right');
  const verticalPair =
    (from === 'top' && to === 'bottom') || (from === 'bottom' && to === 'top');

  if (verticalPair) {
    // Straight vertical line.
    return `M${x1},${y1} L${x2},${y2}`;
  }
  if (horizontalPair) {
    const dx = (x2 - x1) * 0.45;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
  // Mixed-anchor: straight line.
  return `M${x1},${y1} L${x2},${y2}`;
}

interface PanelProps {
  spec: PanelSpec;
  x: number;
  y: number;
  w: number;
  h: number;
  headerSize: number;
  bodySize: number;
}

function Panel({ spec, x, y, w, h, headerSize, bodySize }: PanelProps) {
  const style = PALETTE[spec.category];
  const headerH = headerSize * 1.6 + 12;
  const bodyHeight = h - headerH - 16;

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={10}
        ry={10}
        fill={style.fill}
        stroke={style.edge}
        strokeWidth={1.4}
      />
      <foreignObject
        x={0}
        y={4}
        width={w}
        height={headerH}
        data-latex={spec.header}
        data-latex-font-size={headerSize}
        data-latex-font-weight={600}
      >
        <PanelHeader text={spec.header} fontSize={headerSize} color={style.edge} />
      </foreignObject>
      <foreignObject
        x={6}
        y={headerH + 8}
        width={w - 12}
        height={bodyHeight}
        data-latex=""
      >
        <PanelBody body={spec.body} fontSize={bodySize} />
      </foreignObject>
      <line
        x1={12}
        y1={headerH + 4}
        x2={w - 12}
        y2={headerH + 4}
        stroke={style.edge}
        strokeOpacity={0.25}
        strokeWidth={0.8}
      />
    </g>
  );
}

function PanelHeader({
  text,
  fontSize,
  color,
}: {
  text: string;
  fontSize: number;
  color: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = renderInlineLatex(text);
  }, [text]);
  return (
    <div
      ref={ref}
      style={{
        fontFamily:
          'Inter, "Noto Sans SC", system-ui, sans-serif',
        fontSize,
        fontWeight: 600,
        color,
        textAlign: 'center',
        lineHeight: 1.2,
      }}
    />
  );
}

function PanelBody({ body, fontSize }: { body: string[]; fontSize: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 4,
        fontFamily:
          'Inter, "Noto Sans SC", system-ui, sans-serif',
        fontSize,
        color: '#1c1c1c',
        lineHeight: 1.25,
        height: '100%',
        paddingTop: 4,
      }}
    >
      {body.map((line, i) =>
        line ? <BodyLine key={i} text={line} /> : <span key={i} style={{ height: fontSize * 0.4 }} />,
      )}
    </div>
  );
}

function BodyLine({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.innerHTML = renderInlineLatex(text);
  }, [text]);
  return <span ref={ref} style={{ textAlign: 'center' }} />;
}

function legendCategories(panels: PanelSpec[]): Category[] {
  const seen = new Set<Category>();
  for (const p of panels) seen.add(p.category);
  // Stable order matching the visual flow.
  const order: Category[] = ['eeg', 'fnirs', 'hrf', 'graph', 'gate', 'output'];
  return order.filter((c) => seen.has(c));
}

function Legend({ categories }: { categories: Category[] }) {
  const items = useMemo(() => {
    return categories.reduce<{ c: Category; x: number }[]>((acc, c) => {
      const x = acc.length === 0 ? 0 : acc[acc.length - 1].x + 20 + 10 + PALETTE[acc[acc.length - 1].c].legend.length * 6.2 + 24;
      acc.push({ c, x });
      return acc;
    }, []);
  }, [categories]);
  return (
    <g>
      {items.map(({ c, x }) => (
        <g key={c} transform={`translate(${x}, 0)`}>
          <rect
            x={0}
            y={0}
            width={14}
            height={10}
            rx={2}
            fill={PALETTE[c].fill}
            stroke={PALETTE[c].edge}
            strokeWidth={1}
          />
          <text x={20} y={9} fontSize={11} fill="#333">
            {PALETTE[c].legend}
          </text>
        </g>
      ))}
    </g>
  );
}

registerChart({
  id: 'architecture-overall',
  title: '整体架构示意图',
  titleEn: 'Overall Architecture',
  category: 'architecture',
  summary:
    '多模态深度学习模型 Fig.2 级整体架构图，支持面板 + KaTeX 公式 + 跨模态耦合虚线 + 底部图例。',
  component: ArchitectureOverallChart,
});
