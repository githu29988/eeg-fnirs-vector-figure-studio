import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
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
import {
  usePanelDrag,
  type PanelDragSlot,
  type PanelBasePosition,
} from '../../lib/usePanelDrag';
import { useSvgPointDrag } from '../../lib/useSvgPointDrag';
import { registerChart } from '../../registry';

/** Identifies which arrow handle the user is currently dragging. */
type EdgeDragTag =
  | { kind: 'endpoint'; edgeId: string; which: 'from' | 'to' }
  | { kind: 'waypoint'; edgeId: string; index: number };

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

/**
 * Optional v2 visual decoration drawn at the bottom of a panel.
 *
 * Each kind reserves a fixed-height band inside the panel and draws a
 * paper-grade SVG illustration that complements the textual body (e.g.
 * an adjacency-matrix thumbnail next to the input panels, a 3D
 * "lollipop" graph next to the per-modality GATs). The renderers are
 * pure SVG with deterministic seeded values, so exports stay vector
 * and reproducible.
 */
type VizKind =
  | 'adj-eeg'
  | 'adj-fnirs'
  | 'adj-het'
  | 'lollipop-eeg'
  | 'lollipop-fnirs'
  | 'hrf-kernel'
  | 'gate-bars'
  | 'event-output';

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
  /**
   * Optional decorative SVG drawn at the bottom of the panel. Reserves
   * a fixed-height band; body lines should be trimmed to leave room.
   */
  viz?: VizKind;
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
 * baseline `GAT_CMC_PANELS` entry and the global header / body
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
  /** Optional intermediate waypoints in absolute SVG coordinates.
   *  When present, the arrow is rendered as a polyline that visits
   *  each waypoint in order between the source anchor and the
   *  destination anchor. Add by Shift+clicking the path; drag the
   *  small white-filled handles to reposition; Shift+click a
   *  handle to remove it. */
  waypoints?: { x: number; y: number }[];
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
    legend: 'Input  /  Decoder',
  },
  temporal: {
    fill: '#E1ECF8',
    edge: '#2E5C8A',
    text: '#2E5C8A',
    legend: 'Per-modality  GAT',
  },
  spectral: {
    fill: '#FCE9E5',
    edge: '#A33A22',
    text: '#A33A22',
    legend: 'HRF  soft-shift',
  },
  feat: {
    fill: '#FFF4D6',
    edge: '#8A6A0A',
    text: '#8A6A0A',
    legend: 'Heterogeneous  /  Fusion',
  },
  output: {
    fill: '#E1F2E2',
    edge: '#1F6F2A',
    text: '#1F6F2A',
    legend: 'Output  /  Event  decoder',
  },
};

/* ----------------- GAT-CMC-Net overall architecture (paper Fig. 1) -----*/

/* GAT-CMC-Net overall architecture for EEG-fNIRS seizure detection.
 *
 * The figure is laid out as a left-to-right pipeline split across three
 * conceptual stages (rendered as labelled brackets at the bottom):
 *   1. Per-modality graph feature extraction
 *   2. HRF-aware heterogeneous fusion
 *   3. Event-level seizure decoding
 *
 * Top row  = EEG branch, bottom row = fNIRS branch (HbO+HbR).
 * Right-side panels span both rows. */
const GAT_CMC_PANELS: PanelSpec[] = [
  // Col 0 — Inputs (per modality)
  {
    id: 'in-eeg',
    col: 0,
    row: 0,
    category: 'input',
    header: 'EEG  Input',
    body: [
      '$\\mathbf{X}^{E}\\!\\in\\!\\mathbb{R}^{N_E\\times T_E}$',
      '$N_E\\!=\\!18$,  $f_E\\!=\\!256$  Hz',
      'window  $W = 30$  s',
    ],
    viz: 'adj-eeg',
  },
  {
    id: 'in-fnirs',
    col: 0,
    row: 1,
    category: 'input',
    header: 'fNIRS  Input  ·  HbO + HbR',
    body: [
      '$\\mathbf{X}^{F}\\!\\in\\!\\mathbb{R}^{N_F\\times T_F\\times 2}$',
      '$N_F\\!=\\!24$,  $f_F\\!=\\!10$  Hz',
      'concurrent  EEG+fNIRS  cap',
    ],
    viz: 'adj-fnirs',
  },
  // Col 1 — Per-modality multi-head GAT
  {
    id: 'gat-eeg',
    col: 1,
    row: 0,
    category: 'temporal',
    header: 'GAT  ·  EEG  branch',
    body: [
      'k-NN  on  band-power',
      'multi-head,  $K\\!=\\!4$',
      '$d\\!=\\!64$,  dropout 0.1',
    ],
    viz: 'lollipop-eeg',
  },
  {
    id: 'gat-fnirs',
    col: 1,
    row: 1,
    category: 'temporal',
    header: 'GAT  ·  fNIRS  branch',
    body: [
      'k-NN  on  hemo  signature',
      'multi-head,  $K\\!=\\!4$',
      'HbO+HbR  channel-wise',
    ],
    viz: 'lollipop-fnirs',
  },
  // Col 2 — HRF time-shift compensation block (key novelty).
  // EEG path is "identity" (electric is the reference); fNIRS path
  // applies a learnable per-channel soft delay so hemodynamics align
  // with the electrical onset before joint graph fusion.
  {
    id: 'eeg-passthrough',
    col: 2,
    row: 0,
    category: 'feat',
    header: 'Identity  (EEG)',
    body: [
      '$\\tilde{\\mathbf{h}}^{E} = \\mathbf{h}^{E}$',
      'electric  is  reference',
      '(no  HRF  delay)',
    ],
  },
  {
    id: 'hrf',
    col: 2,
    row: 1,
    category: 'spectral',
    header: 'HRF  Soft-Shift',
    body: [
      'learnable  $\\tau_c\\!\\in\\![0, \\tau_{\\max}]$',
      '$\\tilde{\\mathbf{h}}^{F}_c\\!=\\!\\mathbf{h}^{F}_c\\!\\star\\!\\delta_{\\sigma}(t\\!-\\!\\tau_c)$',
      'aligns  hemo  to  onset',
    ],
    viz: 'hrf-kernel',
  },
  // Col 3 — Heterogeneous multi-head GAT (spans both rows)
  {
    id: 'het-gat',
    col: 3,
    row: 0,
    rowSpan: 2,
    category: 'feat',
    header: 'Heterogeneous\nMulti-Head  GAT',
    body: [
      'nodes  =  EEG  ∪  fNIRS  channels',
      'edge  types  $r\\!\\in\\!\\{EE, EF, FE, FF\\}$',
      '',
      '$e^{(r)}_{ij}\\!=\\!\\mathrm{LReLU}(\\mathbf{a}_r^{\\!\\top}[\\mathbf{W}_r\\mathbf{h}_i\\,\\Vert\\,\\mathbf{W}_{r\'}\\mathbf{h}_j])$',
      '$\\alpha^{(r)}_{ij}\\!=\\!\\mathrm{softmax}_j(e^{(r)}_{ij})$',
      '',
      'multi-head  $K = 8$,  $d_h = 64$',
      'attention  →  interpretable',
    ],
    viz: 'adj-het',
  },
  // Col 4 — Gated cross-modal fusion (spans both rows)
  {
    id: 'gated-fusion',
    col: 4,
    row: 0,
    rowSpan: 2,
    category: 'feat',
    header: 'Gated\nCross-Modal  Fusion',
    body: [
      'modality  gates  $g_E,\\,g_F\\!\\in\\![0,1]^{d}$',
      '$g_m\\!=\\!\\sigma(\\mathbf{W}_g[\\mathbf{H}^E\\Vert\\mathbf{H}^F]\\!+\\!\\mathbf{b}_g)$',
      '',
      '$\\mathbf{H}\\!=\\!g_E\\!\\odot\\!\\mathbf{H}^E\\!+\\!g_F\\!\\odot\\!\\mathbf{H}^F$',
      '',
      'sample-adaptive  weighting',
      'sparse  $L_1$  prior  on  $g$',
    ],
    viz: 'gate-bars',
  },
  // Col 5 — Classifier + Event Decoder + Output (spans both rows)
  {
    id: 'classifier',
    col: 5,
    row: 0,
    rowSpan: 2,
    category: 'output',
    header: 'Classifier  +  Event  Decoder',
    body: [
      'BiGRU  +  2D-CNN  readout',
      'window  logits  $p_t\\!\\in\\![0,1]$',
      '',
      'merge  $p_t\\!>\\!0.5$  windows',
      'min  10 s,  refractory  30 s',
      '',
      '$\\mathrm{Out}\\!\\in\\!\\{\\,\\mathrm{Ictal},\\,\\mathrm{Non\\text{-}ictal}\\,\\}$',
      'event-level  SE ↑ , FA/h ↓',
      'LOSO  patient-independent',
    ],
    viz: 'event-output',
  },
];

