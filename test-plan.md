# PR #4 Test Plan — Expert mode parameter tree

## What changed (user-visible)
Each of 14 charts now has a **Simple ⇄ Expert** tab in the inspector header. Expert mode shows a dense, schema-driven parameter tree with collapsible groups (Sample / Classifier / Display / etc.) exposing parameters that aren't in the Simple view (random seed, bootstrap iterations, force-sim ticks, mesh resolution, etc.). Simple inspector is unchanged.

Code refs:
- `src/components/ExpertPanel.tsx:1-200` — schema types + renderer
- `src/components/ChartShell.tsx:1-100` — Mode tab, conditional ExpertPanel vs inspector
- `src/charts/confusion-matrix/index.tsx` — seed in Expert, not in Simple
- `src/charts/roc-pr/index.tsx` — bootstrap iterations in Expert, not in Simple
- `src/charts/hegat-map/index.tsx` — force-sim iterations in Expert, not in Simple

## Test 1 — Confusion Matrix: Expert-only `seed` mutates the figure
**Path**: Sidebar → Evaluation → Confusion Matrix
1. Inspector header shows "Simple inspector" + a `Simple | Expert` tab. **Pass**: tab visible.
2. Confirm Simple inspector does NOT contain a "random seed" control. **Pass**: no seed in Simple.
3. Click `Expert`. Header text becomes "Expert parameter tree". Three groups appear: `Sample`, `Classifier`, `Display`. **Pass**: all three group titles visible.
4. In `Sample` group, find `random seed` (NumberInput, default 42). Change to `1`. **Pass**: matrix cell pattern visibly changes (different misclassification distribution).
5. Click `Simple`. Header reverts. **Pass**: no console errors; figure unchanged from step 4 (state preserved).

Why this is adversarial: if `seed` weren't wired into useMemo deps, changing it would NOT alter the matrix (broken impl produces visually identical figure). Step 4 catches this.

## Test 2 — ROC/PR: Expert `bootstrap iterations` changes legend CI bracket
**Path**: Sidebar → Evaluation → ROC / PR
1. Click `Expert`. Locate `Bootstrap` group → `iterations` field.
2. Note current AUC 95% CI in figure legend (e.g. `0.92 [0.89, 0.94]`).
3. Change iterations from default to a different value (e.g. 200 → 50).
4. **Pass**: CI bracket numerically changes (lower iterations produce a different CI estimate). If bracket text is identical, broken.

## Test 3 — HeGAT-Map: Expert `simulation iterations` relaxes the layout
**Path**: Sidebar → Architecture → HeGAT-Map
1. Click `Expert`. Locate `Force layout` group → `iterations` slider.
2. Set iterations to a low value (e.g. 50). Note rough node positions (cluster overlap).
3. Set iterations to a high value (e.g. 800).
4. **Pass**: node positions visibly relax (clusters separate further). If positions identical, broken.

## Pass criteria summary
- All 3 charts show the `Simple | Expert` tab
- Expert mode shows the documented schema groups
- Expert-only parameters (`seed`, `iterations`, `force ticks`) all visibly mutate the figure
- Switching back to Simple does not crash, no console errors

## Out of scope
- Inspiration panel (PR #5)
- BIDS / SNIRF data ingestion (PR #6)
- Other 11 charts (covered by structural identity — same ChartShell + ExpertPanel pipeline)
