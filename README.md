# EEG-fNIRS Vector Figure Studio

> Production-grade academic visualisation for multimodal neuroscience.
> From model output matrix to publication-ready vector figure — in a
> single, opinionated pipeline.

---

## Why this exists

Multimodal neuroscience increasingly fuses **EEG** (millisecond-scale
temporal resolution) with **fNIRS** (centimetre-scale spatial
resolution) through graph attention networks and CNN backbones.
Traditional plotting tools (MATLAB, EEGLAB, Origin, …) are built for
single-modality signal processing or generic statistics, so authors are
forced to glue together Python heatmaps, Adobe Illustrator overlays,
and screenshot-stitching to produce a final figure. The result: misaligned
coordinate systems, raster aliasing, and hours of yak-shaving per figure.

**EEG-fNIRS Vector Figure Studio** establishes a direct pipeline from
the model's output tensors to the journal's PDF. Every 2D figure is
authored as SVG; raster export at 300 / 600 / 1200 DPI is a
deterministic post-process. LaTeX is a first-class citizen across
labels, legends, and captions.

---

## Tech stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Frontend | **React 19** + **Vite** + **TypeScript** | Fast HMR, strict typing for matrix-shaped data. |
| Styling | **Tailwind CSS 3** | Atomic styling for dense scientific control panels. |
| 2D rendering | **D3.js v7** | DOM-level SVG control, force layouts, contour generation. |
| 3D rendering | **Three.js** | WebGL cortical projection, vertex-shader heat mapping. |
| Math | **KaTeX** | In-figure LaTeX without bundling MathJax's full surface. |
| Routing | **react-router** (Hash) | Deep-link to individual figures; works under `file://` for desktop builds. |
| Desktop (Phase 4) | **Tauri** | Native file I/O for GB-scale `.mat` / `.edf` ingestion. |

---

## Repository layout

```
src/
  main.tsx               app entry, registers HashRouter
  registry.tsx           central chart registry (CATEGORIES, registerChart)
  charts/                one folder per figure; each module side-effect
                         registers itself via registerChart()
  components/
    AppShell.tsx         sidebar + outlet
    FigureFrame.tsx      shared SVG wrapper (title + caption + KaTeX)
    ExportToolbar.tsx    SVG / PNG@DPI download controls
  lib/
    colormaps.ts         perceptually uniform palettes only
    latex.ts             KaTeX wrapper, $inline$ + $$display$$ parser
    export.ts            SVG serialisation + DPI-aware PNG raster
    figure.ts            shared theme tokens, margins, sizing helpers
    random.ts            seeded mulberry32 + box-muller for demo data
  pages/
    Overview.tsx         landing page listing categories
    ChartPage.tsx        renders the registered chart for /:id
```

---

## Authoring a new chart

Each chart is a self-contained module that registers itself once at
import time. The skeleton:

```tsx
// src/charts/my-figure/index.tsx
import { useRef } from 'react';
import { FigureFrame } from '../../components/FigureFrame';
import { ExportToolbar } from '../../components/ExportToolbar';
import { registerChart } from '../../registry';

function MyFigure() {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <div className="space-y-3">
      <ExportToolbar getSvg={() => svgRef.current} baseFilename="my-figure" />
      <FigureFrame
        ref={svgRef}
        width={720}
        height={480}
        title="$\\alpha$-attention map"
        caption="Synthetic demo data, seed=7."
      >
        {/* … D3 / Three.js content … */}
      </FigureFrame>
    </div>
  );
}

registerChart({
  id: 'my-figure',
  title: 'My Figure',
  titleZh: '我的图',
  category: 'architecture',
  summary: 'One-sentence description of what this figure visualises.',
  component: MyFigure,
});
```

Then add `import './my-figure';` to `src/charts/index.ts` so the
registration runs at startup.

### Authoring rules

1. **Vector first.** Use `<svg>` for 2D. Reach for Canvas / WebGL only
   when point counts exceed ~10⁵ — and even then, expose an SVG export
   path that emits genuine `<circle>` / `<path>` elements.