const GAT_CMC_EDGES: EdgeSpec[] = [
  // Inputs to per-modality GAT
  {
    id: 'in-eeg-gat',
    from: 'in-eeg',
    to: 'gat-eeg',
    category: 'temporal',
  },
  {
    id: 'in-fnirs-gat',
    from: 'in-fnirs',
    to: 'gat-fnirs',
    category: 'temporal',
  },
  // Per-modality GAT outputs to identity / HRF
  {
    id: 'gat-eeg-identity',
    from: 'gat-eeg',
    to: 'eeg-passthrough',
    category: 'feat',
  },
  {
    id: 'gat-fnirs-hrf',
    from: 'gat-fnirs',
    to: 'hrf',
    category: 'spectral',
    thickness: 2,
    label: 'learnable\u00A0HRF\u00A0τ',
  },
  // Identity / HRF feed into the heterogeneous GAT (joint over modalities)
  {
    id: 'identity-het',
    from: 'eeg-passthrough',
    to: 'het-gat',
    category: 'feat',
    toYFrac: 0.30,
  },
  {
    id: 'hrf-het',
    from: 'hrf',
    to: 'het-gat',
    category: 'feat',
    toYFrac: 0.70,
  },
  // Heterogeneous GAT to gated fusion
  {
    id: 'het-fusion',
    from: 'het-gat',
    to: 'gated-fusion',
    category: 'feat',
    thickness: 2,
  },
  // Gated fusion to classifier + event decoder
  {
    id: 'fusion-classifier',
    from: 'gated-fusion',
    to: 'classifier',
    category: 'input',
    thickness: 2,
  },
];

/* -------------------------- localStorage -------------------------------*/

const STORAGE_KEY = 'gat-cmc-overall-saved-configs-v1';
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

