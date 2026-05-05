/**
 * Heterogeneous Graph Construction · Dual Node Types + Three Edge Categories
 *
 * Faithful port of `fig_04_heterogeneous_graph.py`:
 *   - 9 EEG nodes E1..E9 placed on a top semicircle.
 *   - 7 fNIRS nodes F1..F7 placed on a bottom row with a slight wave.
 *   - Three edge categories rendered as separate <g> layers so they can
 *     be styled / toggled independently:
 *       · intra-EEG  (soft blue,  curved arcs above the EEG nodes)
 *       · intra-fNIRS (soft red,  curved arcs below the fNIRS nodes)
 *       · cross-modal (dashed purple, with τ_j HRF-shift label)
 *   - Right column has two side panels:
 *       · "Edge categories" (3 colour swatches with labels)
 *       · "Notation"        (block adjacency + edge gate maths)
 *
 * Studio integration parity with previous charts:
 *   - Custom Inspector with visibility toggles, color overrides,
 *     per-node label edits, edge stroke width controls, side-panel
 *     visibility toggles.
 *   - Inspiration presets covering English (paper default) and
 *     Chinese-annotated variants, plus a few topology presets.
 *   - SVG-only output; titles / labels / banners use foreignObject +
 *     data-latex so MathJax replacement at export time produces glyph
 *     paths. KaTeX HTML rendered inline for the live preview.
 *   - Drag any node to reposition (with snap-to-grid + reset-by-dragging-
 *     back-to-origin), reuses `usePanelDrag` slot machinery via a thin
 *     adaptor (one slot per node).
 *   - Slot-based config save/load (manual) plus a 5-minute auto-save
 *     loop and auto-load-latest on mount via `useAutoSave`.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { ChartShell } from '../../components/ChartShell';
import {
  ControlGroup,
  NumberSlider,
  Select,
  TextArea,
  Toggle,
} from '../../components/Controls';
import type { ExpertSchema } from '../../components/ExpertPanel';
import { InspirationPanel } from '../../components/InspirationPanel';
import { registerChart } from '../../registry';
import { usePanelDrag } from '../../lib/usePanelDrag';
import { renderInlineLatex } from '../../lib/latex';
import {
  findLatestSlot,
  touchSlot,
  useAutoSave,
} from '../../lib/useAutoSave';

/* ---------------------------- model types ----------------------------- */

type Modality = 'eeg' | 'fnirs';

interface NodeSpec {
  id: string; // e.g. "E1" or "F1"
  label: string; // e.g. "$E_1$"
  modality: Modality;
  /** Base layout position (px) — overridden by `dx/dy` in NodeOverride. */
  x: number;
  y: number;
}

type EdgeKind = 'ee' | 'ff' | 'cross';

interface RawEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

interface NodeOverride {
  dx?: number;
  dy?: number;
  label?: string; // user-supplied override of NodeSpec.label
  hidden?: boolean;
}

type NodeOverrideMap = Record<string, NodeOverride>;

interface EdgeKindStyle {
  color: string;
  width: number;
  alpha: number;
  dashed: boolean;
  curve: number; // signed curvature: -1..1
  visible: boolean;
}

interface SidePanelState {
  visible: boolean;
  /** 0-indexed body lines, each with optional override text. */
  bodyOverrides: Record<number, string>;
}

interface SavedConfig {
  version: 1;
  nodes: NodeOverrideMap;
  edgeStyles: Record<EdgeKind, EdgeKindStyle>;
  toggles: {
    showHrfTag: boolean;
    showVeBanner: boolean;
    showVfBanner: boolean;
    showSubtitle: boolean;
    showLegendDivider: boolean;
  };
  sidePanels: {
    edgeCategories: SidePanelState;
    notation: SidePanelState;
  };
  /** Free-form annotation text shown above the title. Default empty. */
  titleOverride: string | null;
  subtitleOverride: string | null;
  hrfTagOverride: string | null;
  veBannerOverride: string | null;
  vfBannerOverride: string | null;
}

/* ----------------------- canvas / layout constants -------------------- */

const W_FIG = 1280;
const H_FIG = 720;

// Graph area on the left: x in [GX0, GX1], y top of EEG arc to fNIRS row.
const GX0 = 40;
const GX1 = 840;
const ARC_CY = 290;
const ARC_RX = (GX1 - GX0) * 0.42;
const ARC_RY = 110;
const FNIRS_Y = 540;
const FNIRS_WAVE_AMP = 22;

// Right column panels.
const PX = 880; // panel left edge
const PW = W_FIG - PX - 32; // panel width

const TITLE_Y = 36;
const SUBTITLE_Y = 76;
const DIVIDER_Y = 102;

const NODE_R = 24;

/* ----------------------------- palette -------------------------------- */

const COL = {
  eegFill: '#DCEAFF',
  eegEdge: '#1F4E79',
  fnirsFill: '#FBE2E2',
  fnirsEdge: '#9B2D2D',
  intraEeg: '#5B7BB0',
  intraFn: '#B36363',
  cross: '#7A4FAE',
  panelFill: '#F7F7FA',
  panelEdge: '#444444',
  noteFill: '#FFF7DC',
  noteEdge: '#8A6A0A',
  dim: '#666666',
  bodyText: '#1c1c1c',
} as const;

/* ------------------------ layout: node positions ---------------------- */

const N_EEG = 9;
const N_FNIRS = 7;

function buildEegPositions(): NodeSpec[] {
  const out: NodeSpec[] = [];
  const cx = (GX0 + GX1) / 2;
  for (let i = 0; i < N_EEG; i++) {
    const th = Math.PI - (i * Math.PI) / (N_EEG - 1);
    const x = cx + ARC_RX * Math.cos(th);
    const y = ARC_CY - ARC_RY * Math.sin(th); // SVG y grows downward
    out.push({
      id: `E${i + 1}`,
      label: `$E_{${i + 1}}$`,
      modality: 'eeg',
      x,
      y,
    });
  }
  return out;
}

function buildFnirsPositions(): NodeSpec[] {
  const out: NodeSpec[] = [];
  const xs: number[] = [];
  const startX = GX0 + 110;
  const endX = GX1 - 110;
  for (let i = 0; i < N_FNIRS; i++) {
    xs.push(startX + ((endX - startX) * i) / (N_FNIRS - 1));
  }
  for (let i = 0; i < N_FNIRS; i++) {
    out.push({
      id: `F${i + 1}`,
      label: `$F_{${i + 1}}$`,
      modality: 'fnirs',
      x: xs[i],
      y: FNIRS_Y + FNIRS_WAVE_AMP * Math.sin(i * 1.3),
    });
  }
  return out;
}

