import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { FigureFrame } from '../../components/FigureFrame';
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
import { renderInlineLatex } from '../../lib/latex';
import { registerChart } from '../../registry';

/* ----------------------------- types -----------------------------------*/

type Category =
  | 'input'
  | 'temporal'
  | 'spectral'
  | 'feat'
  | 'output';

type Align = 'left' | 'center' | 'right';
type EdgeStyle = 'solid' | 'dashed' | 'dotted';

const ALIGN_OPTIONS: ReadonlyArray<{ value: Align; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
];

const EDGE_STYLE_OPTIONS: ReadonlyArray<{ value: EdgeStyle; label: string }> = [
  { value: 'solid', label: '实线' },
  { value: 'dashed', label: '虚线' },
  { value: 'dotted', label: '点线' },
];

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

/**
 * Per-line styling override applied to a single body line within a
 * panel. Anything left undefined falls back to the panel-level
 * defaults (which in turn fall back to the chart-level globals).
 */
interface LineOverride {
  /** Replace the inherited body font size (px). */
  size?: number;
  /** 400 (normal) or 700 (bold). */
  weight?: number;
  /** True = italic. */
  italic?: boolean;
  /** Text colour as a hex string (e.g. `#1c1c1c`). */
  color?: string;
  /** Per-line alignment override (left / center / right). */
  align?: Align;
  /** Horizontal offset in px (positive = move right). */
  dx?: number;
}

type LineOverrideMap = Record<string, LineOverride>;

/**
 * Per-panel UI overrides. Empty / undefined fields fall back to the
 * baseline `EEG_ENCODER_PANELS` entry and the global header / body
 * font sizes. Stored as a plain map so the inspector can edit each
 * panel independently without touching the underlying preset.
 */
interface PanelOverride {
  /** Replace the header text (supports `\n` for multi-line). */
  header?: string;
  /** Newline-delimited lines (one body line per `\n`). */
  bodyText?: string;
  headerSize?: number;
  bodySize?: number;
  /** Multiplier on `bodySize` for line spacing (default 1.5). */
  lineSpacing?: number;
  headerAlign?: Align;
  bodyAlign?: Align;
  /** When true, body lines wider than the panel are scaled to fit. */
  bodyAutoFit?: boolean;
  /** Override the slot width (px). Defaults to global panel width. */
  width?: number;
  /** Override the slot height (px). Defaults to global panel height
   *  (or 2× row spacing for `rowSpan: 2`). */
  height?: number;
  /** Position offsets relative to the grid slot (px). */
  dx?: number;
  dy?: number;
  /**
   * Per-line styling overrides keyed by line index (as a string). Out
   * of bounds entries (line removed) are ignored at render time and
   * cleaned up when the body text changes.
   */
  lineOverrides?: LineOverrideMap;
}

type PanelOverrideMap = Record<string, PanelOverride>;

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
  style?: EdgeStyle;
  thickness?: number;
  /** Optional inline label rendered next to the arrow midpoint. */
  label?: string;
}

interface EdgeOverride {
  hidden?: boolean;
  style?: EdgeStyle;
  thickness?: number;
  /** Replace label text. Empty string clears the label. */
  label?: string;
  /** Endpoint y-fraction overrides (0..1). */
  fromYFrac?: number;
  toYFrac?: number;
  /** Endpoint pixel offsets (added on top of computed anchor points). */
  fromDx?: number;
  fromDy?: number;
  toDx?: number;
  toDy?: number;
  /** Label offset relative to the midpoint (px). */
  labelDx?: number;
  labelDy?: number;
}

type EdgeOverrideMap = Record<string, EdgeOverride>;

interface Annotation {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  color: string;
  align: Align;
  bold?: boolean;
  italic?: boolean;
}

/** Persisted on-disk / in-localStorage config snapshot. */
interface SavedConfig {
  version: 1;
  global: {
    colSpacing: number;
    rowSpacing: number;
    panelWidth: number;
    panelHeight: number;
    headerSize: number;
    bodySize: number;
    showLegend: boolean;
    showSubtitle: boolean;
  };
  panelOverrides: PanelOverrideMap;
  edgeOverrides: EdgeOverrideMap;
  annotations: Annotation[];
}

/* ------------------------- color palette -------------------------------*/

interface CategoryStyle {
  fill: string;
  edge: string;
  text: string;
  legend: string;
}

const PALETTE: Record<Category, CategoryStyle> = {
  input: {
    fill: '#E8F1FB',
    edge: '#1F4E79',
    text: '#1F4E79',
    legend: 'Input  /  pooling',
  },
  temporal: {
    fill: '#E1ECF8',
    edge: '#2E5C8A',
    text: '#2E5C8A',
    legend: '1D temporal branch',
  },
  spectral: {
    fill: '#F1E6F4',
    edge: '#5B3577',
    text: '#5B3577',
    legend: '2D spectral branch',
  },
  feat: {
    fill: '#FFF4D6',
    edge: '#8A6A0A',
    text: '#8A6A0A',
    legend: 'Branch embedding',
  },
  output: {
    fill: '#E1F2E2',
    edge: '#1F6F2A',
    text: '#1F6F2A',
    legend: 'Output  ($\\mathbf{H}^{E}$)',
  },
};

/* ------------------ EEG Encoder default preset (Fig.2) ------------------*/

const EEG_ENCODER_PANELS: PanelSpec[] = [
  // Column 0 — Input (spans both rows)
  {
    id: 'in',
    col: 0,
    row: 0,
    rowSpan: 2,
    category: 'input',
    header: 'EEG  Input',
    body: [
      '',
      '$\\mathbf{X}^{E}\\in\\mathbb{R}^{N_E\\times T_E}$',
      '$f_E = 256$ Hz',
      'window  $W = 30$ s',
      '',
      '$N_E = 19$  channels',
      '$T_E = 7680$  samples',
    ],
  },
  // Column 1 — Stage 1 (1D temporal top, 2D spectral bottom)
  {
    id: 'stg1-top',
    col: 1,
    row: 0,
    category: 'temporal',
    header: 'DSConv1D  ×  4',
    body: [
      'BN  +  GELU',
      'Total temporal stride = 4',
      'kernel = 7,  $C_{1D} = 64$',
    ],
  },
  {
    id: 'stg1-bot',
    col: 1,
    row: 1,
    category: 'spectral',
    header: 'STFT',
    body: [
      'Hann window  256 ms',
      '75 \\% overlap',
      '$\\rightarrow$  log-mag spectrogram',
    ],
  },
  // Column 2 — Stage 2
  {
    id: 'stg2-top',
    col: 2,
    row: 0,
    category: 'temporal',
    header: 'Adaptive\nAvgPool-1D',
    body: [
      'along time axis',
      '$N_E\\!\\times\\!C_{1D}\\!\\times\\!T^{\\prime}\\;\\rightarrow\\;N_E\\!\\times\\!C_{1D}$',
      'temporal compression',
    ],
  },
  {
    id: 'stg2-bot',
    col: 2,
    row: 1,
    category: 'spectral',
    header: 'Conv2D  ×  3',
    body: [
      'BN  +  GELU',
      'kernel  $3\\times 5$  (freq × time)',
      'MaxPool-2D  per stage',
    ],
  },
  // Column 3 — Stage 3 (branch embeddings)
  {
    id: 'stg3-top',
    col: 3,
    row: 0,
    category: 'feat',
    header: 'Temporal\nEmbedding',
    body: [
      '$\\mathbf{Z}^{E,t}_{4}$',
      '$\\in\\mathbb{R}^{N_E\\times d_t}$',
      '$d_t = 64$',
    ],
  },
  {
    id: 'stg3-bot',
    col: 3,
    row: 1,
    category: 'feat',
    header: 'Spectral\nEmbedding',
    body: [
      '$\\mathbf{Z}^{E,f}_{3}$',
      '$\\in\\mathbb{R}^{N_E\\times d_f}$',
      '$d_f = 64$',
    ],
  },
  // Column 4 — Concat + AvgPool (spans both rows)
  {
    id: 'concat',
    col: 4,
    row: 0,
    rowSpan: 2,
    category: 'input',
    header: 'Concat  +  AvgPool',
    body: [
      '',
      '$\\mathbf{H}^{E}=\\mathrm{Pool}\\!\\left(\\mathbf{Z}^{E,t}_{4}\\,\\Vert\\,\\mathbf{Z}^{E,f}_{3}\\right)$',
      '',
      'channel-wise concat',
      'adaptive pool over time',
    ],
  },
  // Column 5 — Output (spans both rows)
  {
    id: 'out',
    col: 5,
    row: 0,
    rowSpan: 2,
    category: 'output',
    header: 'Output',
    body: [
      '$\\mathbf{H}^{E}\\in\\mathbb{R}^{N_E\\times d_E}$',
      '$d_E = 128$',
      'EEG node features',
      'into  GAT',
    ],
  },
];