function GatCmcDetailChart() {
  const [colSpacing, setColSpacing] = useState(200);
  const [rowSpacing, setRowSpacing] = useState(220);
  const [panelWidth, setPanelWidth] = useState(180);
  const [panelHeight, setPanelHeight] = useState(180);
  const [headerSize, setHeaderSize] = useState(13);
  const [bodySize, setBodySize] = useState(10.5);
  const [showLegend, setShowLegend] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(true);

  const [panelOverrides, setPanelOverrides] = useState<PanelOverrideMap>({});
  const [edgeOverrides, setEdgeOverrides] = useState<EdgeOverrideMap>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const [selectedPanelId, setSelectedPanelId] = useState<string>(
    GAT_CMC_PANELS[0].id,
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
    GAT_CMC_EDGES[0].id,
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
    downloadJson('gat-cmc-overall.config.json', buildCurrentConfig());
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
    return GAT_CMC_PANELS.map((p) => {
      const ov = panelOverrides[p.id];
      if (!ov) return p;
      const header = ov.header ?? p.header;
      const body =
        ov.bodyText !== undefined ? ov.bodyText.split('\n') : p.body;
      return { ...p, header, body };
    });
  }, [panelOverrides]);

  const visibleEdges = useMemo<EdgeSpec[]>(() => {
    return GAT_CMC_EDGES.filter(
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

  // Drag-and-snap support for direct panel manipulation in the
  // preview SVG. Slots feed the alignment-guide search; basePositions
  // tell the hook what the panel's grid origin is so a new dx/dy
  // override can be computed as `newX - baseX`.
  const dragData = useMemo(() => {
    const slots: PanelDragSlot[] = [];
    const basePositions = new Map<string, PanelBasePosition>();
    for (const [id, slot] of panelMap.entries()) {
      const ov = panelOverrides[id];
      slots.push({ id, x: slot.x, y: slot.y, w: slot.w, h: slot.h });
      basePositions.set(id, {
        x: slot.x - (ov?.dx ?? 0),
        y: slot.y - (ov?.dy ?? 0),
      });
    }
    return { slots, basePositions };
  }, [panelMap, panelOverrides]);

  const drag = usePanelDrag({
    svgRef,
    slots: dragData.slots,
    basePositions: dragData.basePositions,
    canvasW: W,
    canvasH: H,
    onDrag: useCallback(
      (panelId: string, dx: number, dy: number) => {
        // Round to integers to keep saved configs tidy. dx/dy === 0 is
        // pruned by `pruneOverride` so panels dragged back to their
        // baseline reset cleanly.
        updatePanelOverride(panelId, {
          dx: Math.round(dx) || undefined,
          dy: Math.round(dy) || undefined,
        });
      },
      [updatePanelOverride],
    ),
  });

  /* ------------------ edge endpoint / waypoint drag --------------------*/

  // Snap targets for arrow handles: every panel's perimeter sampled
  // at the four cardinal mid-points and the four corners. This gives
  // 8 magnet points per panel, which is enough for typical "attach
  // arrow to module corner / center of edge" routing without
  // overwhelming the snap search with hundreds of candidates.
  const edgeSnapPoints = useMemo<{ x: number; y: number }[]>(() => {
    const out: { x: number; y: number }[] = [];
    for (const slot of panelMap.values()) {
      out.push(
        { x: slot.x, y: slot.y },
        { x: slot.x + slot.w, y: slot.y },
        { x: slot.x, y: slot.y + slot.h },
        { x: slot.x + slot.w, y: slot.y + slot.h },
        { x: slot.x + slot.w / 2, y: slot.y },
        { x: slot.x + slot.w / 2, y: slot.y + slot.h },
        { x: slot.x, y: slot.y + slot.h / 2 },
        { x: slot.x + slot.w, y: slot.y + slot.h / 2 },
      );
    }
    return out;
  }, [panelMap]);

  const edgeDrag = useSvgPointDrag<EdgeDragTag>({
    svgRef,
    getSnapTargets: useCallback(() => ({ points: edgeSnapPoints }), [
      edgeSnapPoints,
    ]),
    onMove: useCallback(
      (tag: EdgeDragTag, x: number, y: number) => {
        if (tag.kind === 'endpoint') {
          const edge = GAT_CMC_EDGES.find((e) => e.id === tag.edgeId);
          if (!edge) return;
          const slot = panelMap.get(tag.which === 'from' ? edge.from : edge.to);
          if (!slot) return;
          const anchor =
            tag.which === 'from' ? edge.fromAnchor ?? 'right' : edge.toAnchor ?? 'left';
          const yFrac =
            tag.which === 'from' ? edge.fromYFrac ?? 0.5 : edge.toYFrac ?? 0.5;
          const base = anchorPoint(slot, anchor, yFrac);
          const dx = Math.round((x - base.x) * 10) / 10;
          const dy = Math.round((y - base.y) * 10) / 10;
          updateEdgeOverride(tag.edgeId, {
            ...(tag.which === 'from'
              ? { fromDx: dx || undefined, fromDy: dy || undefined }
              : { toDx: dx || undefined, toDy: dy || undefined }),
          });
        } else {
          setEdgeOverrides((prev) => {
            const cur = prev[tag.edgeId] ?? {};
            const wps = cur.waypoints ? [...cur.waypoints] : [];
            wps[tag.index] = {
              x: Math.round(x * 10) / 10,
              y: Math.round(y * 10) / 10,
            };
            const next: EdgeOverride = { ...cur, waypoints: wps };
            return { ...prev, [tag.edgeId]: next };
          });
        }
      },
      [panelMap, updateEdgeOverride],
    ),
  });

  const insertWaypoint = useCallback(
    (edgeId: string, x: number, y: number, segmentIndex?: number) => {
      setEdgeOverrides((prev) => {
        const cur = prev[edgeId] ?? {};
        const wps = cur.waypoints ? [...cur.waypoints] : [];
        const insertAt =
          typeof segmentIndex === 'number'
            ? Math.max(0, Math.min(wps.length, segmentIndex))
            : wps.length;
        wps.splice(insertAt, 0, {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
        });
        const next: EdgeOverride = { ...cur, waypoints: wps };
        return { ...prev, [edgeId]: next };
      });
    },
    [],
  );

  const removeWaypoint = useCallback((edgeId: string, index: number) => {
    setEdgeOverrides((prev) => {
      const cur = prev[edgeId];
      if (!cur || !cur.waypoints) return prev;
      const wps = cur.waypoints.filter((_, i) => i !== index);
      const next: EdgeOverride =
        wps.length === 0
          ? (() => {
              const { waypoints: _wp, ...rest } = cur;
              void _wp;
              return rest;
            })()
          : { ...cur, waypoints: wps };
      if (Object.keys(next).length === 0) {
        const { [edgeId]: _drop, ...rest } = prev;
        void _drop;
        return rest;
      }
      return { ...prev, [edgeId]: next };
    });
  }, []);

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
              id: 'gat-cmc-default',
              label: 'GAT-CMC-Net (Fig. 1, v2)',
              hint: '出版级',
              description:
                'GAT-CMC-Net 整体架构（EEG-fNIRS 异质图 + 可学习 HRF 软位移 + 多头 GAT + 门控跨模态融合 + 事件级解码）。v2：每个模块下方挂出可视化（邻接矩阵 / 棒棒糖节点图 / HRF 软核 / 门控向量 / 事件级输出）。',
              apply: () => {
                setColSpacing(200);
                setRowSpacing(220);
                setPanelWidth(180);
                setPanelHeight(180);
                setHeaderSize(13);
                setBodySize(10.5);
                setShowLegend(true);
                setShowSubtitle(true);
                resetAllPanels();
                resetAllEdges();
                setAnnotations([]);
                setSelectedAnnotationId(null);
              },
            },
            {
              id: 'chinese-annotated',
              label: '中文标注版',
              hint: '中文',
              description:
                '把面板文字切成简体中文（仅用于研讨/讲解；导出 SVG/PNG 给期刊前一键切回 GAT-CMC-Net (Fig. 1, v2) 即可恢复英文）。可视化装饰保留。',
              apply: () => {
                setColSpacing(200);
                setRowSpacing(220);
                setPanelWidth(190);
                setPanelHeight(190);
                setHeaderSize(13);
                setBodySize(10.5);
                setShowLegend(true);
                setShowSubtitle(true);
                resetAllEdges();
                setAnnotations([
                  {
                    id: 'zh-section-1',
                    text: '① 图特征提取',
                    x: 80,
                    y: 720,
                    width: 360,
                    fontSize: 13,
                    color: '#3050a0',
                    align: 'center',
                    italic: false,
                  },
                  {
                    id: 'zh-section-2',
                    text: '② HRF 感知异质图融合',
                    x: 470,
                    y: 720,
                    width: 360,
                    fontSize: 13,
                    color: '#3050a0',
                    align: 'center',
                    italic: false,
                  },
                  {
                    id: 'zh-section-3',
                    text: '③ 事件级癫痫解码',
                    x: 860,
                    y: 720,
                    width: 220,
                    fontSize: 13,
                    color: '#3050a0',
                    align: 'center',
                    italic: false,
                  },
                  {
                    id: 'zh-footnote',
                    text:
                      'HRF 软位移：神经-血流耦合的时移在不同患者 / 通道间存在 1–6 s 的非平稳异质性 [11]，本文将位移参数 τc 作为可微变量与 GAT 端到端联合训练；这是相对 GraphSAGE+EEG-fNIRS 情感识别 [10] 等竞争者最锐利的差异。',
                    x: 60,
                    y: 760,
                    width: 1020,
                    fontSize: 10.5,
                    color: '#444',
                    align: 'left',
                    italic: false,
                  },
                ]);
                setPanelOverrides({
                  'in-eeg': {
                    header: 'EEG  输入',
                    bodyText: [
                      '$\\mathbf{X}^{E}\\!\\in\\!\\mathbb{R}^{N_E\\times T_E}$',
                      '$N_E\\!=\\!18$,  $f_E\\!=\\!256$  Hz',
                      '窗口  $W = 30$  s',
                    ].join('\n'),
                  },
                  'in-fnirs': {
                    header: 'fNIRS  输入  ·  HbO + HbR',
                    bodyText: [
                      '$\\mathbf{X}^{F}\\!\\in\\!\\mathbb{R}^{N_F\\times T_F\\times 2}$',
                      '$N_F\\!=\\!24$,  $f_F\\!=\\!10$  Hz',
                      '同步  EEG+fNIRS  采集',
                    ].join('\n'),
                  },
                  'gat-eeg': {
                    header: 'GAT  ·  EEG  分支',
                    bodyText: [
                      '基于  band-power  的  k-NN',
                      '多头  $K\\!=\\!4$',
                      '$d\\!=\\!64$,  dropout 0.1',
                    ].join('\n'),
                  },
                  'gat-fnirs': {
                    header: 'GAT  ·  fNIRS  分支',
                    bodyText: [
                      '基于血氧动力学的  k-NN',
                      '多头  $K\\!=\\!4$',
                      'HbO + HbR  逐通道',
                    ].join('\n'),
                  },
                  'eeg-passthrough': {
                    header: '恒等映射  (EEG)',
                    bodyText: [
                      '$\\tilde{\\mathbf{h}}^{E} = \\mathbf{h}^{E}$',
                      '电信号作为时间基准',
                      '（不施加  HRF  位移）',
                    ].join('\n'),
                  },
                  hrf: {
                    header: 'HRF  软位移',
                    bodyText: [
                      '逐通道可学习  $\\tau_c\\!\\in\\![0,\\tau_{\\max}]$',
                      '$\\tilde{\\mathbf{h}}^{F}_c\\!=\\!\\mathbf{h}^{F}_c\\!\\star\\!\\delta_{\\sigma}(t\\!-\\!\\tau_c)$',
                      '将血流响应对齐到电信号起点',
                    ].join('\n'),
                  },
                  'het-gat': {
                    header: '异质多头  GAT',
                    bodyText: [
                      '节点  =  EEG  ∪  fNIRS  通道',
                      '边类型  $r\\!\\in\\!\\{EE, EF, FE, FF\\}$',
                      '',
                      '$e^{(r)}_{ij}\\!=\\!\\mathrm{LReLU}(\\mathbf{a}_r^{\\!\\top}[\\mathbf{W}_r\\mathbf{h}_i\\Vert\\mathbf{W}_{r\'}\\mathbf{h}_j])$',
                      '$\\alpha^{(r)}_{ij}\\!=\\!\\mathrm{softmax}_j(e^{(r)}_{ij})$',
                      '',
                      '多头  $K = 8$,  $d_h = 64$',
                      '注意力即"可解释关键连接"',
                    ].join('\n'),
                  },
                  'gated-fusion': {
                    header: '门控  跨模态  融合',
                    bodyText: [
                      '模态门控  $g_E,\\,g_F\\!\\in\\![0,1]^{d}$',
                      '$g_m\\!=\\!\\sigma(\\mathbf{W}_g[\\mathbf{H}^E\\Vert\\mathbf{H}^F]\\!+\\!\\mathbf{b}_g)$',
                      '',
                      '$\\mathbf{H}\\!=\\!g_E\\!\\odot\\!\\mathbf{H}^E\\!+\\!g_F\\!\\odot\\!\\mathbf{H}^F$',
                      '',
                      '逐样本自适应权重',
                      '$L_1$  稀疏先验  on  $g$',
                    ].join('\n'),
                  },
                  classifier: {
                    header: '分类器  +  事件解码',
                    bodyText: [
                      'BiGRU  +  2D-CNN  读出头',
                      '窗口  logits  $p_t\\!\\in\\![0,1]$',
                      '',
                      '合并连续  $p_t\\!>\\!0.5$  的窗口',
                      '最短持续  10 s,  不应期  30 s',
                      '',
                      '$\\mathrm{Out}\\!\\in\\!\\{\\,\\text{发作期},\\,\\text{非发作期}\\,\\}$',
                      '事件级  SE ↑ , FA/h ↓',
                      'LOSO  患者独立',
                    ].join('\n'),
                  },
                });
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
      filename="gat-cmc-overall"
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
              edges={GAT_CMC_EDGES}
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
          GAT-CMC-Net 整体架构图（论文 Fig. 1）。两条并行模态通路 EEG
          (上行) 与 fNIRS HbO+HbR (下行) 各自先经过基于 k-NN 图的多头
          GAT 提取局部图特征；fNIRS 通路紧接着进入本文核心创新模块
          —— 可学习 HRF 软位移 (HRF Soft-Shift)，逐通道学习一个
          {'$\\tau_c\\!\\in\\![0,\\tau_{\\max}]$'} 用高斯软 delta
          核把血流响应对齐到电信号起点，从而修正 1–6 s 的非平稳神经-血流耦合时移。
          两个模态对齐后送入异质多头 GAT (8 头, 4 类边类型)，再由门控跨模态融合自适应加权
          {'$\\mathbf{H}\\!=\\!g_E\\!\\odot\\!\\mathbf{H}^E\\!+\\!g_F\\!\\odot\\!\\mathbf{H}^F$'}，最终
          BiGRU + 2D-CNN 读出窗口级 logits 后由事件解码器合并为 LOSO
          患者独立的事件级癫痫预测 (评价口径：SE ↑、FA/h ↓)。Inspector
          支持逐模块编辑文字 / 字号 / 对齐、逐箭头改路径 / 加拐点、自由批注
          + 多 slot 配置保存 / JSON 导入导出；Inspiration 的「中文标注版」
          一键切换中文用于研讨，导出期刊 SVG 前再切回英文版即可。
        </p>
      }
      figure={
        <FigureFrame
          ref={svgRef}
          width={W}
          height={H}
          title="GAT-CMC-Net  ·  Heterogeneous Graph Attention with Learnable HRF Time-Shift for EEG-fNIRS Seizure Detection"
          caption={
            showSubtitle
              ? 'Per-modality multi-head GAT  →  learnable HRF soft-shift on fNIRS (key novelty)  →  heterogeneous multi-head GAT  →  gated cross-modal fusion  →  event-level seizure decoder (LOSO)'
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
              const waypoints = ov?.waypoints ?? [];

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
              const path = edgePath(fx, fy, tx, ty, fromAnchor, toAnchor, waypoints);

              return (
                <g key={e.id}>
                  <path
                    data-export="false"
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={14}
                    style={{ cursor: 'pointer' }}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setSelectedEdgeId(e.id);
                      if (ev.shiftKey) {
                        const svg = svgRef.current;
                        const ctm = svg?.getScreenCTM();
                        if (svg && ctm) {
                          const pt = new DOMPoint(
                            ev.clientX,
                            ev.clientY,
                          ).matrixTransform(ctm.inverse());
                          const segPts = [
                            { x: fx, y: fy },
                            ...waypoints,
                            { x: tx, y: ty },
                          ];
                          let bestSeg = 0;
                          let bestD = Infinity;
                          for (let i = 0; i < segPts.length - 1; i++) {
                            const mx = (segPts[i].x + segPts[i + 1].x) / 2;
                            const my = (segPts[i].y + segPts[i + 1].y) / 2;
                            const d = Math.hypot(mx - pt.x, my - pt.y);
                            if (d < bestD) {
                              bestD = d;
                              bestSeg = i;
                            }
                          }
                          insertWaypoint(e.id, pt.x, pt.y, bestSeg);
                        }
                      }
                    }}
                  />
                  <path
                    d={path}
                    fill="none"
                    stroke={PALETTE[e.category].edge}
                    strokeWidth={e.thickness ?? 1.6}
                    strokeDasharray={dash}
                    markerEnd={`url(#arch-arrow-${e.category})`}
                    pointerEvents="none"
                  />
                  {isSelected ? (
                    <g data-export="false">
                      <EdgeHandle
                        x={fx}
                        y={fy}
                        kind="endpoint"
                        onPointerDown={(ev) =>
                          edgeDrag.beginDrag(
                            { kind: 'endpoint', edgeId: e.id, which: 'from' },
                            fx,
                            fy,
                            ev,
                          )
                        }
                        onPointerMove={edgeDrag.onPointerMove}
                        onPointerUp={edgeDrag.onPointerUp}
                      />
                      <EdgeHandle
                        x={tx}
                        y={ty}
                        kind="endpoint"
                        onPointerDown={(ev) =>
                          edgeDrag.beginDrag(
                            { kind: 'endpoint', edgeId: e.id, which: 'to' },
                            tx,
                            ty,
                            ev,
                          )
                        }
                        onPointerMove={edgeDrag.onPointerMove}
                        onPointerUp={edgeDrag.onPointerUp}
                      />
                      {waypoints.map((wp, i) => (
                        <EdgeHandle
                          key={`wp-${i}`}
                          x={wp.x}
                          y={wp.y}
                          kind="waypoint"
                          onPointerDown={(ev) => {
                            if (ev.shiftKey) {
                              ev.stopPropagation();
                              removeWaypoint(e.id, i);
                              return;
                            }
                            edgeDrag.beginDrag(
                              { kind: 'waypoint', edgeId: e.id, index: i },
                              wp.x,
                              wp.y,
                              ev,
                            );
                          }}
                          onPointerMove={edgeDrag.onPointerMove}
                          onPointerUp={edgeDrag.onPointerUp}
                        />
                      ))}
                    </g>
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
                      pointerEvents="none"
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

          {edgeDrag.guides.points.length > 0 ? (
            <g data-export="false">
              {edgeDrag.guides.points.map((p, i) => (
                <circle
                  key={`esp-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={6}
                  fill="none"
                  stroke="#5b8def"
                  strokeWidth={1.5}
                  strokeDasharray="2 2"
                  opacity={0.9}
                />
              ))}
            </g>
          ) : null}

          {/* panels — wrapped in a per-panel <g> that owns the drag /
               snap pointer handlers so the figure can be re-arranged
               directly in the preview. The wrapper is invisible (no
               geometry of its own) so it never interferes with the
               exported SVG; pointer capture means moves outside the
               panel still drive the drag until the user releases. */}
          <g>
            {resolvedPanels.map((p) => {
              const slot = panelMap.get(p.id);
              if (!slot) return null;
              const ov = panelOverrides[p.id];
              const isDraggingThis = drag.draggingId === p.id;
              return (
                <g
                  key={p.id}
                  data-panel-id={p.id}
                  style={{
                    cursor: isDraggingThis ? 'grabbing' : 'grab',
                    touchAction: 'none',
                  }}
                  onPointerDown={(e) => {
                    setSelectedPanelId(p.id);
                    setSelectedBodyLine(null);
                    drag.onPointerDown(p.id, e);
                  }}
                  onPointerMove={drag.onPointerMove}
                  onPointerUp={drag.onPointerUp}
                  onPointerCancel={drag.onPointerUp}
                >
                  <Panel
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
                      if (drag.consumeDragSuppression()) return;
                      setSelectedPanelId(p.id);
                      setSelectedBodyLine(null);
                    }}
                    onSelectHeader={() => {
                      if (drag.consumeDragSuppression()) return;
                      requestFocusHeader(p.id);
                    }}
                    onSelectBodyLine={(idx) => {
                      if (drag.consumeDragSuppression()) return;
                      requestFocusBodyLine(p.id, idx);
                    }}
                    lineOverrides={ov?.lineOverrides}
                    highlightedLineIndex={
                      selectedBodyLine?.panelId === p.id
                        ? selectedBodyLine.lineIndex
                        : undefined
                    }
                  />
                </g>
              );
            })}
          </g>

          {/* alignment guides during a drag — preview-only, never
               exported. Length = full canvas so the guide reads as a
               clear "this edge / center is locked to that other edge"
               cue. */}
          {drag.guides.v.length > 0 || drag.guides.h.length > 0 ? (
            <g data-export="false">
              {drag.guides.v.map((g, i) => (
                <line
                  key={`gv-${i}`}
                  x1={g.coord}
                  y1={0}
                  x2={g.coord}
                  y2={H}
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
                  x2={W}
                  y2={g.coord}
                  stroke={g.source === 'canvas' ? '#d97a3a' : '#5b8def'}
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.85}
                />
              ))}
            </g>
          ) : null}

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

/**
 * Build the SVG path for an edge that may have user-added waypoints.
 * - 0 waypoints  → curvePath (smooth bezier or straight, by anchor pair)
 * - 1+ waypoints → straight polyline through all points
 *
 * The polyline form is intentionally simple so dragging a waypoint
 * predictably reshapes the route, mirroring how Figma / Lucid /
 * draw.io handle bend points.
 */
function edgePath(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  fromAnchor: Anchor,
  toAnchor: Anchor,
  waypoints: { x: number; y: number }[] | undefined,
): string {
  if (!waypoints || waypoints.length === 0) {
    return curvePath(fx, fy, tx, ty, fromAnchor, toAnchor);
  }
  const pts: { x: number; y: number }[] = [
    { x: fx, y: fy },
    ...waypoints,
    { x: tx, y: ty },
  ];
  return pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`)
    .join(' ');
}

/* =========================================================
 * v2 visual decorations — paper-grade SVG illustrations
 * mounted at the bottom of selected panels.
 *
 * All renderers are pure SVG (no <foreignObject>) so the export
 * pipeline picks them up vectorially without any rasterization,
 * and so MathJax replacement (which only touches `data-latex`
 * fields) leaves them untouched. Every renderer draws inside a
 * (vizW × vizH) box; the parent `<g>` translates them into place.
 *
 * Determinism: any pseudo-random shading uses a hash on (i,j)
 * indices, never `Math.random()`. This keeps repeated exports
 * byte-stable and SVG diff reviews quiet.
 * ========================================================= */

/** Default reserved height (px) for each viz band at the bottom
 *  of a panel. Body lines should be trimmed so they don't overlap. */
const VIZ_HEIGHT = 64;
const VIZ_PAD_X = 10;
const VIZ_PAD_BOTTOM = 8;

/**
 * Inferno-like 6-stop colour ramp (vector-friendly hex codes).
 * Used for adjacency-matrix heatmaps. Index in [0,1].
 */
const INFERNO_STOPS = [
  '#1b0c41',
  '#4a0c6b',
  '#a52c60',
  '#ed6925',
  '#fcb519',
  '#f6f7be',
];

function infernoColor(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const n = INFERNO_STOPS.length - 1;
  const idx = Math.min(n - 1, Math.floor(x * n));
  return INFERNO_STOPS[idx + 1] === undefined
    ? INFERNO_STOPS[idx]
    : INFERNO_STOPS[idx + (x * n - idx > 0.5 ? 1 : 0)];
}

/** Deterministic [0,1) hash on a pair of integers. */
function hash2(a: number, b: number, seed = 1): number {
  const s = Math.sin((a * 374761393 + b * 668265263 + seed * 982451653) % 1e9);
  return s - Math.floor(s);
}

interface VizProps {
  vizW: number;
  vizH: number;
  /** Panel category edge colour, used for chrome (frame, ticks). */
  edge: string;
}

/**
 * Adjacency-matrix thumbnail. Draws an NxN grid of cells with
 * inferno-mapped intensities. The diagonal is highlighted; the off-
 * diagonal pattern is sparse + symmetric so it visually reads as
 * "graph adjacency" rather than noise.
 */
function VizAdjacency({
  vizW,
  vizH,
  edge,
  n,
  seed,
  label,
}: VizProps & { n: number; seed: number; label: string }) {
  const inset = 2;
  const labelH = 10;
  const gridX = inset;
  const gridY = inset + labelH;
  const gridW = vizW - 2 * inset;
  const gridH = vizH - 2 * inset - labelH;
  const cell = Math.min(gridW / n, gridH / n);
  const ox = gridX + (gridW - cell * n) / 2;
  const oy = gridY + (gridH - cell * n) / 2;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      // Symmetric pattern: ~25% sparsity off-diagonal, diagonal always strong.
      let v = 0;
      if (i === j) {
        v = 0.92;
      } else {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const r = hash2(a, b, seed);
        if (r < 0.28) v = 0.35 + 0.55 * hash2(a, b, seed + 7);
      }
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={ox + j * cell}
          y={oy + i * cell}
          width={cell}
          height={cell}
          fill={v > 0 ? infernoColor(v) : '#100620'}
          stroke="none"
        />,
      );
    }
  }
  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        {label}
      </text>
      {cells}
      <rect
        x={ox - 0.5}
        y={oy - 0.5}
        width={cell * n + 1}
        height={cell * n + 1}
        fill="none"
        stroke={edge}
        strokeOpacity={0.55}
        strokeWidth={0.6}
      />
    </g>
  );
}

/**
 * Heterogeneous adjacency thumbnail with 4 quadrants: EE / EF / FE / FF.
 * Quadrant separators are emphasized to reflect the joint EEG ∪ fNIRS
 * node structure used by the heterogeneous multi-head GAT.
 */
function VizAdjHet({ vizW, vizH, edge }: VizProps) {
  const inset = 2;
  const labelH = 10;
  const gridX = inset;
  const gridY = inset + labelH;
  const gridW = vizW - 2 * inset;
  const gridH = vizH - 2 * inset - labelH;
  // 12×12 grid: top-left 6×6 = EE, top-right 6×6 = EF, ...
  const n = 12;
  const cell = Math.min(gridW / n, gridH / n);
  const ox = gridX + (gridW - cell * n) / 2;
  const oy = gridY + (gridH - cell * n) / 2;
  const half = n / 2;

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const ei = i < half ? 0 : 1;
      const ej = j < half ? 0 : 1;
      // Different sparsity per quadrant: EE/FF denser, EF/FE sparser.
      const sameMod = ei === ej;
      const sparsity = sameMod ? 0.42 : 0.18;
      let v = 0;
      if (i === j) {
        v = 0.92;
      } else {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const r = hash2(a, b, sameMod ? 11 : 23);
        if (r < sparsity)
          v = 0.3 + 0.6 * hash2(a, b, sameMod ? 31 : 41);
      }
      cells.push(
        <rect
          key={`${i}-${j}`}
          x={ox + j * cell}
          y={oy + i * cell}
          width={cell}
          height={cell}
          fill={v > 0 ? infernoColor(v) : '#100620'}
          stroke="none"
        />,
      );
    }
  }
  // Quadrant separators
  const midX = ox + half * cell;
  const midY = oy + half * cell;
  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        Adj{'\u00A0'}=[EE|EF;{'\u00A0'}FE|FF]
      </text>
      {cells}
      <line
        x1={midX}
        y1={oy}
        x2={midX}
        y2={oy + cell * n}
        stroke="#fff"
        strokeOpacity={0.85}
        strokeWidth={0.7}
      />
      <line
        x1={ox}
        y1={midY}
        x2={ox + cell * n}
        y2={midY}
        stroke="#fff"
        strokeOpacity={0.85}
        strokeWidth={0.7}
      />
      <rect
        x={ox - 0.5}
        y={oy - 0.5}
        width={cell * n + 1}
        height={cell * n + 1}
        fill="none"
        stroke={edge}
        strokeOpacity={0.6}
        strokeWidth={0.6}
      />
    </g>
  );
}

/**
 * 3D-perspective "lollipop" of graph node features: vertical columns
 * (each column = a node feature dimension) arranged along a
 * perspective floor with light connecting strokes. Mimics the
 * MA-MP-GF figure's per-modality node-feature visualisation.
 */
function VizLollipop({
  vizW,
  vizH,
  edge,
  topColor,
  label,
  seed,
}: VizProps & { topColor: string; label: string; seed: number }) {
  const inset = 2;
  const labelH = 10;
  const ox = inset + 4;
  const oy = inset + labelH;
  const innerW = vizW - 2 * (inset + 4);
  const innerH = vizH - 2 * inset - labelH - 2;

  const N = 14;
  const colW = innerW / (N + 2);
  const baselineY = oy + innerH * 0.78;
  const skewX = colW * 0.45; // perspective skew (top is shifted)
  const skewY = -innerH * 0.08;

  const cols: React.ReactNode[] = [];
  const tops: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const x0 = ox + (i + 1) * colW;
    const r = hash2(i, 0, seed);
    const colH = innerH * (0.18 + 0.6 * r);
    const x1 = x0 + colW * 0.7;
    const yBot = baselineY;
    const yTop = baselineY - colH;
    // Front face
    cols.push(
      <rect
        key={`f-${i}`}
        x={x0}
        y={yTop}
        width={colW * 0.7}
        height={colH}
        fill={topColor}
        opacity={0.85}
        stroke={edge}
        strokeWidth={0.4}
      />,
    );
    // Top face (parallelogram, perspective)
    cols.push(
      <polygon
        key={`t-${i}`}
        points={`${x0},${yTop} ${x1},${yTop} ${x1 + skewX},${yTop + skewY} ${
          x0 + skewX
        },${yTop + skewY}`}
        fill={topColor}
        opacity={1.0}
        stroke={edge}
        strokeWidth={0.4}
      />,
    );
    // Right face (parallelogram)
    cols.push(
      <polygon
        key={`r-${i}`}
        points={`${x1},${yTop} ${x1},${yBot} ${x1 + skewX},${yBot + skewY} ${
          x1 + skewX
        },${yTop + skewY}`}
        fill={topColor}
        opacity={0.6}
        stroke={edge}
        strokeWidth={0.4}
      />,
    );
    tops.push({ x: x0 + colW * 0.35 + skewX / 2, y: yTop + skewY / 2 });
  }
  // Floor connections (graph edges) — sparse curves between top centres.
  const edgeLines: React.ReactNode[] = [];
  for (let i = 0; i < N - 1; i++) {
    for (let j = i + 1; j < N; j++) {
      if (hash2(i, j, seed + 17) < 0.2) {
        const a = tops[i];
        const b = tops[j];
        const cx = (a.x + b.x) / 2;
        const cy = baselineY + 6;
        edgeLines.push(
          <path
            key={`e-${i}-${j}`}
            d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`}
            stroke={edge}
            strokeOpacity={0.35}
            strokeWidth={0.5}
            fill="none"
          />,
        );
      }
    }
  }
  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        {label}
      </text>
      {edgeLines}
      {cols}
      <line
        x1={ox}
        y1={baselineY}
        x2={ox + innerW}
        y2={baselineY}
        stroke={edge}
        strokeOpacity={0.45}
        strokeWidth={0.5}
      />
    </g>
  );
}

/**
 * HRF soft-shift kernel: shows an electrical-onset delta on the left
 * and a learnable Gaussian (peak at τ_c) on the right, with a small
 * arrow indicating the soft delay alignment direction.
 */
function VizHrfKernel({ vizW, vizH, edge }: VizProps) {
  const inset = 2;
  const labelH = 10;
  const ox = inset + 4;
  const oy = inset + labelH;
  const innerW = vizW - 2 * (inset + 4);
  const innerH = vizH - 2 * inset - labelH - 2;
  const baselineY = oy + innerH * 0.85;

  // Delta line (electrical onset) at t = 0
  const deltaX = ox + innerW * 0.2;
  // Gaussian peak at τ ≈ 0.6 of width
  const tauX = ox + innerW * 0.6;
  const sigma = innerW * 0.13;
  const peakY = oy + innerH * 0.18;

  const samples = 40;
  const pts: string[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const x = ox + t * innerW;
    const dx = x - tauX;
    const g = Math.exp(-(dx * dx) / (2 * sigma * sigma));
    const y = baselineY - g * (baselineY - peakY);
    pts.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        δσ(t − τc){'\u00A0'}·{'\u00A0'}learnable
      </text>
      <line
        x1={ox}
        y1={baselineY}
        x2={ox + innerW}
        y2={baselineY}
        stroke={edge}
        strokeOpacity={0.55}
        strokeWidth={0.5}
      />
      {/* Onset delta */}
      <line
        x1={deltaX}
        y1={baselineY}
        x2={deltaX}
        y2={oy + innerH * 0.25}
        stroke="#1F4E79"
        strokeWidth={1.4}
      />
      <polygon
        points={`${deltaX - 2.2},${oy + innerH * 0.28} ${deltaX + 2.2},${
          oy + innerH * 0.28
        } ${deltaX},${oy + innerH * 0.18}`}
        fill="#1F4E79"
      />
      {/* Gaussian curve */}
      <path
        d={pts.join(' ')}
        fill="none"
        stroke="#A33A22"
        strokeWidth={1.4}
      />
      {/* τ_c label + tick */}
      <line
        x1={tauX}
        y1={baselineY}
        x2={tauX}
        y2={baselineY + 3}
        stroke={edge}
        strokeWidth={0.6}
      />
      <text
        x={tauX}
        y={baselineY + 9}
        textAnchor="middle"
        fontSize={7.5}
        fill="#A33A22"
        fontStyle="italic"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        τc
      </text>
      {/* Shift arrow */}
      <line
        x1={deltaX + 3}
        y1={oy + innerH * 0.45}
        x2={tauX - 3}
        y2={oy + innerH * 0.45}
        stroke={edge}
        strokeOpacity={0.7}
        strokeWidth={0.6}
        strokeDasharray="2 2"
      />
      <polygon
        points={`${tauX - 4},${oy + innerH * 0.45 - 2} ${tauX - 4},${
          oy + innerH * 0.45 + 2
        } ${tauX - 1},${oy + innerH * 0.45}`}
        fill={edge}
        opacity={0.7}
      />
    </g>
  );
}

/**
 * Modality gate bars: g_E and g_F as horizontal bar pairs, normalised
 * to (0,1). Indicates per-sample adaptive weighting of the two modal
 * branches before fusion.
 */
function VizGateBars({ vizW, vizH, edge }: VizProps) {
  const inset = 2;
  const labelH = 10;
  const ox = inset + 18;
  const oy = inset + labelH + 2;
  const barLabelW = 18;
  const barX = ox;
  const barW = vizW - inset - barLabelW - 8 - inset;
  const barH = (vizH - 2 * inset - labelH - 8) / 2;
  const gateE = 0.62;
  const gateF = 0.41;

  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        modality{'\u00A0'}gates
      </text>
      {/* gate_E */}
      <text
        x={ox - 4}
        y={oy + barH * 0.7}
        textAnchor="end"
        fontSize={8}
        fill="#2E5C8A"
        fontStyle="italic"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        gE
      </text>
      <rect
        x={barX}
        y={oy}
        width={barW}
        height={barH}
        fill="#fff"
        stroke={edge}
        strokeOpacity={0.4}
        strokeWidth={0.5}
      />
      <rect
        x={barX}
        y={oy}
        width={barW * gateE}
        height={barH}
        fill="#2E5C8A"
        opacity={0.85}
      />
      <text
        x={barX + barW + 3}
        y={oy + barH * 0.75}
        fontSize={7.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {gateE.toFixed(2)}
      </text>
      {/* gate_F */}
      <text
        x={ox - 4}
        y={oy + barH + 4 + barH * 0.7}
        textAnchor="end"
        fontSize={8}
        fill="#A33A22"
        fontStyle="italic"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        gF
      </text>
      <rect
        x={barX}
        y={oy + barH + 4}
        width={barW}
        height={barH}
        fill="#fff"
        stroke={edge}
        strokeOpacity={0.4}
        strokeWidth={0.5}
      />
      <rect
        x={barX}
        y={oy + barH + 4}
        width={barW * gateF}
        height={barH}
        fill="#A33A22"
        opacity={0.85}
      />
      <text
        x={barX + barW + 3}
        y={oy + barH + 4 + barH * 0.75}
        fontSize={7.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {gateF.toFixed(2)}
      </text>
    </g>
  );
}

/**
 * Event-level seizure detection output: a small windowed EEG strip
 * with an ictal shaded band, a horizontal probability trace below,
 * and a binary {Ictal, Non-ictal} confidence pair.
 */
function VizEventOutput({ vizW, vizH, edge }: VizProps) {
  const inset = 2;
  const labelH = 10;
  const ox = inset + 4;
  const oy = inset + labelH;
  const innerW = vizW - 2 * (inset + 4);
  const innerH = vizH - 2 * inset - labelH - 2;

  // EEG strip (top half)
  const stripH = innerH * 0.45;
  const stripY = oy + 2;
  const baselineY = stripY + stripH * 0.5;
  const samples = 70;
  const pts: string[] = [];
  // Shaded ictal band from 35% to 75% of strip width
  const ictalX0 = ox + innerW * 0.35;
  const ictalX1 = ox + innerW * 0.75;
  for (let s = 0; s <= samples; s++) {
    const t = s / samples;
    const x = ox + t * innerW;
    let amp = 1.6;
    if (t > 0.35 && t < 0.75) amp = 5.0;
    const v =
      Math.sin(t * 22) * amp +
      Math.sin(t * 41 + 1) * (amp * 0.5) +
      (hash2(s, 0, 91) - 0.5) * amp * 0.6;
    const y = baselineY + v;
    pts.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
  }

  // Probability trace + bars (bottom half)
  const probY0 = oy + stripH + 6;
  const probH = innerH * 0.32;

  return (
    <g>
      <text
        x={vizW / 2}
        y={inset + labelH - 1}
        textAnchor="middle"
        fontSize={8.5}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontStyle="italic"
      >
        event{'\u00A0'}decoder{'\u00A0'}·{'\u00A0'}pt{'\u00A0'}/{'\u00A0'}label
      </text>
      {/* Ictal shaded band */}
      <rect
        x={ictalX0}
        y={stripY}
        width={ictalX1 - ictalX0}
        height={stripH}
        fill="#A33A22"
        opacity={0.13}
      />
      <rect
        x={ictalX0}
        y={stripY}
        width={ictalX1 - ictalX0}
        height={stripH}
        fill="none"
        stroke="#A33A22"
        strokeOpacity={0.5}
        strokeDasharray="2 2"
        strokeWidth={0.5}
      />
      <text
        x={(ictalX0 + ictalX1) / 2}
        y={stripY - 0.5}
        textAnchor="middle"
        fontSize={6.8}
        fill="#A33A22"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        ictal
      </text>
      {/* EEG trace */}
      <path d={pts.join(' ')} fill="none" stroke="#1F4E79" strokeWidth={0.7} />
      {/* Probability bars */}
      <rect
        x={ox}
        y={probY0}
        width={innerW}
        height={probH}
        fill="#fff"
        stroke={edge}
        strokeOpacity={0.4}
        strokeWidth={0.4}
      />
      {/* Threshold line */}
      <line
        x1={ox}
        y1={probY0 + probH * 0.5}
        x2={ox + innerW}
        y2={probY0 + probH * 0.5}
        stroke={edge}
        strokeOpacity={0.4}
        strokeDasharray="1 2"
        strokeWidth={0.4}
      />
      {/* p_t curve: low → high → low matching ictal band */}
      {(() => {
        const pPts: string[] = [];
        const pSamples = 40;
        for (let s = 0; s <= pSamples; s++) {
          const t = s / pSamples;
          const inIctal = t > 0.35 && t < 0.75;
          const target = inIctal ? 0.9 : 0.08;
          const x = ox + t * innerW;
          const y = probY0 + probH * (1 - target);
          pPts.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`);
        }
        return (
          <path
            d={pPts.join(' ')}
            fill="none"
            stroke="#1F6F2A"
            strokeWidth={1.2}
          />
        );
      })()}
      <text
        x={ox - 1}
        y={probY0 + probH + 7}
        fontSize={7}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Ictal{'\u00A0'}0.92
      </text>
      <text
        x={ox + innerW}
        y={probY0 + probH + 7}
        textAnchor="end"
        fontSize={7}
        fill={edge}
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        Non-ictal{'\u00A0'}0.08
      </text>
    </g>
  );
}