2. **Ramps must be perceptually uniform.** Pick from `lib/colormaps.ts`.
   Jet / rainbow are intentionally excluded.
3. **Use `FigureFrame`** for titles and captions. Inline LaTeX (`$…$`)
   and display LaTeX (`$$…$$`) render automatically through KaTeX.
4. **Reproducible data.** All demo datasets must come from
   `mulberry32(seed)` so screenshots compare cleanly.
5. **Margins.** Use `DEFAULT_MARGINS` and `innerSize()` from
   `lib/figure.ts` so figures align across the studio.

---

## Running locally

```bash
nvm use 22.13           # node 22.13+ required by ESLint 10
npm install
npm run dev             # http://localhost:5173
npm run build           # tsc -b && vite build
npm run lint
```

---

## Chart catalogue (v1)

All 14 figures ship with a seeded synthetic data generator, a Simple
inspector (3–5 high-impact controls), an Expert parameter tree (full
controllable surface, collapsible), and an Inspiration panel
(curated variant tiles that re-bind several Expert parameters in one
click — e.g. *Rare-disease screening* on ROC/PR or *Sparse network*
on HeGAT-Map).

### Architecture (3)

1. **Heterogeneous Graph Attention Map** — force-directed bipartite
   graph between EEG electrodes and fNIRS channels with
   attention-weighted edges.
2. **Bimodal Feature Fusion Flowchart** — layered DAG of the EEG/fNIRS
   fusion network with per-edge tensor-shape annotations.
3. **Spatiotemporal CNN Architecture** — cabinet-projection cube
   sequence visualising `T × C × F` evolution through dilated TCN
   blocks.

### Physiology (3)

4. **EEG–fNIRS Co-registration Topomap** — 10-20 azimuthal scalp map
   with fNIRS optodes and Banana-shape source–detector photon paths.
5. **Neurovascular Coupling Alignment** — dual-axis EEG / HbO–HbR time
   series with seizure-stage highlight bands.
6. **3.5D Cortical Projection** — procedural brain mesh rendered as
   depth-sorted SVG triangles with per-vertex activation colouring.

### Clinical (3)

7. **Cross-modal Lead–Lag Correlation Matrix** — EEG↔fNIRS lag matrix
   with p-value significance stars.
8. **Seizure Focus Localisation** — d3-contour over a 2D importance
   grid clipped to the head disc, with anatomical landmarks.
9. **Dynamic Connectivity Chord** — time-sliceable chord diagram of a
   `T × N × N` attention tensor.

### Evaluation (5)

10. **ROC + PR curves** — multi-classifier overlay with AUC, AP, and
    bootstrap 95% confidence intervals.
11. **Confusion Matrix** — per-class predictions with row-normalisation
    toggle and contrast-aware annotations.
12. **Calibration Curve** — reliability diagram with Expected
    Calibration Error per model, marker size encoding bin count.
13. **Ablation Contribution Funnel** — trapezoidal funnel showing
    per-component accuracy delta.
14. **Feature Manifold (t-SNE / UMAP)** — class-coloured embedding
    scatter with covariance-derived 95% confidence ellipses.

---

## Roadmap

- **Phase 1 — MVP.** ✅ All 14 figures implemented with seeded synthetic
  data; SVG-first vector pipeline; DPI-configurable PNG export; KaTeX
  titles + captions; Simple inspector per chart.
- **Phase 2 — Alpha.** ✅ MathJax SVG output for true vector formulas;
  ✅ Expert mode parameter tree; ✅ Inspiration variant tiles.
  Real-data ingestion (BIDS / SNIRF / EDF via Web Workers) is the
  remaining Phase 2 item.
- **Phase 3 — Beta.** Project workspace + snapshots + IndexedDB cache;
  batch export and quality-check engine; live KaTeX editor.
- **Phase 4 — v1.0.** Tauri-packaged desktop builds for Windows /
  macOS, memory-stable large-tensor ingestion, public render-jobs API,
  team-version (auth / audit / RLS).

---

## License

TBD. Treat as proprietary until a license file is committed.