const EEG_ENCODER_EDGES: EdgeSpec[] = [
  // Input fans out into both branches
  { id: 'in-stg1-top', from: 'in', to: 'stg1-top', category: 'temporal' },
  { id: 'in-stg1-bot', from: 'in', to: 'stg1-bot', category: 'spectral' },
  // 1D temporal branch
  {
    id: 'stg1-stg2-top',
    from: 'stg1-top',
    to: 'stg2-top',
    category: 'temporal',
  },
  {
    id: 'stg2-stg3-top',
    from: 'stg2-top',
    to: 'stg3-top',
    category: 'temporal',
  },
  // 2D spectral branch
  {
    id: 'stg1-stg2-bot',
    from: 'stg1-bot',
    to: 'stg2-bot',
    category: 'spectral',
  },
  {
    id: 'stg2-stg3-bot',
    from: 'stg2-bot',
    to: 'stg3-bot',
    category: 'spectral',
  },
  // Both embeddings funnel into Concat
  {
    id: 'stg3-concat-top',
    from: 'stg3-top',
    to: 'concat',
    category: 'feat',
    toYFrac: 0.32,
  },
  {
    id: 'stg3-concat-bot',
    from: 'stg3-bot',
    to: 'concat',
    category: 'feat',
    toYFrac: 0.68,
  },
  // Heavy connector: Concat -> Output
  {
    id: 'concat-out',
    from: 'concat',
    to: 'out',
    category: 'input',
    thickness: 2,
  },
];

/* -------------------------- localStorage -------------------------------*/

const STORAGE_KEY = 'eeg-encoder-detail-saved-configs-v1';
type SavedConfigsMap = Record<string, SavedConfig>;

function loadStoredConfigs(): SavedConfigsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedConfigsMap;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed;
  } catch {
    return {};
  }
}