/**
 * Dispatcher that picks a viz renderer by kind and positions it at the
 * bottom of the panel rectangle.
 */
function PanelVizBlock({
  kind,
  panelW,
  panelH,
  edge,
}: {
  kind: VizKind;
  panelW: number;
  panelH: number;
  edge: string;
}) {
  const vizW = panelW - 2 * VIZ_PAD_X;
  const vizH = VIZ_HEIGHT;
  const tx = VIZ_PAD_X;
  const ty = panelH - vizH - VIZ_PAD_BOTTOM;
  let inner: React.ReactNode = null;
  switch (kind) {
    case 'adj-eeg':
      inner = (
        <VizAdjacency
          vizW={vizW}
          vizH={vizH}
          edge={edge}
          n={10}
          seed={3}
          label="AdjE  ·  k-NN(band-power)"
        />
      );
      break;
    case 'adj-fnirs':
      inner = (
        <VizAdjacency
          vizW={vizW}
          vizH={vizH}
          edge={edge}
          n={10}
          seed={11}
          label="AdjF  ·  k-NN(hemo)"
        />
      );
      break;
    case 'adj-het':
      inner = <VizAdjHet vizW={vizW} vizH={vizH} edge={edge} />;
      break;
    case 'lollipop-eeg':
      inner = (
        <VizLollipop
          vizW={vizW}
          vizH={vizH}
          edge={edge}
          topColor="#2E5C8A"
          label="hE  ·  multi-head"
          seed={5}
        />
      );
      break;
    case 'lollipop-fnirs':
      inner = (
        <VizLollipop
          vizW={vizW}
          vizH={vizH}
          edge={edge}
          topColor="#7B4FA0"
          label="hF  ·  multi-head"
          seed={19}
        />
      );
      break;
    case 'hrf-kernel':
      inner = <VizHrfKernel vizW={vizW} vizH={vizH} edge={edge} />;
      break;
    case 'gate-bars':
      inner = <VizGateBars vizW={vizW} vizH={vizH} edge={edge} />;
      break;
    case 'event-output':
      inner = <VizEventOutput vizW={vizW} vizH={vizH} edge={edge} />;
      break;
  }
  return (
    <g transform={`translate(${tx}, ${ty})`} pointerEvents="none">
      <rect
        x={-2}
        y={-2}
        width={vizW + 4}
        height={vizH + 4}
        rx={3}
        ry={3}
        fill="#ffffff"
        fillOpacity={0.65}
        stroke={edge}
        strokeOpacity={0.18}
        strokeWidth={0.5}
      />
      {inner}
    </g>
  );
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
      {spec.viz ? (
        <PanelVizBlock
          kind={spec.viz}
          panelW={w}
          panelH={h}
          edge={style.edge}
        />
      ) : null}
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
 * Draggable circular handle for arrow endpoints / waypoints.
 * Endpoints render as solid blue dots, waypoints as smaller white-fill
 * blue-stroke dots so the two are visually distinct.
 */
function EdgeHandle({
  x,
  y,
  kind,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  x: number;
  y: number;
  kind: 'endpoint' | 'waypoint';
  onPointerDown: (e: ReactPointerEvent<Element>) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
}) {
  return (
    <g
      data-export="false"
      style={{ cursor: 'grab', touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <circle cx={x} cy={y} r={9} fill="transparent" />
      <circle
        cx={x}
        cy={y}
        r={kind === 'endpoint' ? 4.5 : 3.8}
        fill={kind === 'endpoint' ? '#5b8def' : '#ffffff'}
        stroke={kind === 'endpoint' ? '#3050a0' : '#5b8def'}
        strokeWidth={kind === 'endpoint' ? 1 : 1.5}
      />
    </g>
  );
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
      <div className="space-y-1 pt-1">
        <p className="text-[11px] font-medium text-ink-200">
          拐点（{(override?.waypoints ?? []).length}）
        </p>
        <p className="text-[10px] leading-snug text-ink-400">
          预览中 Shift+点击箭头插入拐点；拖拽白色圆点移动；Shift+点击拐点删除。靠近模块边缘会自动吸附。
        </p>
        <button
          type="button"
          disabled={!override?.waypoints?.length}
          onClick={() => onPatch({ waypoints: undefined })}
          className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-ink-100 hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          清空所有拐点
        </button>
      </div>
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
  id: 'gat-cmc-overall',
  title: 'GAT-CMC-Net 异质图融合癫痫检测',
  titleEn: 'GAT-CMC-Net Heterogeneous Bimodal Fusion (Seizure Detection)',
  category: 'architecture',
  summary:
    'GAT-CMC-Net 整体架构图（论文 Fig.1）：EEG / fNIRS 双模态输入 → 多头图注意力 (GAT) → 可学习 HRF 软位移补偿 (核心创新) → 异质图多头 GAT → 门控跨模态融合 → 事件级癫痫解码 (LOSO + SE/FA·h)。默认英文期刊版，可一键切换中文标注版用于研讨；支持模块拖拽 / 箭头端点拖拽 + 拐点 / 逐模块自由编辑 / 自由批注 / 保存配置。',
  component: GatCmcDetailChart,
});