const ALL_NODES: NodeSpec[] = [...buildEegPositions(), ...buildFnirsPositions()];

/* -------------------------- edge sets --------------------------------- */

const INTRA_EEG_PAIRS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
  [0, 2], [1, 3], [2, 4], [3, 5], [4, 6], [5, 7], [6, 8],
  [0, 4], [2, 6], [4, 8],
];

const INTRA_FNIRS_PAIRS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
  [0, 2], [1, 3], [2, 4], [3, 5], [4, 6],
  [0, 3], [3, 6],
];

const CROSS_PAIRS: [number, number][] = [
  [0, 0], [1, 1], [2, 1], [3, 2], [4, 3], [5, 3], [6, 4], [7, 5], [8, 6],
  [2, 3], [6, 3],
];

const ALL_EDGES: RawEdge[] = [
  ...INTRA_EEG_PAIRS.map(([i, j]): RawEdge => ({
    from: `E${i + 1}`,
    to: `E${j + 1}`,
    kind: 'ee',
  })),
  ...INTRA_FNIRS_PAIRS.map(([i, j]): RawEdge => ({
    from: `F${i + 1}`,
    to: `F${j + 1}`,
    kind: 'ff',
  })),
  ...CROSS_PAIRS.map(([i, j]): RawEdge => ({
    from: `E${i + 1}`,
    to: `F${j + 1}`,
    kind: 'cross',
  })),
];

/* ----------------------- defaults & persistence ----------------------- */

const DEFAULT_EDGE_STYLES: Record<EdgeKind, EdgeKindStyle> = {
  ee: {
    color: COL.intraEeg,
    width: 1.6,
    alpha: 0.65,
    dashed: false,
    curve: -0.32, // arch upward
    visible: true,
  },
  ff: {
    color: COL.intraFn,
    width: 1.6,
    alpha: 0.65,
    dashed: false,
    curve: 0.4, // arch downward
    visible: true,
  },
  cross: {
    color: COL.cross,
    width: 2.0,
    alpha: 0.9,
    dashed: true,
    curve: 0,
    visible: true,
  },
};

const DEFAULT_SIDE_PANELS: SavedConfig['sidePanels'] = {
  edgeCategories: { visible: true, bodyOverrides: {} },
  notation: { visible: true, bodyOverrides: {} },
};

const DEFAULT_CONFIG: SavedConfig = {
  version: 1,
  nodes: {},
  edgeStyles: DEFAULT_EDGE_STYLES,
  toggles: {
    showHrfTag: true,
    showVeBanner: true,
    showVfBanner: true,
    showSubtitle: true,
    showLegendDivider: true,
  },
  sidePanels: DEFAULT_SIDE_PANELS,
  titleOverride: null,
  subtitleOverride: null,
  hrfTagOverride: null,
  veBannerOverride: null,
  vfBannerOverride: null,
};

const STORAGE_KEY = 'heterogeneous-graph-construction-saved-configs-v1';
type SavedConfigsMap = Record<string, SavedConfig>;

function loadStoredConfigs(): SavedConfigsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedConfigsMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function persistConfigs(map: SavedConfigsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // no-op
  }
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------- side-panel content ------------------------- */

interface SidePanelDef {
  key: 'edgeCategories' | 'notation';
  title: string;
  fill: string;
  edge: string;
  y: number;
  height: number;
  body: SidePanelLine[];
}

type SidePanelLine =
  | { kind: 'swatch'; color: string; dashed: boolean; label: string }
  | { kind: 'math'; text: string; size?: number; muted?: boolean }
  | { kind: 'gap' };

function makeSidePanels(opts: { showHrfShift: boolean }): SidePanelDef[] {
  return [
    {
      key: 'edgeCategories',
      title: 'Edge categories',
      fill: COL.panelFill,
      edge: COL.panelEdge,
      y: 130,
      height: 200,
      body: [
        {
          kind: 'swatch',
          color: COL.intraEeg,
          dashed: false,
          label: 'EEG  –  EEG    (intra-modal)',
        },
        {
          kind: 'swatch',
          color: COL.intraFn,
          dashed: false,
          label: 'fNIRS – fNIRS    (intra-modal)',
        },
        {
          kind: 'swatch',
          color: COL.cross,
          dashed: true,
          label: opts.showHrfShift
            ? 'Cross-modal    (with $\\tau_j$ HRF shift)'
            : 'Cross-modal',
        },
      ],
    },
    {
      key: 'notation',
      title: 'Notation',
      fill: COL.noteFill,
      edge: COL.noteEdge,
      y: 350,
      height: 320,
      body: [
        { kind: 'math', text: '$\\mathbf{A}^{EE}\\;,\\;\\mathbf{A}^{EF}$' },
        { kind: 'math', text: '$\\mathbf{A}^{FE}\\;,\\;\\mathbf{A}^{FF}$' },
        {
          kind: 'math',
          text: 'block-structured by node type',
          size: 11,
          muted: true,
        },
        { kind: 'gap' },
        {
          kind: 'math',
          text: '$\\mathbf{W}_{r}$ : GAT weight per edge type',
          size: 12,
        },
        { kind: 'gap' },
        {
          kind: 'math',
          text:
            '$\\gamma_{ij}=\\sigma(\\mathbf{u}^{\\top}[\\mathbf{h}_i\\,\\Vert\\,\\mathbf{h}_j])$',
        },
        {
          kind: 'math',
          text: 'learnable edge gate',
          size: 11,
          muted: true,
        },
        { kind: 'gap' },
        {
          kind: 'math',
          text: 'with  $\\ell_1$  regulariser  $\\rightarrow$  sparse  graph',
          size: 12,
        },
      ],
    },
  ];
}

/* ============================ chart impl ============================== */