function persistConfigs(map: SavedConfigsMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Quota exceeded or storage unavailable — silently no-op.
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
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* --------------------------- chart impl --------------------------------*/

function EegEncoderDetailChart() {
  const [colSpacing, setColSpacing] = useState(180);
  const [rowSpacing, setRowSpacing] = useState(170);
  const [panelWidth, setPanelWidth] = useState(170);
  const [panelHeight, setPanelHeight] = useState(130);
  const [headerSize, setHeaderSize] = useState(13);
  const [bodySize, setBodySize] = useState(11);
  const [showLegend, setShowLegend] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);

  const [panelOverrides, setPanelOverrides] = useState<PanelOverrideMap>({});
  const [edgeOverrides, setEdgeOverrides] = useState<EdgeOverrideMap>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [selectedPanelId, setSelectedPanelId] = useState<string>(
    EEG_ENCODER_PANELS[0].id,
  );

  /**
   * When the user clicks a header / body line in the preview SVG, the chart
   * dispatches a `focusRequest` so the inspector knows which textarea to
   * focus (and which line to highlight). The `nonce` makes useEffect refire
   * even if the same target is clicked twice in a row.
   */
  const [focusRequest, setFocusRequest] = useState<
    | { kind: 'panel-header'; panelId: string; nonce: number }
    | {
        kind: 'panel-body-line';
        panelId: string;
        lineIndex: number;
        nonce: number;
      }
    | null
  >(null);
  /**
   * Sticky pointer to the body line currently being styled. Set when
   * the user clicks a body line in the preview, cleared when the user
   * clicks a header / picks a different panel via the dropdown. The
   * inspector reads this to render the per-line styling sub-section.
   */
  const [selectedBodyLine, setSelectedBodyLine] = useState<{
    panelId: string;
    lineIndex: number;
  } | null>(null);

  const requestFocusHeader = useCallback((panelId: string) => {
    setSelectedPanelId(panelId);
    setSelectedBodyLine(null);
    setFocusRequest({
      kind: 'panel-header',
      panelId,
      nonce: Date.now() + Math.random(),
    });
  }, []);
  const requestFocusBodyLine = useCallback(
    (panelId: string, lineIndex: number) => {
      setSelectedPanelId(panelId);
      setSelectedBodyLine({ panelId, lineIndex });
      setFocusRequest({
        kind: 'panel-body-line',
        panelId,
        lineIndex,
        nonce: Date.now() + Math.random(),
      });
    },
    [],
  );

  const [selectedEdgeId, setSelectedEdgeId] = useState<string>(
    EEG_ENCODER_EDGES[0].id,
  );
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<
    string | null
  >(null);

  const [savedConfigs, setSavedConfigs] =
    useState<SavedConfigsMap>(() => loadStoredConfigs());

  const svgRef = useRef<SVGSVGElement>(null);

  /* ------------------ override mutators (panels) -----------------------*/

  /**
   * Strip empty fields from a `PanelOverride` so we don't leave stale
   * `lineOverrides: {}` (etc.) lying around after a reset.
   */
  function pruneOverride(o: PanelOverride): PanelOverride {
    const next: PanelOverride = { ...o };
    if (next.lineOverrides) {
      const pruned: LineOverrideMap = {};
      for (const [k, v] of Object.entries(next.lineOverrides)) {
        if (v && Object.keys(v).length > 0) pruned[k] = v;
      }
      if (Object.keys(pruned).length === 0) {
        delete next.lineOverrides;
      } else {
        next.lineOverrides = pruned;
      }
    }
    for (const key of Object.keys(next) as (keyof PanelOverride)[]) {
      if (next[key] === undefined || next[key] === '') delete next[key];
    }
    return next;
  }

  const updatePanelOverride = useCallback(
    (panelId: string, patch: Partial<PanelOverride>) => {
      setPanelOverrides((prev) => {
        const cur = prev[panelId] ?? {};
        const next = pruneOverride({ ...cur, ...patch });
        if (Object.keys(next).length === 0) {
          const { [panelId]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        }
        return { ...prev, [panelId]: next };
      });
    },
    [],
  );

  /**
   * Patch the per-line styling for a single body line. Pass `null`
   * for `patch` to drop the entire line override (the line falls back
   * to panel defaults).
   */
  const updateLineOverride = useCallback(
    (
      panelId: string,
      lineIndex: number,
      patch: Partial<LineOverride> | null,
    ) => {
      setPanelOverrides((prev) => {
        const cur = prev[panelId] ?? {};
        const lineKey = String(lineIndex);
        const curLines = cur.lineOverrides ?? {};
        const curLine = curLines[lineKey] ?? {};
        let nextLine: LineOverride;
        if (patch === null) {
          nextLine = {};
        } else {
          nextLine = { ...curLine, ...patch };
          for (const key of Object.keys(nextLine) as (keyof LineOverride)[]) {
            if (nextLine[key] === undefined || nextLine[key] === '')
              delete nextLine[key];
          }
        }
        const nextLines: LineOverrideMap = { ...curLines };
        if (Object.keys(nextLine).length === 0) {
          delete nextLines[lineKey];
        } else {
          nextLines[lineKey] = nextLine;
        }
        const nextOverride = pruneOverride({
          ...cur,
          lineOverrides: nextLines,
        });
        if (Object.keys(nextOverride).length === 0) {
          const { [panelId]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        }
        return { ...prev, [panelId]: nextOverride };
      });
    },
    [],
  );

  const resetPanel = useCallback((panelId: string) => {
    setPanelOverrides((prev) => {
      if (!(panelId in prev)) return prev;
      const { [panelId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }, []);

  const resetAllPanels = useCallback(() => setPanelOverrides({}), []);

  /* ------------------ override mutators (edges) ------------------------*/

  const updateEdgeOverride = useCallback(
    (edgeId: string, patch: Partial<EdgeOverride>) => {
      setEdgeOverrides((prev) => {
        const cur = prev[edgeId] ?? {};
        const next: EdgeOverride = { ...cur, ...patch };
        for (const key of Object.keys(next) as (keyof EdgeOverride)[]) {
          if (next[key] === undefined) delete next[key];
        }
        if (Object.keys(next).length === 0) {
          const { [edgeId]: _drop, ...rest } = prev;
          void _drop;
          return rest;
        }
        return { ...prev, [edgeId]: next };
      });
    },
    [],
  );

  const resetEdge = useCallback((edgeId: string) => {
    setEdgeOverrides((prev) => {
      if (!(edgeId in prev)) return prev;
      const { [edgeId]: _drop, ...rest } = prev;
      void _drop;
      return rest;
    });
  }, []);

  const resetAllEdges = useCallback(() => setEdgeOverrides({}), []);

  /* ----------------------- annotations ---------------------------------*/

  const addAnnotation = useCallback(() => {
    const id = `ann-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    setAnnotations((prev) => {
      // Place new annotations near the top-left of the canvas, offset
      // slightly so successive adds don't perfectly stack.
      const stagger = (prev.length % 5) * 14;
      const ann: Annotation = {
        id,
        text: 'New annotation',
        x: 60 + stagger,
        y: 60 + stagger,
        width: 160,
        fontSize: 11,
        color: '#1c1c1c',
        align: 'left',
      };
      return [...prev, ann];
    });
    setSelectedAnnotationId(id);
  }, []);

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      setAnnotations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      );
    },
    [],
  );

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
    setSelectedAnnotationId((cur) => (cur === id ? null : cur));
  }, []);

  /* -------------------- save / load configs ----------------------------*/

  const buildCurrentConfig = useCallback((): SavedConfig => {
    return {
      version: 1,
      global: {
        colSpacing,
        rowSpacing,
        panelWidth,
        panelHeight,
        headerSize,
        bodySize,
        showLegend,
        showSubtitle,
      },
      panelOverrides,
      edgeOverrides,
      annotations,
    };
  }, [
    colSpacing,
    rowSpacing,
    panelWidth,
    panelHeight,
    headerSize,
    bodySize,
    showLegend,
    showSubtitle,
    panelOverrides,
    edgeOverrides,
    annotations,
  ]);

  const applyConfig = useCallback((cfg: SavedConfig) => {
    if (!cfg || cfg.version !== 1) return;
    setColSpacing(cfg.global.colSpacing);
    setRowSpacing(cfg.global.rowSpacing);
    setPanelWidth(cfg.global.panelWidth);
    setPanelHeight(cfg.global.panelHeight);
    setHeaderSize(cfg.global.headerSize);
    setBodySize(cfg.global.bodySize);
    setShowLegend(cfg.global.showLegend);
    setShowSubtitle(cfg.global.showSubtitle);
    setPanelOverrides(cfg.panelOverrides ?? {});
    setEdgeOverrides(cfg.edgeOverrides ?? {});
    setAnnotations(cfg.annotations ?? []);
  }, []);

  const saveConfigToSlot = useCallback(
    (name: string) => {
      if (!name.trim()) return;
      setSavedConfigs((prev) => {
        const next = { ...prev, [name]: buildCurrentConfig() };
        persistConfigs(next);
        return next;
      });
    },
    [buildCurrentConfig],
  );

  const deleteConfigSlot = useCallback((name: string) => {
    setSavedConfigs((prev) => {
      if (!(name in prev)) return prev;
      const { [name]: _drop, ...rest } = prev;
      void _drop;
      persistConfigs(rest);
      return rest;
    });
  }, []);

  const exportConfigToFile = useCallback(() => {
    downloadJson('eeg-encoder-detail.config.json', buildCurrentConfig());
  }, [buildCurrentConfig]);

  const importConfigFromFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const cfg = JSON.parse(String(reader.result)) as SavedConfig;
          applyConfig(cfg);
        } catch {
          // ignored — caller surfaces the error via UI state
        }
      };
      reader.readAsText(file);
    },
    [applyConfig],
  );

  /* ----------------------- resolved data -------------------------------*/

  /**
   * Resolve a panel spec by merging the baseline `PanelSpec` with any
   * UI overrides. The result still satisfies `PanelSpec`, so the
   * downstream layout / render code is unchanged.
   */
  const resolvedPanels = useMemo<PanelSpec[]>(() => {
    return EEG_ENCODER_PANELS.map((p) => {
      const ov = panelOverrides[p.id];
      if (!ov) return p;
      const header = ov.header ?? p.header;
      const body =
        ov.bodyText !== undefined ? ov.bodyText.split('\n') : p.body;
      return { ...p, header, body };
    });
  }, [panelOverrides]);

  const visibleEdges = useMemo<EdgeSpec[]>(() => {
    return EEG_ENCODER_EDGES.filter(
      (e) => !edgeOverrides[e.id]?.hidden,
    ).map((e) => {
      const o = edgeOverrides[e.id];
      if (!o) return e;
      return {
        ...e,
        style: o.style ?? e.style,
        thickness: o.thickness ?? e.thickness,
        label: o.label !== undefined ? o.label : e.label,
        fromYFrac: o.fromYFrac ?? e.fromYFrac,
        toYFrac: o.toYFrac ?? e.toYFrac,
      };
    });
  }, [edgeOverrides]);

  // Figure layout. See the original PR #3 commentary for the coordinate
  // system; only the panel slot map adds per-panel size / position
  // overrides on top of the baseline grid.
  const margin = { right: 48, left: 48 };
  const colCount = 6;
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
    const out = new Map<
      string,
      { x: number; y: number; w: number; h: number; spec: PanelSpec }
    >();
    for (const p of resolvedPanels) {
      const ov = panelOverrides[p.id];
      const baseX = margin.left + p.col * colSpacing;
      let baseY: number;
      let baseH: number;
      if (p.rowSpan === 2) {
        baseY = panelTop;
        baseH = rowSpacing + panelHeight;
      } else {
        baseY = panelTop + p.row * rowSpacing;
        baseH = panelHeight;
      }
      const x = baseX + (ov?.dx ?? 0);
      const y = baseY + (ov?.dy ?? 0);
      const w = ov?.width ?? panelWidth;
      const h = ov?.height ?? baseH;
      out.set(p.id, { x, y, w, h, spec: p });
    }
    return out;
  }, [
    resolvedPanels,
    panelOverrides,
    colSpacing,
    rowSpacing,
    panelWidth,
    panelHeight,
    margin.left,
    panelTop,
  ]);

  /* ----------------------- expert schema -------------------------------*/

  const expertSchema: ExpertSchema = [
    {
      label: '布局',
      fields: [
        {
          type: 'number',
          key: 'col',
          label: '列间距',
          min: 100,
          max: 320,
          step: 2,
          value: colSpacing,
          onChange: setColSpacing,
          slider: true,
        },
        {
          type: 'number',
          key: 'row',
          label: '行间距',
          min: 140,
          max: 360,
          step: 2,
          value: rowSpacing,
          onChange: setRowSpacing,
          slider: true,
        },
        {
          type: 'number',
          key: 'pw',
          label: '面板宽度',
          min: 110,
          max: 260,
          step: 2,
          value: panelWidth,
          onChange: setPanelWidth,
          slider: true,
        },
        {
          type: 'number',
          key: 'ph',
          label: '面板高度',
          min: 90,
          max: 220,
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
          min: 8,
          max: 22,
          step: 0.5,
          value: headerSize,
          onChange: setHeaderSize,
          slider: true,
        },
        {
          type: 'number',
          key: 'bs',
          label: '正文字号',
          min: 6,
          max: 18,
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
        {
          type: 'toggle',
          key: 'sub',
          label: '副标题',
          value: showSubtitle,
          onChange: setShowSubtitle,
        },
        {
          type: 'toggle',
          key: 'leg',
          label: '底部图例',
          value: showLegend,
          onChange: setShowLegend,
        },
      ],
    },
  ];

  /* -------------------------- render -----------------------------------*/

  return (
    <ChartShell
      inspiration={
        <InspirationPanel
          presets={[
            {
              id: 'eeg-encoder-default',
              label: 'EEG Encoder (Fig.2)',
              hint: '出版级',
              description:
                '完整带 KaTeX 公式与底部图例的双流 EEG 编码器（清空所有自定义状态）。',
              apply: () => {
                setColSpacing(180);
                setRowSpacing(170);
                setPanelWidth(170);
                setPanelHeight(130);
                setHeaderSize(13);
                setBodySize(11);
                setShowLegend(true);
                setShowSubtitle(true);
                resetAllPanels();
                resetAllEdges();
                setAnnotations([]);
                setSelectedAnnotationId(null);
              },
            },
            {
              id: 'compact',
              label: '紧凑期刊版',
              hint: '论文',
              description: '更紧的排版与稍小的字号，适合期刊单栏宽度。',
              apply: () => {
                setColSpacing(150);
                setRowSpacing(150);
                setPanelWidth(140);
                setPanelHeight(108);
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
                setRowSpacing(200);
                setPanelWidth(200);
                setPanelHeight(160);
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
      filename="eeg-encoder-detail"
      getSvg={() => svgRef.current}
      expertSchema={expertSchema}
      inspector={
        <>
          <ControlGroup label="布局">
            <NumberSlider
              label="列间距"
              value={colSpacing}
              min={100}
              max={320}
              step={2}
              onChange={setColSpacing}
            />
            <NumberSlider
              label="行间距"
              value={rowSpacing}
              min={140}
              max={360}
              step={2}
              onChange={setRowSpacing}
            />
            <NumberSlider
              label="面板默认宽度"
              value={panelWidth}
              min={110}
              max={260}
              step={2}
              onChange={setPanelWidth}
            />
            <NumberSlider
              label="面板默认高度"
              value={panelHeight}
              min={90}
              max={220}
              step={2}
              onChange={setPanelHeight}
            />
          </ControlGroup>

          <ControlGroup
            label="模块编辑"
            description="选择某一个模块，单独编辑其文字 / 字号 / 行距 / 对齐 / 尺寸 / 偏移。改完即时生效，导出 SVG 同步。"
          >
            <PanelEditor
              panels={resolvedPanels}
              selectedId={selectedPanelId}
              onSelect={(id) => {
                setSelectedPanelId(id);
                setSelectedBodyLine(null);
              }}
              overrides={panelOverrides}
              defaults={{ headerSize, bodySize, lineSpacing: 1.5 }}
              onPatch={(patch) =>
                updatePanelOverride(selectedPanelId, patch)
              }
              onReset={() => resetPanel(selectedPanelId)}
              onResetAll={resetAllPanels}
              focusRequest={focusRequest}
              selectedBodyLine={selectedBodyLine}
              onPatchLine={(idx, patch) =>
                updateLineOverride(selectedPanelId, idx, patch)
              }
              onResetLine={(idx) =>
                updateLineOverride(selectedPanelId, idx, null)
              }
            />
          </ControlGroup>

          <ControlGroup
            label="连接箭头"
            description="选择某一条箭头，单独修改样式 / 颜色不可改但粗细 / 标签 / 端点位置 / 显示与隐藏。"
          >
            <EdgeEditor
              edges={EEG_ENCODER_EDGES}
              panelMap={panelMap}
              selectedId={selectedEdgeId}
              onSelect={setSelectedEdgeId}
              overrides={edgeOverrides}
              onPatch={(patch) =>
                updateEdgeOverride(selectedEdgeId, patch)
              }
              onReset={() => resetEdge(selectedEdgeId)}
              onResetAll={resetAllEdges}
            />
          </ControlGroup>

          <ControlGroup
            label="自由批注"
            description="在画布任意位置添加文本框；文本支持 $...$ KaTeX 公式。"
          >
            <AnnotationEditor
              canvasW={W}
              canvasH={H - framePadTop - framePadBottom}
              annotations={annotations}
              selectedId={selectedAnnotationId}
              onSelect={setSelectedAnnotationId}
              onAdd={addAnnotation}
              onPatch={updateAnnotation}
              onRemove={removeAnnotation}
            />
          </ControlGroup>

          <ControlGroup label="显示">
            <Toggle
              label="副标题"
              checked={showSubtitle}
              onChange={setShowSubtitle}
            />
            <Toggle
              label="底部图例"
              checked={showLegend}
              onChange={setShowLegend}
            />
          </ControlGroup>

          <ControlGroup
            label="配置管理"
            description="把当前所有调节保存为命名配置 / 导出 JSON 文件 / 下次直接载入。"
          >
            <ConfigManager
              savedConfigs={savedConfigs}
              onSaveSlot={saveConfigToSlot}
              onLoadSlot={(name) => {
                const cfg = savedConfigs[name];
                if (cfg) applyConfig(cfg);
              }}
              onDeleteSlot={deleteConfigSlot}
              onExport={exportConfigToFile}
              onImport={importConfigFromFile}
            />
          </ControlGroup>
        </>
      }
      notes={
        <p>
          EEG 编码器细节图（Fig.2 级），展示双流编码器结构：
          1D 时域分支 (DSConv1D × 4) 与 2D 频域分支 (STFT → Conv2D × 3)，
          经 channel-wise concat + adaptive pooling 后输出 EEG 节点特征
          {'$\\mathbf{H}^{E}\\in\\mathbb{R}^{N_E\\times d_E}$'}。每个面板由标题 +
          多行正文（支持 KaTeX 公式）构成；箭头按通路类别着色。Inspector
          提供逐模块 / 逐箭头 / 自由批注的细颗粒控制，并支持本地多 slot
          命名保存以及 JSON 导入 / 导出。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H}
          title="EEG Encoder  ·  Dual-Stream  (1D Temporal  +  2D Spectral)"
          caption={
            showSubtitle
              ? 'Joint extraction of millisecond-scale rhythm dynamics  and  delta / theta / alpha / beta / gamma  sub-band energy evolution'
              : undefined
          }
        >
          <defs>
            {(
              ['input', 'temporal', 'spectral', 'feat', 'output'] as Category[]
            ).map((c) => (
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
            {visibleEdges.map((e) => {
              const a = panelMap.get(e.from);
              const b = panelMap.get(e.to);
              if (!a || !b) return null;
              const ov = edgeOverrides[e.id];
              const fromAnchor: Anchor = e.fromAnchor ?? 'right';
              const toAnchor: Anchor = e.toAnchor ?? 'left';
              const yFracFrom = e.fromYFrac ?? 0.5;
              const yFracTo = e.toYFrac ?? 0.5;

              const aPt = anchorPoint(a, fromAnchor, yFracFrom);
              const bPt = anchorPoint(b, toAnchor, yFracTo);
              const fx = aPt.x + (ov?.fromDx ?? 0);
              const fy = aPt.y + (ov?.fromDy ?? 0);
              const tx = bPt.x + (ov?.toDx ?? 0);
              const ty = bPt.y + (ov?.toDy ?? 0);

              const style: EdgeStyle = e.style ?? 'solid';
              const dash =
                style === 'dashed'
                  ? '6 4'
                  : style === 'dotted'
                  ? '2 4'
                  : undefined;

              const labelText = e.label ?? '';
              const labelDx = ov?.labelDx ?? 0;
              const labelDy = ov?.labelDy ?? 0;
              const isSelected = selectedEdgeId === e.id;

              return (
                <g
                  key={e.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedEdgeId(e.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* invisible thick path for easier click hit */}
                  <path
                    data-export="false"
                    d={curvePath(fx, fy, tx, ty, fromAnchor, toAnchor)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={12}
                  />
                  <path
                    d={curvePath(fx, fy, tx, ty, fromAnchor, toAnchor)}
                    fill="none"
                    stroke={PALETTE[e.category].edge}
                    strokeWidth={e.thickness ?? 1.6}
                    strokeDasharray={dash}
                    markerEnd={`url(#arch-arrow-${e.category})`}
                  />
                  {isSelected ? (
                    <>
                      <circle
                        data-export="false"
                        cx={fx}
                        cy={fy}
                        r={4}
                        fill="#5b8def"
                      />
                      <circle
                        data-export="false"
                        cx={tx}
                        cy={ty}
                        r={4}
                        fill="#5b8def"
                      />
                    </>
                  ) : null}
                  {labelText ? (
                    <foreignObject
                      x={(fx + tx) / 2 + 6 + labelDx}
                      y={(fy + ty) / 2 - 16 + labelDy}
                      width={140}
                      height={36}
                      data-latex={labelText}
                      data-latex-font-size={10}
                      data-latex-align="left"
                    >
                      <LatexLine
                        text={labelText}
                        fontSize={10}
                        color={PALETTE[e.category].text}
                        align="left"
                      />
                    </foreignObject>
                  ) : null}
                </g>
              );
            })}
          </g>

          {/* panels */}
          <g>
            {resolvedPanels.map((p) => {
              const slot = panelMap.get(p.id);
              if (!slot) return null;
              const ov = panelOverrides[p.id];
              return (
                <Panel
                  key={p.id}
                  spec={p}
                  x={slot.x}
                  y={slot.y}
                  w={slot.w}
                  h={slot.h}
                  headerSize={ov?.headerSize ?? headerSize}
                  bodySize={ov?.bodySize ?? bodySize}
                  lineSpacing={ov?.lineSpacing ?? 1.5}
                  headerAlign={ov?.headerAlign ?? 'center'}
                  bodyAlign={ov?.bodyAlign ?? 'center'}
                  bodyAutoFit={ov?.bodyAutoFit ?? false}
                  isSelected={selectedPanelId === p.id}
                  onSelect={() => {
                    setSelectedPanelId(p.id);
                    setSelectedBodyLine(null);
                  }}
                  onSelectHeader={() => requestFocusHeader(p.id)}
                  onSelectBodyLine={(idx) => requestFocusBodyLine(p.id, idx)}
                  lineOverrides={ov?.lineOverrides}
                  highlightedLineIndex={
                    selectedBodyLine?.panelId === p.id
                      ? selectedBodyLine.lineIndex
                      : undefined
                  }
                />
              );
            })}
          </g>

          {/* annotations (on top of panels) */}
          <g>
            {annotations.map((a) => {
              const lines = a.text.split('\n');
              const lineH = a.fontSize * 1.4;
              const totalH = Math.max(1, lines.length) * lineH;
              const isSelected = selectedAnnotationId === a.id;
              return (
                <g
                  key={a.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setSelectedAnnotationId(a.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  {/* hit / selection rect (excluded from export) */}
                  <rect
                    data-export="false"
                    x={a.x}
                    y={a.y}
                    width={a.width}
                    height={totalH}
                    fill="transparent"
                    stroke={isSelected ? '#5b8def' : 'transparent'}
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {lines.map((line, i) =>
                    line ? (
                      <foreignObject
                        key={i}
                        x={a.x}
                        y={a.y + i * lineH}
                        width={a.width}
                        height={lineH}
                        data-latex={line}
                        data-latex-font-size={a.fontSize}
                        data-latex-font-weight={a.bold ? 700 : 400}
                        data-latex-font-style={a.italic ? 'italic' : 'normal'}
                        data-latex-align={a.align}
                      >
                        <LatexLine
                          text={line}
                          fontSize={a.fontSize}
                          color={a.color}
                          fontWeight={a.bold ? 700 : 400}
                          fontStyle={a.italic ? 'italic' : 'normal'}
                          align={a.align}
                        />
                      </foreignObject>
                    ) : null,
                  )}
                </g>
              );
            })}
          </g>

          {/* legend */}
          {showLegend ? (
            <g transform={`translate(${margin.left}, ${legendY})`}>
              <Legend categories={legendCategories(resolvedPanels)} />
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
    return `M${x1},${y1} L${x2},${y2}`;
  }
  if (horizontalPair) {
    const dx = (x2 - x1) * 0.45;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
  }
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
  /** Multiplier on `bodySize` for the body line height. */
  lineSpacing: number;
  headerAlign: Align;
  bodyAlign: Align;
  bodyAutoFit: boolean;
  isSelected: boolean;
  onSelect: () => void;
  /** Click on the header text — selects panel + focuses header textarea. */
  onSelectHeader?: () => void;
  /** Click on a body line — selects panel + focuses body textarea on line. */
  onSelectBodyLine?: (lineIndex: number) => void;
  /** Per-line styling overrides keyed by line index (string). */
  lineOverrides?: LineOverrideMap;
  /** Highlight the currently-selected body line in the preview. */
  highlightedLineIndex?: number;
}

function Panel({
  spec,
  x,
  y,
  w,
  h,
  headerSize,
  bodySize,
  lineSpacing,
  headerAlign,
  bodyAlign,
  bodyAutoFit,
  isSelected,
  onSelect,
  onSelectHeader,
  onSelectBodyLine,
  lineOverrides,
  highlightedLineIndex,
}: PanelProps) {
  const style = PALETTE[spec.category];
  const headerLines = spec.header.split('\n').length;
  const headerLineH = headerSize * 1.15;

  // Header layout: the title is top-aligned (first baseline at
  // `headerTopPad + headerSize`, no vertical centring), and the
  // bottom of the header strip — i.e. the y of the divider line — sits
  // a fixed `headerBottomPad` below the last text baseline. This keeps
  // the gap between title and body identical regardless of whether the
  // title is one line or two (previously a vertical-centring trick
  // collapsed the gap above the first line into a single line, while
  // leaving an extra line-height of empty space *below* the title for
  // multi-line headers — the "phantom blank line" the user reported).
  const headerTopPad = 6;
  const headerBottomPad = 6;
  const headerH =
    headerTopPad + headerLines * headerLineH + headerBottomPad;

  // Each body line gets its own <foreignObject data-latex>. The export
  // pipeline (replaceLatexForeignObjects in lib/export.ts) replaces
  // every such object with MathJax-rendered SVG glyphs, but only when
  // `data-latex` is non-empty. Wrapping multiple lines in a single
  // foreignObject would leave the body un-replaced, producing the
  // "formulas exported as plain letters" bug.
  const emptyLineHeight = bodySize * (lineSpacing * 0.4);
  const bodyTopPad = 6;

  /**
   * Resolve final per-line style by merging the line override (if any)
   * with the panel-level defaults supplied through props. Out-of-bounds
   * line indices are silently ignored.
   */
  function lineStyleAt(idx: number): {
    size: number;
    weight: number;
    italic: boolean;
    color: string;
    align: Align;
    dx: number;
  } {
    const ov = lineOverrides?.[String(idx)];
    return {
      size: ov?.size ?? bodySize,
      weight: ov?.weight ?? 400,
      italic: ov?.italic ?? false,
      color: ov?.color ?? '#1c1c1c',
      align: ov?.align ?? bodyAlign,
      dx: ov?.dx ?? 0,
    };
  }

  const bodyLayout = useMemo(() => {
    // Body lines start immediately below the header divider (top-aligned).
    // Panels with extra vertical room simply leave the bottom empty rather
    // than auto-centering the body, which previously made every short
    // body look like it had a phantom blank line above the first line.
    const offset = headerH + bodyTopPad;
    return spec.body.reduce<{ line: string; y: number; h: number }[]>(
      (acc, line, idx) => {
        const ov = lineOverrides?.[String(idx)];
        const sizeForLine = ov?.size ?? bodySize;
        const lhFull = sizeForLine * lineSpacing;
        const lh = line ? lhFull : emptyLineHeight;
        const prev = acc[acc.length - 1];
        const ny = prev ? prev.y + prev.h : offset;
        acc.push({ line, y: ny, h: lh });
        return acc;
      },
      [],
    );
  }, [
    spec.body,
    headerH,
    bodySize,
    lineSpacing,
    emptyLineHeight,
    lineOverrides,
  ]);

  return (
    <g
      transform={`translate(${x}, ${y})`}
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect();
      }}
      style={{ cursor: 'pointer' }}
    >
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
      {isSelected ? (
        <rect
          data-export="false"
          x={-3}
          y={-3}
          width={w + 6}
          height={h + 6}
          rx={12}
          ry={12}
          fill="none"
          stroke="#5b8def"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      ) : null}
      <PanelHeaderText
        text={spec.header}
        panelW={w}
        y={headerTopPad + headerSize}
        fontSize={headerSize}
        color={style.edge}
        lineHeight={headerLineH}
        align={headerAlign}
        onClick={onSelectHeader}
      />
      <line
        x1={12}
        y1={headerH}
        x2={w - 12}
        y2={headerH}
        stroke={style.edge}
        strokeOpacity={0.25}
        strokeWidth={0.8}
      />
      {bodyLayout.map((item, i) => {
        if (!item.line) return null;
        const ls = lineStyleAt(i);
        const isHighlighted = highlightedLineIndex === i;
        return (
          <g key={i}>
            {isHighlighted ? (
              <rect
                data-export="false"
                x={4}
                y={item.y - 1}
                width={w - 8}
                height={item.h + 2}
                rx={3}
                ry={3}
                fill="#5b8def"
                fillOpacity={0.08}
                stroke="#5b8def"
                strokeOpacity={0.55}
                strokeDasharray="3 2"
                strokeWidth={0.8}
              />
            ) : null}
            <foreignObject
              x={6 + ls.dx}
              y={item.y}
              width={w - 12}
              height={item.h}
              data-latex={item.line}
              data-latex-font-size={ls.size}
              data-latex-align={ls.align}
              data-latex-auto-fit={bodyAutoFit ? '1' : '0'}
              data-latex-font-weight={ls.weight}
              data-latex-font-style={ls.italic ? 'italic' : 'normal'}
              data-latex-color={ls.color}
            >
              <LatexLine
                text={item.line}
                fontSize={ls.size}
                color={ls.color}
                fontWeight={ls.weight}
                fontStyle={ls.italic ? 'italic' : 'normal'}
                align={ls.align}
                autoFit={bodyAutoFit}
                onClick={
                  onSelectBodyLine ? () => onSelectBodyLine(i) : undefined
                }
              />
            </foreignObject>
          </g>
        );
      })}
    </g>
  );
}

interface PanelHeaderTextProps {
  text: string;
  panelW: number;
  y: number;
  fontSize: number;
  color: string;
  lineHeight: number;
  align: Align;
  onClick?: () => void;
}

/**
 * Panel header rendered as a plain SVG `<text>` element with optional
 * line breaks (`\n`). Headers don't contain math so they don't need to
 * go through KaTeX/MathJax — using `<text>` here lets us multi-line
 * wrap long titles cleanly and avoids the issue where MathJax-rendered
 * single-line headers overflow their panel rectangle.
 */
function PanelHeaderText({
  text,
  panelW,
  y,
  fontSize,
  color,
  lineHeight,
  align,
  onClick,
}: PanelHeaderTextProps) {
  const lines = text.split('\n');
  // `y` is the first-line baseline. Subsequent lines stack downward by
  // `lineHeight` via the `dy` on each `<tspan>`. We deliberately do NOT
  // re-centre on lines.length here — that's the caller's job. Centering
  // on multi-line headers caused the "phantom blank line" bug because
  // headerH grew by a full line-height while the text only descended by
  // half a line-height, leaving an unaccounted gap below the title.
  const startY = y;
  const x =
    align === 'left' ? 12 : align === 'right' ? panelW - 12 : panelW / 2;
  const anchor =
    align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  return (
    <text
      x={x}
      y={startY}
      fontSize={fontSize}
      fontWeight={600}
      textAnchor={anchor}
      fill={color}
      style={{
        fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
        cursor: onClick ? 'pointer' : undefined,
      }}
      onClick={
        onClick
          ? (ev) => {
              ev.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

interface LatexLineProps {
  text: string;
  fontSize: number;
  color: string;
  fontWeight?: number;
  fontStyle?: string;
  align?: Align;
  autoFit?: boolean;
  /** Optional click handler. Cursor turns to pointer when provided. */
  onClick?: () => void;
}

/**
 * Render a mixed plain-text + KaTeX line inside an HTML container.
 * Used inside `<foreignObject>` for the live preview only — the export
 * pipeline replaces the foreignObject with MathJax SVG glyph paths.
 *
 * `autoFit`: when the rendered HTML line is wider than the available
 * container, scale the inner span proportionally so the user can see
 * the formula in full at preview time.
 */
function LatexLine({
  text,
  fontSize,
  color,
  fontWeight,
  fontStyle,
  align = 'center',
  autoFit = false,
  onClick,
}: LatexLineProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (innerRef.current) {
      innerRef.current.innerHTML = renderInlineLatex(text);
    }
    if (!autoFit || !outerRef.current || !innerRef.current) return;
    const inner = innerRef.current;
    const outer = outerRef.current;
    inner.style.transform = '';
    const innerW = inner.scrollWidth || inner.getBoundingClientRect().width;
    const outerW = outer.clientWidth;
    if (innerW > outerW && innerW > 0) {
      const s = outerW / innerW;
      const tOrigin =
        align === 'left'
          ? 'left center'
          : align === 'right'
          ? 'right center'
          : 'center center';
      inner.style.transformOrigin = tOrigin;
      inner.style.transform = `scale(${s})`;
    }
  }, [text, autoFit, fontSize, align]);

  const justify =
    align === 'left'
      ? 'flex-start'
      : align === 'right'
      ? 'flex-end'
      : 'center';
  const outerStyle: CSSProperties = {
    fontFamily: 'Inter, "Noto Sans SC", system-ui, sans-serif',
    fontSize,
    fontWeight,
    fontStyle,
    color,
    lineHeight: 1.2,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: justify,
    overflow: 'hidden',
    cursor: onClick ? 'pointer' : undefined,
  };
  return (
    <div
      ref={outerRef}
      style={outerStyle}
      onClick={
        onClick
          ? (ev) => {
              ev.stopPropagation();
              onClick();
            }
          : undefined
      }
    >
      <span ref={innerRef} style={{ display: 'inline-block' }} />
    </div>
  );
}

function legendCategories(panels: PanelSpec[]): Category[] {
  const seen = new Set<Category>();
  for (const p of panels) seen.add(p.category);
  const order: Category[] = ['input', 'temporal', 'spectral', 'feat', 'output'];
  return order.filter((c) => seen.has(c));
}

function Legend({ categories }: { categories: Category[] }) {
  const items = useMemo(() => {
    return categories.reduce<{ c: Category; x: number }[]>((acc, c) => {
      const x =
        acc.length === 0
          ? 0
          : acc[acc.length - 1].x +
            20 +
            10 +
            PALETTE[acc[acc.length - 1].c].legend.length * 6.2 +
            24;
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

/* ----------------------- line-style sub-section -----------------------*/

interface LineStyleSubsectionProps {
  panelId: string;
  lineIndex: number;
  override: LineOverride;
  panelDefaults: { size: number; align: Align };
  onPatch: (patch: Partial<LineOverride>) => void;
  onReset: () => void;
}

/**
 * Per-line styling controls. Rendered inside `PanelEditor` when the
 * user has clicked a body line in the preview. Mutations go through
 * `onPatch` / `onReset`, which write to the panel's `lineOverrides`
 * map keyed by `String(lineIndex)`.
 */
function LineStyleSubsection({
  panelId,
  lineIndex,
  override,
  panelDefaults,
  onPatch,
  onReset,
}: LineStyleSubsectionProps) {
  void panelId;
  const size = override.size ?? panelDefaults.size;
  const weight = override.weight ?? 400;
  const italic = override.italic ?? false;
  const color = override.color ?? '#1c1c1c';
  const align = override.align ?? panelDefaults.align;
  const dx = override.dx ?? 0;
  const isOverridden = Object.keys(override).length > 0;
  return (
    <div className="rounded border border-accent/40 bg-accent/5 p-2">
      <div className="mb-2 flex items-center justify-between text-[11px] text-ink-100">
        <span className="font-medium">
          选中行样式（第 {lineIndex + 1} 行）
        </span>
        <button
          type="button"
          disabled={!isOverridden}
          onClick={onReset}
          className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          恢复该行默认值
        </button>
      </div>
      <div className="space-y-2">
        <NumberSlider
          label="字号（覆盖正文字号）"
          value={size}
          min={5}
          max={28}
          step={0.5}
          onChange={(v) =>
            onPatch({
              size: v === panelDefaults.size ? undefined : v,
            })
          }
        />
        <Select
          label="对齐（覆盖正文对齐）"
          value={align}
          options={ALIGN_OPTIONS}
          onChange={(v) =>
            onPatch({ align: v === panelDefaults.align ? undefined : v })
          }
        />
        <div className="flex gap-3">
          <Toggle
            label="加粗"
            checked={weight >= 600}
            onChange={(v) =>
              onPatch({ weight: v ? 700 : undefined })
            }
          />
          <Toggle
            label="斜体"
            checked={italic}
            onChange={(v) => onPatch({ italic: v ? true : undefined })}
          />
        </div>
        <label className="flex flex-col gap-1 text-xs text-ink-200">
          <span>颜色</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color}
              onChange={(e) => onPatch({ color: e.target.value })}
              className="h-7 w-10 rounded border border-ink-600 bg-ink-800"
            />
            <input
              type="text"
              value={color}
              onChange={(e) => onPatch({ color: e.target.value })}
              spellCheck={false}
              className="h-7 flex-1 rounded border border-ink-600 bg-ink-800 px-2 font-mono text-[11px] text-ink-50 focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onPatch({ color: undefined })}
              className="rounded border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-700"
            >
              重置
            </button>
          </div>
        </label>
        <NumberSlider
          label="水平偏移 dx"
          value={dx}
          min={-200}
          max={200}
          step={1}
          onChange={(v) => onPatch({ dx: v === 0 ? undefined : v })}
        />
      </div>
    </div>
  );
}

/* --------------------------- panel editor -----------------------------*/

interface PanelEditorProps {
  panels: PanelSpec[];
  selectedId: string;
  onSelect: (id: string) => void;
  overrides: PanelOverrideMap;
  defaults: { headerSize: number; bodySize: number; lineSpacing: number };
  onPatch: (patch: Partial<PanelOverride>) => void;
  onReset: () => void;
  onResetAll: () => void;
  /**
   * Focus / scroll request emitted when the user clicks header / body
   * line text in the live preview. The editor reacts by focusing the
   * matching textarea (and selecting the relevant line for body lines).
   */
  focusRequest:
    | { kind: 'panel-header'; panelId: string; nonce: number }
    | {
        kind: 'panel-body-line';
        panelId: string;
        lineIndex: number;
        nonce: number;
      }
    | null;
  /** Currently-styled body line, or null if none. */
  selectedBodyLine: { panelId: string; lineIndex: number } | null;
  onPatchLine: (lineIndex: number, patch: Partial<LineOverride>) => void;
  onResetLine: (lineIndex: number) => void;
}

function PanelEditor({
  panels,
  selectedId,
  onSelect,
  overrides,
  defaults,
  onPatch,
  onReset,
  onResetAll,
  focusRequest,
  selectedBodyLine,
  onPatchLine,
  onResetLine,
}: PanelEditorProps) {
  const override = overrides[selectedId];
  const selected = panels.find((p) => p.id === selectedId) ?? panels[0];

  const headerValue =
    override?.header !== undefined ? override.header : selected.header;
  const bodyValue =
    override?.bodyText !== undefined
      ? override.bodyText
      : selected.body.join('\n');

  const headerRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Whenever a fresh focus-request comes in for THIS panel, focus the
  // matching textarea. Body-line requests also select that line so the
  // user starts typing on the clicked line instead of at the top.
  useEffect(() => {
    if (!focusRequest) return;
    if (focusRequest.panelId !== selectedId) return;
    if (focusRequest.kind === 'panel-header') {
      const ta = headerRef.current;
      if (!ta) return;
      ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
      return;
    }
    if (focusRequest.kind === 'panel-body-line') {
      const ta = bodyRef.current;
      if (!ta) return;
      const text = ta.value;
      let pos = 0;
      for (let i = 0; i < focusRequest.lineIndex; i++) {
        const next = text.indexOf('\n', pos);
        if (next === -1) {
          pos = text.length;
          break;
        }
        pos = next + 1;
      }
      const lineEnd = text.indexOf('\n', pos);
      const endPos = lineEnd === -1 ? text.length : lineEnd;
      ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      ta.focus();
      ta.setSelectionRange(pos, endPos);
    }
  }, [focusRequest, selectedId]);
  const headerSize = override?.headerSize ?? defaults.headerSize;
  const bodySize = override?.bodySize ?? defaults.bodySize;
  const lineSpacing = override?.lineSpacing ?? defaults.lineSpacing;
  const headerAlign = override?.headerAlign ?? 'center';
  const bodyAlign = override?.bodyAlign ?? 'center';
  const bodyAutoFit = override?.bodyAutoFit ?? false;
  const widthVal = override?.width ?? 0;
  const heightVal = override?.height ?? 0;
  const dx = override?.dx ?? 0;
  const dy = override?.dy ?? 0;

  const isOverridden = override !== undefined;
  const hasAnyOverride = Object.keys(overrides).length > 0;

  const options = panels.map((p) => {
    const baseLabel = p.header.replace(/\n/g, ' / ');
    const marker = p.id in overrides ? '  *' : '';
    return { value: p.id, label: `${baseLabel}${marker}` };
  });

  return (
    <div className="space-y-2.5">
      <Select
        label="模块"
        value={selectedId}
        options={options}
        onChange={onSelect}
      />
      <TextArea
        label="标题"
        value={headerValue}
        onChange={(v) => onPatch({ header: v })}
        rows={2}
        description="支持 \n 换行（在文本里按回车即可）。也可直接点击预览图里的标题快速编辑。"
        inputRef={headerRef}
      />
      <Select
        label="标题对齐"
        value={headerAlign}
        options={ALIGN_OPTIONS}
        onChange={(v) => onPatch({ headerAlign: v })}
      />
      <TextArea
        label="正文"
        value={bodyValue}
        onChange={(v) => onPatch({ bodyText: v })}
        rows={6}
        monospace
        description="每行一条；留空行表示视觉间隔。$...$ 内为 KaTeX 公式。点击预览图任意一行可直接定位到该行。"
        inputRef={bodyRef}
      />
      {selectedBodyLine && selectedBodyLine.panelId === selectedId ? (
        <LineStyleSubsection
          panelId={selectedId}
          lineIndex={selectedBodyLine.lineIndex}
          override={
            override?.lineOverrides?.[String(selectedBodyLine.lineIndex)] ?? {}
          }
          panelDefaults={{
            size: bodySize,
            align: bodyAlign,
          }}
          onPatch={(patch) => onPatchLine(selectedBodyLine.lineIndex, patch)}
          onReset={() => onResetLine(selectedBodyLine.lineIndex)}
        />
      ) : null}
      <Select
        label="正文对齐"
        value={bodyAlign}
        options={ALIGN_OPTIONS}
        onChange={(v) => onPatch({ bodyAlign: v })}
      />
      <Toggle
        label="正文按宽度自动缩放"
        checked={bodyAutoFit}
        onChange={(v) => onPatch({ bodyAutoFit: v })}
      />
      <NumberSlider
        label="标题字号"
        value={headerSize}
        min={6}
        max={28}
        step={0.5}
        onChange={(v) => onPatch({ headerSize: v })}
      />
      <NumberSlider
        label="正文字号"
        value={bodySize}
        min={5}
        max={22}
        step={0.5}
        onChange={(v) => onPatch({ bodySize: v })}
      />
      <NumberSlider
        label="正文行距"
        value={lineSpacing}
        min={0.8}
        max={5}
        step={0.05}
        onChange={(v) => onPatch({ lineSpacing: v })}
        format={(v) => v.toFixed(2)}
      />
      <NumberSlider
        label="模块宽度（0 = 用全局默认）"
        value={widthVal}
        min={0}
        max={400}
        step={2}
        onChange={(v) => onPatch({ width: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="模块高度（0 = 用全局默认）"
        value={heightVal}
        min={0}
        max={500}
        step={2}
        onChange={(v) => onPatch({ height: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="水平偏移 dx"
        value={dx}
        min={-200}
        max={200}
        step={1}
        onChange={(v) => onPatch({ dx: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="垂直偏移 dy"
        value={dy}
        min={-200}
        max={200}
        step={1}
        onChange={(v) => onPatch({ dy: v === 0 ? undefined : v })}
      />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={!isOverridden}
          onClick={onReset}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          恢复此模块默认值
        </button>
        <button
          type="button"
          disabled={!hasAnyOverride}
          onClick={onResetAll}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          全部模块复位
        </button>
      </div>
    </div>
  );
}

/* --------------------------- edge editor ------------------------------*/

interface EdgeEditorProps {
  edges: EdgeSpec[];
  panelMap: Map<string, { x: number; y: number; w: number; h: number; spec: PanelSpec }>;
  selectedId: string;
  onSelect: (id: string) => void;
  overrides: EdgeOverrideMap;
  onPatch: (patch: Partial<EdgeOverride>) => void;
  onReset: () => void;
  onResetAll: () => void;
}

function EdgeEditor({
  edges,
  panelMap,
  selectedId,
  onSelect,
  overrides,
  onPatch,
  onReset,
  onResetAll,
}: EdgeEditorProps) {
  const override = overrides[selectedId];
  const selected = edges.find((e) => e.id === selectedId) ?? edges[0];
  const fromName =
    panelMap.get(selected.from)?.spec.header.replace(/\n/g, ' / ') ?? selected.from;
  const toName =
    panelMap.get(selected.to)?.spec.header.replace(/\n/g, ' / ') ?? selected.to;

  const isHidden = override?.hidden ?? false;
  const styleVal = override?.style ?? selected.style ?? 'solid';
  const thicknessVal = override?.thickness ?? selected.thickness ?? 1.6;
  const labelVal =
    override?.label !== undefined ? override.label : selected.label ?? '';
  const fromYFrac = override?.fromYFrac ?? selected.fromYFrac ?? 0.5;
  const toYFrac = override?.toYFrac ?? selected.toYFrac ?? 0.5;
  const fromDx = override?.fromDx ?? 0;
  const fromDy = override?.fromDy ?? 0;
  const toDx = override?.toDx ?? 0;
  const toDy = override?.toDy ?? 0;
  const labelDx = override?.labelDx ?? 0;
  const labelDy = override?.labelDy ?? 0;

  const isOverridden = override !== undefined;
  const hasAnyOverride = Object.keys(overrides).length > 0;

  const options = edges.map((e) => {
    const a =
      panelMap.get(e.from)?.spec.header.replace(/\n/g, ' / ') ?? e.from;
    const b =
      panelMap.get(e.to)?.spec.header.replace(/\n/g, ' / ') ?? e.to;
    const marker = e.id in overrides ? '  *' : '';
    return { value: e.id, label: `${a} → ${b}${marker}` };
  });

  return (
    <div className="space-y-2.5">
      <Select
        label="箭头"
        value={selectedId}
        options={options}
        onChange={onSelect}
      />
      <p className="text-[11px] text-ink-300">
        {fromName} → {toName}
      </p>
      <Toggle
        label="隐藏此箭头"
        checked={isHidden}
        onChange={(v) => onPatch({ hidden: v ? true : undefined })}
      />
      <Select
        label="线型"
        value={styleVal}
        options={EDGE_STYLE_OPTIONS}
        onChange={(v) => onPatch({ style: v })}
      />
      <NumberSlider
        label="线粗"
        value={thicknessVal}
        min={0.5}
        max={6}
        step={0.1}
        onChange={(v) => onPatch({ thickness: v })}
        format={(v) => v.toFixed(1)}
      />
      <TextArea
        label="标签（留空隐藏）"
        value={labelVal}
        onChange={(v) => onPatch({ label: v })}
        rows={1}
        description="支持 $...$ KaTeX 公式。清空内容即清除标签。"
      />
      <NumberSlider
        label="起点 Y 位置（0=顶 1=底）"
        value={fromYFrac}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onPatch({ fromYFrac: v })}
        format={(v) => v.toFixed(2)}
      />
      <NumberSlider
        label="终点 Y 位置（0=顶 1=底）"
        value={toYFrac}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onPatch({ toYFrac: v })}
        format={(v) => v.toFixed(2)}
      />
      <NumberSlider
        label="起点偏移 dx"
        value={fromDx}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ fromDx: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="起点偏移 dy"
        value={fromDy}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ fromDy: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="终点偏移 dx"
        value={toDx}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ toDx: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="终点偏移 dy"
        value={toDy}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ toDy: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="标签偏移 dx"
        value={labelDx}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ labelDx: v === 0 ? undefined : v })}
      />
      <NumberSlider
        label="标签偏移 dy"
        value={labelDy}
        min={-100}
        max={100}
        step={1}
        onChange={(v) => onPatch({ labelDy: v === 0 ? undefined : v })}
      />
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={!isOverridden}
          onClick={onReset}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          恢复此箭头默认值
        </button>
        <button
          type="button"
          disabled={!hasAnyOverride}
          onClick={onResetAll}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          全部箭头复位
        </button>
      </div>
    </div>
  );
}

/* ------------------------ annotation editor --------------------------*/

interface AnnotationEditorProps {
  canvasW: number;
  canvasH: number;
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAdd: () => void;
  onPatch: (id: string, patch: Partial<Annotation>) => void;
  onRemove: (id: string) => void;
}

function AnnotationEditor({
  canvasW,
  canvasH,
  annotations,
  selectedId,
  onSelect,
  onAdd,
  onPatch,
  onRemove,
}: AnnotationEditorProps) {
  const selected =
    annotations.find((a) => a.id === selectedId) ?? null;

  const options = [
    { value: '', label: '— 未选中 —' },
    ...annotations.map((a, i) => ({
      value: a.id,
      label: `#${i + 1}  ${a.text.split('\n')[0].slice(0, 24) || '(空)'}`,
    })),
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-ink-50 hover:bg-accent/30"
        >
          + 添加批注
        </button>
        {selected ? (
          <button
            type="button"
            onClick={() => onRemove(selected.id)}
            className="rounded border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[11px] text-ink-50 hover:bg-rose-500/25"
          >
            删除选中
          </button>
        ) : null}
      </div>
      {annotations.length === 0 ? (
        <p className="text-[11px] text-ink-300">
          点上方按钮新增；新增后即可在画布里点选编辑。
        </p>
      ) : (
        <Select
          label="选中批注"
          value={selectedId ?? ''}
          options={options}
          onChange={(v) => onSelect(v === '' ? null : v)}
        />
      )}
      {selected ? (
        <>
          <TextArea
            label="文本（支持 $...$ KaTeX 与多行）"
            value={selected.text}
            onChange={(v) => onPatch(selected.id, { text: v })}
            rows={3}
          />
          <Select
            label="对齐"
            value={selected.align}
            options={ALIGN_OPTIONS}
            onChange={(v) => onPatch(selected.id, { align: v })}
          />
          <NumberSlider
            label="字号"
            value={selected.fontSize}
            min={6}
            max={32}
            step={0.5}
            onChange={(v) => onPatch(selected.id, { fontSize: v })}
          />
          <NumberSlider
            label="文本框宽度"
            value={selected.width}
            min={40}
            max={Math.max(120, canvasW)}
            step={2}
            onChange={(v) => onPatch(selected.id, { width: v })}
          />
          <NumberSlider
            label="X 位置"
            value={selected.x}
            min={0}
            max={Math.max(120, canvasW)}
            step={1}
            onChange={(v) => onPatch(selected.id, { x: v })}
          />
          <NumberSlider
            label="Y 位置"
            value={selected.y}
            min={0}
            max={Math.max(120, canvasH)}
            step={1}
            onChange={(v) => onPatch(selected.id, { y: v })}
          />
          <label className="flex flex-col gap-1 text-xs text-ink-200">
            <span>颜色</span>
            <input
              type="color"
              value={selected.color}
              onChange={(e) =>
                onPatch(selected.id, { color: e.target.value })
              }
              className="h-7 w-full rounded border border-ink-600 bg-ink-800"
            />
          </label>
          <div className="flex gap-3">
            <Toggle
              label="加粗"
              checked={selected.bold ?? false}
              onChange={(v) => onPatch(selected.id, { bold: v })}
            />
            <Toggle
              label="斜体"
              checked={selected.italic ?? false}
              onChange={(v) => onPatch(selected.id, { italic: v })}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------ config manager -----------------------------*/

interface ConfigManagerProps {
  savedConfigs: SavedConfigsMap;
  onSaveSlot: (name: string) => void;
  onLoadSlot: (name: string) => void;
  onDeleteSlot: (name: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

function ConfigManager({
  savedConfigs,
  onSaveSlot,
  onLoadSlot,
  onDeleteSlot,
  onExport,
  onImport,
}: ConfigManagerProps) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string>('');
  const fileRef = useRef<HTMLInputElement>(null);

  const slotNames = Object.keys(savedConfigs).sort();
  const slotOptions = [
    { value: '', label: '— 选择已保存配置 —' },
    ...slotNames.map((n) => ({ value: n, label: n })),
  ];

  return (
    <div className="space-y-2.5">
      <label className="flex flex-col gap-1 text-xs text-ink-200">
        <span>配置名</span>
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：fig2-v3"
            className="flex-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-ink-50 focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            disabled={!name.trim()}
            onClick={() => {
              onSaveSlot(name.trim());
              setName('');
            }}
            className="rounded border border-accent bg-accent/20 px-2 py-1 text-[11px] text-ink-50 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            保存当前
          </button>
        </div>
      </label>
      <Select
        label="本地配置 slot"
        value={selected}
        options={slotOptions}
        onChange={setSelected}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!selected}
          onClick={() => onLoadSlot(selected)}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          载入
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => {
            onDeleteSlot(selected);
            setSelected('');
          }}
          className="rounded border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[11px] text-ink-50 hover:bg-rose-500/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          删除
        </button>
      </div>
      <p className="text-[11px] text-ink-300">
        本地保存仅在当前浏览器有效；想跨设备复用请用 JSON 文件：
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onExport}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
        >
          导出 JSON 文件
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700"
        >
          导入 JSON 文件
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

registerChart({
  id: 'eeg-encoder-detail',
  title: 'EEG 编码器细节图',
  titleEn: 'EEG Encoder Detail',
  category: 'architecture',
  summary:
    '双流 EEG 编码器细节图（Fig.2 级）：1D 时域分支 + 2D 频域分支 + Concat/AvgPool + 输出，支持 KaTeX 公式与逐模块 / 逐箭头 / 自由批注 / 配置保存。',
  component: EegEncoderDetailChart,
});
