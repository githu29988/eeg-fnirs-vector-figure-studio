/**
 * Direct manipulation hook for panel-grid figures (the
 * `eeg-encoder-detail` / `fnirs-encoder-detail` family).
 *
 * Wires up SVG pointer events so the user can grab a panel in the
 * preview, drag it to a new position, and have alignment guides snap
 * the panel to the edges / centers of neighbouring panels. The new
 * position is committed back as a `dx` / `dy` override via the
 * caller-supplied `onDrag` callback — i.e. the same field the manual
 * inspector mutates, so JSON save / load and Slot persistence keep
 * working unchanged.
 *
 * Snapping strategy: while a panel is being dragged we compute its
 * left / horizontal-center / right and top / vertical-center / bottom
 * reference lines in SVG coordinates and look for any neighbour that
 * has a matching reference line within `snapThreshold` pixels (default
 * 8 px). If `canvasW` / `canvasH` are provided, the canvas vertical
 * and horizontal midlines are also offered as snap targets. When a
 * match is found we apply the snap delta and emit the matching
 * coordinate as a guide line (and a list of "matched panel id's" so
 * the chart can highlight which panels are aligned to the dragged
 * one). Guides only render in the live preview — never in the
 * exported SVG / PNG (the chart attaches `data-export="false"`).
 *
 * Click vs drag: pointer capture is **lazy** — we don't capture or
 * mark the panel as "being dragged" until movement exceeds
 * `CLICK_THRESHOLD` (3 px). Below that, the pointer events flow
 * normally and any nested click handlers (e.g. body-line text
 * selection) work as if the drag hook didn't exist. Once a real drag
 * starts, the next `click` event is suppressed via
 * `consumeDragSuppression()` so the inspector doesn't accidentally
 * focus a body-line text box just because the cursor was dragged
 * across it.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/** Minimum pointer movement (in SVG units) before we treat a press as
 *  a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/** Default snap distance for alignment guides. */
const DEFAULT_SNAP_THRESHOLD = 8;

export interface PanelDragSlot {
  id: string;
  /** Top-left X in SVG coords, including any current dx override. */
  x: number;
  /** Top-left Y in SVG coords, including any current dy override. */
  y: number;
  /** Rendered width in SVG units. */
  w: number;
  /** Rendered height in SVG units. */
  h: number;
}

export interface PanelBasePosition {
  x: number;
  y: number;
}

export interface PanelDragGuide {
  /** Coordinate (X for vertical guides, Y for horizontal guides) of
   *  the alignment line the dragged panel snapped to. */
  coord: number;
  /** Origin of the guide. `'panel'` means it traces a neighbouring
   *  panel's edge / center; `'canvas'` means the canvas mid-line. */
  source: 'panel' | 'canvas';
}

export interface PanelDragGuides {
  /** Vertical alignment guides (X coordinates). */
  v: PanelDragGuide[];
  /** Horizontal alignment guides (Y coordinates). */
  h: PanelDragGuide[];
}

export interface UsePanelDragOptions {
  /** SVG element ref so we can map screen → SVG coordinates. */
  svgRef: RefObject<SVGSVGElement | null>;
  /** Current resolved panel slots (with dx/dy already baked in). */
  slots: PanelDragSlot[];
  /** Base panel position (without dx/dy override). Required so we can
   *  compute the new override as `newX - baseX`. */
  basePositions: Map<string, PanelBasePosition>;
  /** Called on every move during a drag with the snapped dx/dy. */
  onDrag: (panelId: string, dx: number, dy: number) => void;
  /** Distance (in SVG units) within which a neighbouring reference
   *  line snaps the dragged panel. Defaults to 8 px. */
  snapThreshold?: number;
  /** Optional canvas width — when set, the canvas vertical midline
   *  (`canvasW / 2`) is offered as a snap target. */
  canvasW?: number;
  /** Optional canvas height — when set, the canvas horizontal
   *  midline (`canvasH / 2`) is offered as a snap target. */
  canvasH?: number;
}