function HeterogeneousGraphChart() {
  const svgRef = useRef<SVGSVGElement>(null);

  const [nodeOverrides, setNodeOverrides] = useState<NodeOverrideMap>({});
  const [edgeStyles, setEdgeStyles] = useState<Record<EdgeKind, EdgeKindStyle>>(
    DEFAULT_EDGE_STYLES,
  );
  const [toggles, setToggles] = useState(DEFAULT_CONFIG.toggles);
  const [sidePanels, setSidePanels] = useState(DEFAULT_CONFIG.sidePanels);
  const [titleOverride, setTitleOverride] = useState<string | null>(null);
  const [subtitleOverride, setSubtitleOverride] = useState<string | null>(null);
  const [hrfTagOverride, setHrfTagOverride] = useState<string | null>(null);
  const [veBannerOverride, setVeBannerOverride] = useState<string | null>(null);
  const [vfBannerOverride, setVfBannerOverride] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string>(ALL_NODES[0].id);

  const [savedSlots, setSavedSlots] = useState<SavedConfigsMap>(() =>
    loadStoredConfigs(),
  );
  const [activeSlotName, setActiveSlotName] = useState<string>('');
  const [newSlotName, setNewSlotName] = useState<string>('');

  /* -- derived: nodes with overrides applied --------------------------- */

  const resolvedNodes = useMemo<NodeSpec[]>(() => {
    return ALL_NODES.map((n) => {
      const ov = nodeOverrides[n.id];
      if (!ov) return n;
      return {
        ...n,
        x: n.x + (ov.dx ?? 0),
        y: n.y + (ov.dy ?? 0),
        label: ov.label ?? n.label,
      };
    });
  }, [nodeOverrides]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, NodeSpec>();
    for (const n of resolvedNodes) m.set(n.id, n);
    return m;
  }, [resolvedNodes]);

  /* -- drag for nodes --------------------------------------------------- */

  const dragSlots = useMemo(
    () =>
      resolvedNodes.map((n) => ({
        id: n.id,
        x: n.x - NODE_R,
        y: n.y - NODE_R,
        w: NODE_R * 2,
        h: NODE_R * 2,
      })),
    [resolvedNodes],
  );

  const baseNodePositions = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const n of ALL_NODES) {
      m.set(n.id, { x: n.x - NODE_R, y: n.y - NODE_R });
    }
    return m;
  }, []);

  const drag = usePanelDrag({
    svgRef,
    slots: dragSlots,
    basePositions: baseNodePositions,
    canvasW: W_FIG,
    canvasH: H_FIG,
    onDrag: useCallback((nodeId: string, dx: number, dy: number) => {
      setNodeOverrides((prev) => {
        const cur = prev[nodeId] ?? {};
        const dxR = Math.round(dx);
        const dyR = Math.round(dy);
        const next: NodeOverride = {
          ...cur,
          dx: dxR === 0 ? undefined : dxR,
          dy: dyR === 0 ? undefined : dyR,
        };
        if (
          next.dx === undefined &&
          next.dy === undefined &&
          !next.label &&
          !next.hidden
        ) {
          const rest = { ...prev };
          delete rest[nodeId];
          return rest;
        }
        return { ...prev, [nodeId]: next };
      });
    }, []),
  });

  /* -- saved configs --------------------------------------------------- */

  const buildCurrentConfig = useCallback((): SavedConfig => ({
    version: 1,
    nodes: nodeOverrides,
    edgeStyles,
    toggles,
    sidePanels,
    titleOverride,
    subtitleOverride,
    hrfTagOverride,
    veBannerOverride,
    vfBannerOverride,
  }), [
    nodeOverrides,
    edgeStyles,
    toggles,
    sidePanels,
    titleOverride,
    subtitleOverride,
    hrfTagOverride,
    veBannerOverride,
    vfBannerOverride,
  ]);

  const applyConfig = useCallback((cfg: SavedConfig) => {
    setNodeOverrides(cfg.nodes ?? {});
    setEdgeStyles(cfg.edgeStyles ?? DEFAULT_EDGE_STYLES);
    setToggles(cfg.toggles ?? DEFAULT_CONFIG.toggles);
    setSidePanels(cfg.sidePanels ?? DEFAULT_SIDE_PANELS);
    setTitleOverride(cfg.titleOverride ?? null);
    setSubtitleOverride(cfg.subtitleOverride ?? null);
    setHrfTagOverride(cfg.hrfTagOverride ?? null);
    setVeBannerOverride(cfg.veBannerOverride ?? null);
    setVfBannerOverride(cfg.vfBannerOverride ?? null);
  }, []);

  const persistAndSet = useCallback((next: SavedConfigsMap) => {
    setSavedSlots(next);
    persistConfigs(next);
  }, []);

  const handleSaveSlot = () => {
    const name = newSlotName.trim();
    if (!name) return;
    const next = { ...savedSlots, [name]: buildCurrentConfig() };
    persistAndSet(next);
    touchSlot(STORAGE_KEY, name);
    setActiveSlotName(name);
    setNewSlotName('');
  };

  const handleLoadSlot = () => {
    if (!activeSlotName) return;
    const cfg = savedSlots[activeSlotName];
    if (!cfg) return;
    applyConfig(cfg);
    touchSlot(STORAGE_KEY, activeSlotName);
  };

  const handleDeleteSlot = () => {
    if (!activeSlotName) return;
    const rest = { ...savedSlots };
    delete rest[activeSlotName];
    persistAndSet(rest);
    setActiveSlotName('');
  };

  // 5-min auto-save + auto-load latest on mount.
  useAutoSave<SavedConfig>({
    storageKey: STORAGE_KEY,
    current: buildCurrentConfig(),
    slots: savedSlots,
    onPersistSlots: persistAndSet,
    applyConfig,
    intervalMs: 5 * 60 * 1000,
    autoLoadLatest: true,
  });

  // Reflect the auto-loaded slot in the dropdown on mount.
  const [activeSlotInit, setActiveSlotInit] = useState(false);
  if (!activeSlotInit) {
    setActiveSlotInit(true);
    const latest = findLatestSlot(STORAGE_KEY, savedSlots);
    if (latest) {
      setActiveSlotName(latest);
    }
  }

  /* -- inspector handlers ---------------------------------------------- */

  const updateEdgeStyle = (kind: EdgeKind, patch: Partial<EdgeKindStyle>) => {
    setEdgeStyles((prev) => ({ ...prev, [kind]: { ...prev[kind], ...patch } }));
  };

  const updateNodeOverride = (id: string, patch: Partial<NodeOverride>) => {
    setNodeOverrides((prev) => {
      const cur = prev[id] ?? {};
      const next = { ...cur, ...patch };
      if (
        next.dx === undefined &&
        next.dy === undefined &&
        !next.label &&
        !next.hidden
      ) {
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return { ...prev, [id]: next };
    });
  };

  /* -- text/render helpers --------------------------------------------- */

  const sidePanelsConfig = useMemo(
    () =>
      makeSidePanels({
        showHrfShift: edgeStyles.cross.visible && toggles.showHrfTag,
      }),
    [edgeStyles.cross.visible, toggles.showHrfTag],
  );

  const titleText =
    titleOverride ??
    'Heterogeneous Graph Construction · Dual Node Types + Three Edge Categories';
  const subtitleText =
    subtitleOverride ??
    'EEG electrodes and fNIRS channels jointly form a single graph $G = (V,\\,E)$';
  const hrfTagText =
    hrfTagOverride ??
    '$\\tau_j$ : learnable HRF time-shift on cross-modal edges';
  const veBannerText =
    veBannerOverride ??
    '$\\mathbf{V}^{E}$ : EEG nodes  ·  illustrative; $|\\mathbf{V}^{E}|=N_E=19$ (10–20 system)';
  const vfBannerText =
    vfBannerOverride ??
    '$\\mathbf{V}^{F}$ : fNIRS nodes  ·  illustrative; $|\\mathbf{V}^{F}|=N_F$ (dataset-dependent, 10–48)';

  /* -- expert schema (for ExpertPanel) --------------------------------- */

  const selectedNodeOverride = nodeOverrides[selectedNodeId] ?? {};
  const selectedNodeBase =
    ALL_NODES.find((n) => n.id === selectedNodeId) ?? ALL_NODES[0];

  const expertSchema: ExpertSchema = [
    {
      label: '画布',
      fields: [
        {
          type: 'toggle',
          key: 'subtitle',
          label: '副标题',
          value: toggles.showSubtitle,
          onChange: (v) => setToggles((t) => ({ ...t, showSubtitle: v })),
        },
        {
          type: 'toggle',
          key: 'divider',
          label: '标题分割线',
          value: toggles.showLegendDivider,
          onChange: (v) =>
            setToggles((t) => ({ ...t, showLegendDivider: v })),
        },
        {
          type: 'toggle',
          key: 've',
          label: 'V^E 横幅',
          value: toggles.showVeBanner,
          onChange: (v) => setToggles((t) => ({ ...t, showVeBanner: v })),
        },
        {
          type: 'toggle',
          key: 'vf',
          label: 'V^F 横幅',
          value: toggles.showVfBanner,
          onChange: (v) => setToggles((t) => ({ ...t, showVfBanner: v })),
        },
        {
          type: 'toggle',
          key: 'hrf',
          label: 'τ_j HRF 标签',
          value: toggles.showHrfTag,
          onChange: (v) => setToggles((t) => ({ ...t, showHrfTag: v })),
        },
      ],
    },
    {
      label: '边 · EEG–EEG',
      fields: [
        {
          type: 'toggle',
          key: 'eev',
          label: '显示',
          value: edgeStyles.ee.visible,
          onChange: (v) => updateEdgeStyle('ee', { visible: v }),
        },
        {
          type: 'number',
          key: 'eew',
          label: '线宽',
          min: 0.5,
          max: 4,
          step: 0.1,
          value: edgeStyles.ee.width,
          onChange: (v) => updateEdgeStyle('ee', { width: v }),
          slider: true,
          format: (v) => v.toFixed(1),
        },
        {
          type: 'number',
          key: 'eea',
          label: '透明度',
          min: 0.1,
          max: 1,
          step: 0.05,
          value: edgeStyles.ee.alpha,
          onChange: (v) => updateEdgeStyle('ee', { alpha: v }),
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'number',
          key: 'eec',
          label: '弧度',
          min: -1,
          max: 1,
          step: 0.05,
          value: edgeStyles.ee.curve,
          onChange: (v) => updateEdgeStyle('ee', { curve: v }),
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
    {
      label: '边 · fNIRS–fNIRS',
      fields: [
        {
          type: 'toggle',
          key: 'ffv',
          label: '显示',
          value: edgeStyles.ff.visible,
          onChange: (v) => updateEdgeStyle('ff', { visible: v }),
        },
        {
          type: 'number',
          key: 'ffw',
          label: '线宽',
          min: 0.5,
          max: 4,
          step: 0.1,
          value: edgeStyles.ff.width,
          onChange: (v) => updateEdgeStyle('ff', { width: v }),
          slider: true,
          format: (v) => v.toFixed(1),
        },
        {
          type: 'number',
          key: 'ffa',
          label: '透明度',
          min: 0.1,
          max: 1,
          step: 0.05,
          value: edgeStyles.ff.alpha,
          onChange: (v) => updateEdgeStyle('ff', { alpha: v }),
          slider: true,
          format: (v) => v.toFixed(2),
        },
        {
          type: 'number',
          key: 'ffc',
          label: '弧度',
          min: -1,
          max: 1,
          step: 0.05,
          value: edgeStyles.ff.curve,
          onChange: (v) => updateEdgeStyle('ff', { curve: v }),
          slider: true,
          format: (v) => v.toFixed(2),
        },
      ],
    },
    {
      label: '边 · 跨模态',
      fields: [
        {
          type: 'toggle',
          key: 'cv',
          label: '显示',
          value: edgeStyles.cross.visible,
          onChange: (v) => updateEdgeStyle('cross', { visible: v }),
        },
        {
          type: 'number',
          key: 'cw',
          label: '线宽',
          min: 0.5,
          max: 4,
          step: 0.1,
          value: edgeStyles.cross.width,
          onChange: (v) => updateEdgeStyle('cross', { width: v }),
          slider: true,
          format: (v) => v.toFixed(1),
        },
        {
          type: 'toggle',
          key: 'cd',
          label: '虚线',
          value: edgeStyles.cross.dashed,
          onChange: (v) => updateEdgeStyle('cross', { dashed: v }),
        },
      ],
    },
    {
      label: '侧边面板',
      fields: [
        {
          type: 'toggle',
          key: 'sec',
          label: 'Edge categories 面板',
          value: sidePanels.edgeCategories.visible,
          onChange: (v) =>
            setSidePanels((s) => ({
              ...s,
              edgeCategories: { ...s.edgeCategories, visible: v },
            })),
        },
        {
          type: 'toggle',
          key: 'sno',
          label: 'Notation 面板',
          value: sidePanels.notation.visible,
          onChange: (v) =>
            setSidePanels((s) => ({
              ...s,
              notation: { ...s.notation, visible: v },
            })),
        },
      ],
    },
  ];

  const slotOptions = [
    { value: '', label: '— 选择 —' },
    ...Object.keys(savedSlots)
      .sort()
      .map((s) => ({ value: s, label: s })),
  ];

  const nodeOptions = ALL_NODES.map((n) => ({
    value: n.id,
    label: `${n.id}（${n.modality.toUpperCase()}）`,
  }));

  /* ------------------------ render ----------------------------------- */

  return (
    <ChartShell
      filename="heterogeneous-graph-construction"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'paper-default',
              label: 'Paper Default (EN)',
              hint: '出版级',
              description:
                '论文 Fig. 4 默认英文期刊版：清晰的 EEG 半圆 + fNIRS 行 + 三类边（EE 蓝、FF 红、跨模态紫虚线）。',
              apply: () => applyConfig(DEFAULT_CONFIG),
            },
            {
              id: 'chinese-annotated',
              label: '中文标注版',
              hint: '中文',
              description:
                '把标题 / 横幅 / HRF 标签 / 侧栏标注切换为中文。导出期刊版前一键切回英文版即可。',
              apply: () => {
                applyConfig(DEFAULT_CONFIG);
                setTitleOverride(
                  '异质图构建 · 双类节点 + 三类边',
                );
                setSubtitleOverride(
                  'EEG 电极 与 fNIRS 通道 共同构成异质图 $G = (V,\\,E)$',
                );
                setHrfTagOverride(
                  '$\\tau_j$ ：跨模态边上的可学习 HRF 时移',
                );
                setVeBannerOverride(
                  '$\\mathbf{V}^{E}$ ：EEG 节点 · 示意；$|\\mathbf{V}^{E}|=N_E=19$（10–20 系统）',
                );
                setVfBannerOverride(
                  '$\\mathbf{V}^{F}$ ：fNIRS 节点 · 示意；$|\\mathbf{V}^{F}|=N_F$（依数据集 10–48）',
                );
              },
            },
            {
              id: 'emphasize-intra',
              label: '突出 intra-modal',
              hint: '强调',
              description:
                '加粗 EEG-EEG 与 fNIRS-fNIRS 同模态边，弱化跨模态边——便于审稿讨论"先单模态聚合再跨模态融合"。',
              apply: () => {
                applyConfig(DEFAULT_CONFIG);
                setEdgeStyles({
                  ee: {
                    ...DEFAULT_EDGE_STYLES.ee,
                    width: 2.4,
                    alpha: 0.95,
                  },
                  ff: {
                    ...DEFAULT_EDGE_STYLES.ff,
                    width: 2.4,
                    alpha: 0.95,
                  },
                  cross: {
                    ...DEFAULT_EDGE_STYLES.cross,
                    width: 1.2,
                    alpha: 0.45,
                  },
                });
              },
            },
            {
              id: 'emphasize-cross',
              label: '突出 cross-modal',
              hint: '强调',
              description:
                '加粗跨模态边、弱化同模态边——讲解"NVC 跨模态耦合是核心"时使用。',
              apply: () => {
                applyConfig(DEFAULT_CONFIG);
                setEdgeStyles({
                  ee: { ...DEFAULT_EDGE_STYLES.ee, width: 1.0, alpha: 0.4 },
                  ff: { ...DEFAULT_EDGE_STYLES.ff, width: 1.0, alpha: 0.4 },
                  cross: {
                    ...DEFAULT_EDGE_STYLES.cross,
                    width: 2.8,
                    alpha: 1,
                  },
                });
              },
            },
            {
              id: 'minimal',
              label: '极简',
              hint: '极简',
              description: '隐藏侧栏与说明横幅，只留图本体。',
              apply: () => {
                applyConfig(DEFAULT_CONFIG);
                setSidePanels({
                  edgeCategories: { visible: false, bodyOverrides: {} },
                  notation: { visible: false, bodyOverrides: {} },
                });
                setToggles({
                  showHrfTag: false,
                  showVeBanner: false,
                  showVfBanner: false,
                  showSubtitle: false,
                  showLegendDivider: false,
                });
              },
            },
          ]}
        />
      }
      inspector={
        <>
          <ControlGroup label="标题">
            <TextArea
              label="标题"
              value={titleText}
              onChange={(v) => setTitleOverride(v)}
              rows={2}
              description="支持 KaTeX：$ ... $ 内为公式。"
            />
            <TextArea
              label="副标题"
              value={subtitleText}
              onChange={(v) => setSubtitleOverride(v)}
              rows={2}
            />
            <Toggle
              label="显示副标题"
              checked={toggles.showSubtitle}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showSubtitle: v }))
              }
            />
          </ControlGroup>

          <ControlGroup label="节点">
            <Select
              label="选中节点"
              value={selectedNodeId}
              options={nodeOptions}
              onChange={setSelectedNodeId}
            />
            <TextArea
              label="节点标签"
              value={selectedNodeOverride.label ?? ''}
              onChange={(v) =>
                updateNodeOverride(selectedNodeId, {
                  label: v || undefined,
                })
              }
              rows={1}
              placeholder={selectedNodeBase.label}
              description="留空使用默认。$...$ 内为 KaTeX。"
            />
            <NumberSlider
              label="dx"
              value={selectedNodeOverride.dx ?? 0}
              min={-200}
              max={200}
              step={1}
              onChange={(v) =>
                updateNodeOverride(selectedNodeId, {
                  dx: v === 0 ? undefined : v,
                })
              }
            />
            <NumberSlider
              label="dy"
              value={selectedNodeOverride.dy ?? 0}
              min={-200}
              max={200}
              step={1}
              onChange={(v) =>
                updateNodeOverride(selectedNodeId, {
                  dy: v === 0 ? undefined : v,
                })
              }
            />
            <button
              type="button"
              onClick={() => setNodeOverrides({})}
              className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
            >
              全部节点复位
            </button>
          </ControlGroup>

          <ControlGroup label="EEG–EEG 边">
            <Toggle
              label="显示"
              checked={edgeStyles.ee.visible}
              onChange={(v) => updateEdgeStyle('ee', { visible: v })}
            />
            <NumberSlider
              label="线宽"
              value={edgeStyles.ee.width}
              min={0.5}
              max={4}
              step={0.1}
              onChange={(v) => updateEdgeStyle('ee', { width: v })}
              format={(v) => v.toFixed(1)}
            />
            <NumberSlider
              label="透明度"
              value={edgeStyles.ee.alpha}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => updateEdgeStyle('ee', { alpha: v })}
              format={(v) => v.toFixed(2)}
            />
            <NumberSlider
              label="弧度（负=向上拱）"
              value={edgeStyles.ee.curve}
              min={-1}
              max={1}
              step={0.05}
              onChange={(v) => updateEdgeStyle('ee', { curve: v })}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>

          <ControlGroup label="fNIRS–fNIRS 边">
            <Toggle
              label="显示"
              checked={edgeStyles.ff.visible}
              onChange={(v) => updateEdgeStyle('ff', { visible: v })}
            />
            <NumberSlider
              label="线宽"
              value={edgeStyles.ff.width}
              min={0.5}
              max={4}
              step={0.1}
              onChange={(v) => updateEdgeStyle('ff', { width: v })}
              format={(v) => v.toFixed(1)}
            />
            <NumberSlider
              label="透明度"
              value={edgeStyles.ff.alpha}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => updateEdgeStyle('ff', { alpha: v })}
              format={(v) => v.toFixed(2)}
            />
            <NumberSlider
              label="弧度（正=向下拱）"
              value={edgeStyles.ff.curve}
              min={-1}
              max={1}
              step={0.05}
              onChange={(v) => updateEdgeStyle('ff', { curve: v })}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>

          <ControlGroup label="跨模态边">
            <Toggle
              label="显示"
              checked={edgeStyles.cross.visible}
              onChange={(v) => updateEdgeStyle('cross', { visible: v })}
            />
            <Toggle
              label="虚线"
              checked={edgeStyles.cross.dashed}
              onChange={(v) => updateEdgeStyle('cross', { dashed: v })}
            />
            <NumberSlider
              label="线宽"
              value={edgeStyles.cross.width}
              min={0.5}
              max={4}
              step={0.1}
              onChange={(v) => updateEdgeStyle('cross', { width: v })}
              format={(v) => v.toFixed(1)}
            />
            <NumberSlider
              label="透明度"
              value={edgeStyles.cross.alpha}
              min={0.1}
              max={1}
              step={0.05}
              onChange={(v) => updateEdgeStyle('cross', { alpha: v })}
              format={(v) => v.toFixed(2)}
            />
          </ControlGroup>

          <ControlGroup label="侧栏">
            <Toggle
              label="Edge categories 面板"
              checked={sidePanels.edgeCategories.visible}
              onChange={(v) =>
                setSidePanels((s) => ({
                  ...s,
                  edgeCategories: { ...s.edgeCategories, visible: v },
                }))
              }
            />
            <Toggle
              label="Notation 面板"
              checked={sidePanels.notation.visible}
              onChange={(v) =>
                setSidePanels((s) => ({
                  ...s,
                  notation: { ...s.notation, visible: v },
                }))
              }
            />
            <Toggle
              label="V^E 横幅"
              checked={toggles.showVeBanner}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showVeBanner: v }))
              }
            />
            <Toggle
              label="V^F 横幅"
              checked={toggles.showVfBanner}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showVfBanner: v }))
              }
            />
            <Toggle
              label="HRF 标签 (τ_j)"
              checked={toggles.showHrfTag}
              onChange={(v) =>
                setToggles((t) => ({ ...t, showHrfTag: v }))
              }
            />
          </ControlGroup>

          <ControlGroup label="配置 / 自动保存">
            <p className="text-[11px] text-ink-300">
              每 5 分钟自动检查；如有变更会以
              {' '}<code>auto-#N (时间戳)</code>{' '}
              名义新增 slot，旧配置永不丢失。打开本图时自动加载最近的 slot。
            </p>
            <label className="flex flex-col gap-1 text-xs text-ink-200">
              <span>配置名</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newSlotName}
                  onChange={(e) => setNewSlotName(e.target.value)}
                  placeholder="例如：fig4-v3"
                  className="flex-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-ink-50 focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newSlotName.trim()}
                  onClick={handleSaveSlot}
                  className="rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-ink-50 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  保存当前
                </button>
              </div>
            </label>
            <Select
              label="本地配置 slot"
              value={activeSlotName}
              options={slotOptions}
              onChange={setActiveSlotName}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!activeSlotName}
                onClick={handleLoadSlot}
                className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                载入
              </button>
              <button
                type="button"
                disabled={!activeSlotName}
                onClick={handleDeleteSlot}
                className="rounded border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[11px] text-ink-50 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
              >
                删除
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadJson(
                    'heterogeneous-graph-construction.json',
                    buildCurrentConfig(),
                  )
                }
                className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
              >
                导出 JSON
              </button>
              <label className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 cursor-pointer">
                导入 JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      f.text().then((txt) => {
                        try {
                          const cfg = JSON.parse(txt) as SavedConfig;
                          applyConfig(cfg);
                        } catch {
                          // ignore
                        }
                      });
                    }
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </ControlGroup>
        </>
      }
      notes={
        <p>
          异质图构建 (论文 Fig. 4)：将 EEG 电极（半圆排列）与 fNIRS 通道（底排）
          视作两类节点 V<sup>E</sup> 与 V<sup>F</sup>，在同一张图 G = (V,E) 上区分
          三类边 ── 同模态 EEG-EEG（蓝色实线）、同模态 fNIRS-fNIRS（红色实线）、
          跨模态（紫色虚线，附 τ<sub>j</sub> HRF 时移）。两类同模态边的拱形相反，
          避免视觉冲突；跨模态用虚线突出"非物理近邻"。Inspector 支持单独切换每类边
          的可见 / 线宽 / 透明度 / 弧度，拖动任一节点重新布局，多 slot 配置保存 +
          JSON 导入导出 + 5 分钟自动保存（旧版本不丢失）+ 打开图时自动加载最新配置。
        </p>
      }
      figure={
        <svg
          ref={svgRef}
          className="figure-svg"
          width={W_FIG}
          height={H_FIG}
          viewBox={`0 0 ${W_FIG} ${H_FIG}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Background */}
          <rect x={0} y={0} width={W_FIG} height={H_FIG} fill="#ffffff" />

          {/* Title */}
          <foreignObject
            x={20}
            y={TITLE_Y - 20}
            width={W_FIG - 40}
            height={36}
            data-latex={titleText}
            data-latex-font-size={20}
            data-latex-font-weight={700}
            data-latex-text-align="center"
          >
            <div
              style={{
                fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
                fontSize: 20,
                fontWeight: 700,
                color: '#222',
                textAlign: 'center',
                lineHeight: 1.2,
              }}
              dangerouslySetInnerHTML={{
                __html: renderInlineLatex(titleText),
              }}
            />
          </foreignObject>

          {toggles.showSubtitle ? (
            <foreignObject
              x={20}
              y={SUBTITLE_Y - 18}
              width={W_FIG - 40}
              height={28}
              data-latex={subtitleText}
              data-latex-font-size={13}
              data-latex-font-style="italic"
              data-latex-text-align="center"
            >
              <div
                style={{
                  fontFamily:
                    'Inter, "Noto Sans SC", system-ui, sans-serif',
                  fontSize: 13,
                  fontStyle: 'italic',
                  color: COL.dim,
                  textAlign: 'center',
                  lineHeight: 1.2,
                }}
                dangerouslySetInnerHTML={{
                  __html: renderInlineLatex(subtitleText),
                }}
              />
            </foreignObject>
          ) : null}

          {toggles.showLegendDivider ? (
            <line
              x1={48}
              y1={DIVIDER_Y}
              x2={W_FIG - 48}
              y2={DIVIDER_Y}
              stroke="#cccccc"
              strokeWidth={0.8}
            />
          ) : null}

          {/* Banners */}
          {toggles.showVeBanner ? (
            <foreignObject
              x={GX0 + 18}
              y={140}
              width={GX1 - GX0 - 36}
              height={28}
              data-latex={veBannerText}
              data-latex-font-size={12.5}
            >
              <div
                style={{
                  fontFamily:
                    'Inter, "Noto Sans SC", system-ui, sans-serif',
                  fontSize: 12.5,
                  color: COL.eegEdge,
                  fontWeight: 600,
                }}
                dangerouslySetInnerHTML={{
                  __html: renderInlineLatex(veBannerText),
                }}
              />
            </foreignObject>
          ) : null}

          {toggles.showVfBanner ? (
            <foreignObject
              x={GX0 + 18}
              y={H_FIG - 60}
              width={GX1 - GX0 - 36}
              height={28}
              data-latex={vfBannerText}
              data-latex-font-size={12.5}
            >
              <div
                style={{
                  fontFamily:
                    'Inter, "Noto Sans SC", system-ui, sans-serif',
                  fontSize: 12.5,
                  color: COL.fnirsEdge,
                  fontWeight: 600,
                }}
                dangerouslySetInnerHTML={{
                  __html: renderInlineLatex(vfBannerText),
                }}
              />
            </foreignObject>
          ) : null}

          {/* Edges - intra EEG */}
          {edgeStyles.ee.visible ? (
            <g>
              {ALL_EDGES.filter((e) => e.kind === 'ee').map((e, idx) => {
                const a = nodeMap.get(e.from);
                const b = nodeMap.get(e.to);
                if (!a || !b) return null;
                return (
                  <EdgePath
                    key={`ee-${idx}`}
                    from={a}
                    to={b}
                    style={edgeStyles.ee}
                  />
                );
              })}
            </g>
          ) : null}

          {/* Edges - intra fNIRS */}
          {edgeStyles.ff.visible ? (
            <g>
              {ALL_EDGES.filter((e) => e.kind === 'ff').map((e, idx) => {
                const a = nodeMap.get(e.from);
                const b = nodeMap.get(e.to);
                if (!a || !b) return null;
                return (
                  <EdgePath
                    key={`ff-${idx}`}
                    from={a}
                    to={b}
                    style={edgeStyles.ff}
                  />
                );
              })}
            </g>
          ) : null}

          {/* Edges - cross modal */}
          {edgeStyles.cross.visible ? (
            <g>
              {ALL_EDGES.filter((e) => e.kind === 'cross').map((e, idx) => {
                const a = nodeMap.get(e.from);
                const b = nodeMap.get(e.to);
                if (!a || !b) return null;
                return (
                  <EdgePath
                    key={`cr-${idx}`}
                    from={a}
                    to={b}
                    style={edgeStyles.cross}
                  />
                );
              })}
            </g>
          ) : null}

          {/* HRF tag bbox */}
          {toggles.showHrfTag && edgeStyles.cross.visible ? (
            <g transform={`translate(${GX1 - 290}, 200)`}>
              <rect
                x={0}
                y={0}
                width={290}
                height={28}
                rx={6}
                ry={6}
                fill="#ffffff"
                stroke={COL.cross}
                strokeWidth={1}
                fillOpacity={0.95}
              />
              <foreignObject
                x={6}
                y={4}
                width={278}
                height={22}
                data-latex={hrfTagText}
                data-latex-font-size={12}
                data-latex-font-style="italic"
              >
                <div
                  style={{
                    fontFamily:
                      'Inter, "Noto Sans SC", system-ui, sans-serif',
                    fontSize: 12,
                    color: COL.cross,
                    fontStyle: 'italic',
                    textAlign: 'center',
                    lineHeight: '20px',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: renderInlineLatex(hrfTagText),
                  }}
                />
              </foreignObject>
            </g>
          ) : null}

          {/* Drag-snap alignment guides (helper, never exported) */}
          {drag.guides.v.length > 0 || drag.guides.h.length > 0 ? (
            <g data-export="false">
              {drag.guides.v.map((g, i) => (
                <line
                  key={`gv-${i}`}
                  x1={g.coord}
                  y1={0}
                  x2={g.coord}
                  y2={H_FIG}
                  stroke={g.source === 'canvas' ? '#d97a3a' : '#5b8def'}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.85}
                />
              ))}
              {drag.guides.h.map((g, i) => (
                <line
                  key={`gh-${i}`}
                  x1={0}
                  y1={g.coord}
                  x2={W_FIG}
                  y2={g.coord}
                  stroke={g.source === 'canvas' ? '#d97a3a' : '#5b8def'}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.85}
                />
              ))}
            </g>
          ) : null}

          {/* Nodes */}
          <g>
            {resolvedNodes.map((n) => {
              const isEeg = n.modality === 'eeg';
              const fill = isEeg ? COL.eegFill : COL.fnirsFill;
              const stroke = isEeg ? COL.eegEdge : COL.fnirsEdge;
              const isSelected = selectedNodeId === n.id;
              const isDraggingThis = drag.draggingId === n.id;
              return (
                <g
                  key={n.id}
                  data-panel-id={n.id}
                  style={{
                    cursor: isDraggingThis ? 'grabbing' : 'grab',
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => drag.onPointerDown(n.id, e)}
                  onPointerMove={drag.onPointerMove}
                  onPointerUp={drag.onPointerUp}
                  onPointerCancel={drag.onPointerUp}
                  onClick={() => {
                    if (drag.consumeDragSuppression()) return;
                    setSelectedNodeId(n.id);
                  }}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={NODE_R}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={isSelected ? 2.4 : 1.6}
                  />
                  {isSelected ? (
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={NODE_R + 4}
                      fill="none"
                      stroke="#3050a0"
                      strokeDasharray="3 2"
                      strokeWidth={1}
                      data-export="false"
                    />
                  ) : null}
                  <foreignObject
                    x={n.x - NODE_R}
                    y={n.y - 11}
                    width={NODE_R * 2}
                    height={22}
                    data-latex={n.label}
                    data-latex-font-size={13}
                    data-latex-font-weight={700}
                    data-latex-color={stroke}
                    style={{ pointerEvents: 'none' }}
                  >
                    <div
                      style={{
                        fontFamily:
                          'Inter, "Noto Sans SC", system-ui, sans-serif',
                        fontSize: 13,
                        fontWeight: 700,
                        color: stroke,
                        textAlign: 'center',
                        lineHeight: '22px',
                      }}
                      dangerouslySetInnerHTML={{
                        __html: renderInlineLatex(n.label),
                      }}
                    />
                  </foreignObject>
                </g>
              );
            })}
          </g>

          {/* Side panels */}
          {sidePanelsConfig.map((p) =>
            sidePanels[p.key].visible ? (
              <SidePanelView key={p.key} def={p} x={PX} w={PW} />
            ) : null,
          )}
        </svg>
      }
    />
  );
}

/* ----------------------- pure SVG sub-components ---------------------- */

interface EdgePathProps {
  from: NodeSpec;
  to: NodeSpec;
  style: EdgeKindStyle;
}

function EdgePath({ from, to, style }: EdgePathProps) {
  // Quadratic-arc path between two node centers; curvature param shifts
  // the midpoint perpendicular to the segment.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const offset = style.curve * len * 0.35;
  const mx = (from.x + to.x) / 2 + nx * offset;
  const my = (from.y + to.y) / 2 + ny * offset;
  // Trim path so it doesn't dive under the node circles.
  const trim = NODE_R - 1;
  const sx = from.x + (dx / len) * trim;
  const sy = from.y + (dy / len) * trim;
  const ex = to.x - (dx / len) * trim;
  const ey = to.y - (dy / len) * trim;
  const d = `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
  return (
    <path
      d={d}
      stroke={style.color}
      strokeWidth={style.width}
      strokeOpacity={style.alpha}
      strokeDasharray={style.dashed ? '5 3' : undefined}
      strokeLinecap="round"
      fill="none"
    />
  );
}

interface SidePanelViewProps {
  def: SidePanelDef;
  x: number;
  w: number;
}

function SidePanelView({ def, x, w }: SidePanelViewProps) {
  const { y, height } = def;
  const padX = 16;
  const headerY = 28;
  const lineH = 24;
  const innerW = w - padX * 2;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={height}
        rx={10}
        ry={10}
        fill={def.fill}
        stroke={def.edge}
        strokeWidth={1.4}
      />
      <foreignObject
        x={x + padX}
        y={y + headerY - 18}
        width={innerW}
        height={28}
        data-latex={def.title}
        data-latex-font-size={14}
        data-latex-font-weight={700}
        data-latex-text-align="center"
      >
        <div
          style={{
            fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
            fontSize: 14,
            fontWeight: 700,
            color: def.edge,
            textAlign: 'center',
          }}
          dangerouslySetInnerHTML={{
            __html: renderInlineLatex(def.title),
          }}
        />
      </foreignObject>
      {def.body.map((line, i) => {
        const ly = y + headerY + 16 + i * lineH;
        if (line.kind === 'gap') {
          return null;
        }
        if (line.kind === 'swatch') {
          return (
            <g key={i}>
              <line
                x1={x + padX}
                y1={ly}
                x2={x + padX + 28}
                y2={ly}
                stroke={line.color}
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeDasharray={line.dashed ? '5 3' : undefined}
              />
              <foreignObject
                x={x + padX + 38}
                y={ly - 11}
                width={innerW - 38}
                height={22}
                data-latex={line.label}
                data-latex-font-size={12}
              >
                <div
                  style={{
                    fontFamily:
                      'Inter, "Noto Sans SC", system-ui, sans-serif',
                    fontSize: 12,
                    color: '#222',
                    lineHeight: '22px',
                  }}
                  dangerouslySetInnerHTML={{
                    __html: renderInlineLatex(line.label),
                  }}
                />
              </foreignObject>
            </g>
          );
        }
        return (
          <foreignObject
            key={i}
            x={x + padX}
            y={ly - 11}
            width={innerW}
            height={22}
            data-latex={line.text}
            data-latex-font-size={line.size ?? 12}
          >
            <div
              style={{
                fontFamily:
                  'Inter, "Noto Sans SC", system-ui, sans-serif',
                fontSize: line.size ?? 12,
                color: line.muted ? COL.dim : COL.bodyText,
                fontStyle: line.muted ? 'italic' : 'normal',
                textAlign: 'center',
                lineHeight: '22px',
              }}
              dangerouslySetInnerHTML={{
                __html: renderInlineLatex(line.text),
              }}
            />
          </foreignObject>
        );
      })}
    </g>
  );
}

/* ---------------------------- registry -------------------------------- */

registerChart({
  id: 'heterogeneous-graph-construction',
  title: '异质图构建',
  titleEn: 'Heterogeneous Graph Construction',
  category: 'architecture',
  summary:
    '双类节点（EEG ∪ fNIRS）+ 三类边（EE 同模态 / FF 同模态 / 跨模态 with τ_j HRF）。配 Edge categories + Notation 侧栏。',
  component: HeterogeneousGraphChart,
});