export interface UsePanelDragResult {
  /** Currently dragged panel id, or null when idle. */
  draggingId: string | null;
  /** Active snap guides during the drag. Empty when idle. */
  guides: PanelDragGuides;
  /** Attach to the wrapping `<g>` of each panel render. */
  onPointerDown: (
    panelId: string,
    e: ReactPointerEvent<Element>,
  ) => void;
  /** Attach to the same wrapping `<g>` so move / up are routed via
   *  the drag state machine. Pointer capture is acquired lazily once
   *  total movement crosses `CLICK_THRESHOLD`. */
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  /** Reads + resets the "click suppressed because a real drag just
   *  finished" flag. Call from any onClick handler that should be
   *  suppressed after a drag. */
  consumeDragSuppression: () => boolean;
}

interface DragState {
  panelId: string;
  pointerStartX: number;
  pointerStartY: number;
  panelStartX: number;
  panelStartY: number;
  baseX: number;
  baseY: number;
  pointerId: number;
  totalMovement: number;
  /** True once movement has exceeded `CLICK_THRESHOLD`; the press is
   *  now treated as a drag, pointer capture has been acquired, and
   *  the trailing click event will be suppressed. */
  committed: boolean;
  capturedTarget: Element | null;
}

export function usePanelDrag(
  options: UsePanelDragOptions,
): UsePanelDragResult {
  const {
    svgRef,
    slots,
    basePositions,
    onDrag,
    snapThreshold = DEFAULT_SNAP_THRESHOLD,
    canvasW,
    canvasH,
  } = options;

  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<PanelDragGuides>({ v: [], h: [] });

  const slotMap = useMemo(() => {
    const m = new Map<string, PanelDragSlot>();
    for (const s of slots) m.set(s.id, s);
    return m;
  }, [slots]);

  const toSvgPoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const ctm = svg.getScreenCTM();
      if (!ctm) return null;
      const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    },
    [svgRef],
  );

  const onPointerDown = useCallback(
    (panelId: string, e: ReactPointerEvent<Element>) => {
      // Allow keyboard-modified clicks to pass through (e.g. ⌘-click for
      // future "select multiple" gestures); they shouldn't initiate a drag.
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const pt = toSvgPoint(e.clientX, e.clientY);
      if (!pt) return;
      const slot = slotMap.get(panelId);
      const base = basePositions.get(panelId);
      if (!slot || !base) return;
      dragStateRef.current = {
        panelId,
        pointerStartX: pt.x,
        pointerStartY: pt.y,
        panelStartX: slot.x,
        panelStartY: slot.y,
        baseX: base.x,
        baseY: base.y,
        pointerId: e.pointerId,
        totalMovement: 0,
        committed: false,
        capturedTarget: null,
      };
      // Note: we do NOT call setPointerCapture or setDraggingId yet.
      // Both are acquired lazily once the user moves past the click
      // threshold so simple clicks (e.g. on a body line to focus its
      // text in the inspector) keep working unchanged.
    },
    [basePositions, slotMap, toSvgPoint],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      const pt = toSvgPoint(e.clientX, e.clientY);
      if (!pt) return;
      const slot = slotMap.get(ds.panelId);
      if (!slot) return;

      const dx = pt.x - ds.pointerStartX;
      const dy = pt.y - ds.pointerStartY;
      ds.totalMovement = Math.abs(dx) + Math.abs(dy);

      // Lazily promote a press into a drag once we cross the click
      // threshold. Acquire pointer capture on the wrapper element
      // here (not on pointerdown) so simple clicks never see capture.
      if (!ds.committed && ds.totalMovement > CLICK_THRESHOLD) {
        ds.committed = true;
        const target = e.currentTarget as Element;
        try {
          target.setPointerCapture(e.pointerId);
          ds.capturedTarget = target;
        } catch {
          /* older browsers — drag still works, just won't follow if
             the pointer leaves the panel rect */
        }
        setDraggingId(ds.panelId);
      }
      if (!ds.committed) return;

      const rawX = ds.panelStartX + dx;
      const rawY = ds.panelStartY + dy;

      let snappedX = rawX;
      let snappedY = rawY;
      const newGuides: PanelDragGuides = { v: [], h: [] };

      const myXLines = [rawX, rawX + slot.w / 2, rawX + slot.w];
      const myYLines = [rawY, rawY + slot.h / 2, rawY + slot.h];

      let bestX: { delta: number; guide: PanelDragGuide } | null = null;
      let bestY: { delta: number; guide: PanelDragGuide } | null = null;

      const tryX = (cx: number, source: 'panel' | 'canvas') => {
        for (const mx of myXLines) {
          const d = cx - mx;
          if (
            Math.abs(d) <= snapThreshold &&
            (bestX === null || Math.abs(d) < Math.abs(bestX.delta))
          ) {
            bestX = { delta: d, guide: { coord: cx, source } };
          }
        }
      };
      const tryY = (cy: number, source: 'panel' | 'canvas') => {
        for (const my of myYLines) {
          const d = cy - my;
          if (
            Math.abs(d) <= snapThreshold &&
            (bestY === null || Math.abs(d) < Math.abs(bestY.delta))
          ) {
            bestY = { delta: d, guide: { coord: cy, source } };
          }
        }
      };

      for (const candidate of slots) {
        if (candidate.id === ds.panelId) continue;
        tryX(candidate.x, 'panel');
        tryX(candidate.x + candidate.w / 2, 'panel');
        tryX(candidate.x + candidate.w, 'panel');
        tryY(candidate.y, 'panel');
        tryY(candidate.y + candidate.h / 2, 'panel');
        tryY(candidate.y + candidate.h, 'panel');
      }
      // The dragged panel's own grid baseline. Snapping here makes
      // "drag back to default" clean — landing within the threshold
      // returns dx/dy to exactly 0 instead of leaving a tiny residual.
      tryX(ds.baseX, 'panel');
      tryX(ds.baseX + slot.w / 2, 'panel');
      tryX(ds.baseX + slot.w, 'panel');
      tryY(ds.baseY, 'panel');
      tryY(ds.baseY + slot.h / 2, 'panel');
      tryY(ds.baseY + slot.h, 'panel');
      // Canvas mid-lines as additional snap targets.
      if (typeof canvasW === 'number') tryX(canvasW / 2, 'canvas');
      if (typeof canvasH === 'number') tryY(canvasH / 2, 'canvas');

      if (bestX !== null) {
        snappedX += (bestX as { delta: number; guide: PanelDragGuide }).delta;
        newGuides.v.push((bestX as { delta: number; guide: PanelDragGuide }).guide);
      }
      if (bestY !== null) {
        snappedY += (bestY as { delta: number; guide: PanelDragGuide }).delta;
        newGuides.h.push((bestY as { delta: number; guide: PanelDragGuide }).guide);
      }

      setGuides((prev) => guidesEqual(prev, newGuides) ? prev : newGuides);

      const newDx = snappedX - ds.baseX;
      const newDy = snappedY - ds.baseY;
      onDrag(ds.panelId, newDx, newDy);
    },
    [canvasH, canvasW, onDrag, slotMap, slots, snapThreshold, toSvgPoint],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<Element>) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    if (ds.committed) {
      suppressClickRef.current = true;
      setDraggingId(null);
      setGuides({ v: [], h: [] });
    }
    if (ds.capturedTarget) {
      try {
        ds.capturedTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    dragStateRef.current = null;
  }, []);

  const consumeDragSuppression = useCallback((): boolean => {
    const v = suppressClickRef.current;
    suppressClickRef.current = false;
    return v;
  }, []);

  return {
    draggingId,
    guides,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    consumeDragSuppression,
  };
}

function guidesEqual(a: PanelDragGuides, b: PanelDragGuides): boolean {
  if (a.v.length !== b.v.length || a.h.length !== b.h.length) return false;
  for (let i = 0; i < a.v.length; i++) {
    if (a.v[i].coord !== b.v[i].coord || a.v[i].source !== b.v[i].source)
      return false;
  }
  for (let i = 0; i < a.h.length; i++) {
    if (a.h[i].coord !== b.h[i].coord || a.h[i].source !== b.h[i].source)
      return false;
  }
  return true;
}
