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
 * 6 px). When a match is found we apply the snap delta and emit the
 * matching coordinate as a guide line so the chart can render a
 * dashed alignment overlay (visible only in the live preview, never
 * in exported SVG / PNG).
 *
 * Click / drag disambiguation: a "click" on a panel that should select
 * it is distinguished from a "drag" by total pointer movement. After a
 * real drag (>3 px movement) the next `click` event is suppressed via
 * `consumeDragSuppression()`, which both reads and resets the flag.
 * Callers should wrap any `onSelect` / `onSelectHeader` /
 * `onSelectBodyLine` callback so the click is dropped on drop.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

/** Minimum pointer movement (in SVG units) before we treat a press as
 *  a drag rather than a click. */
const CLICK_THRESHOLD = 3;

/** Default snap distance for alignment guides. */
const DEFAULT_SNAP_THRESHOLD = 6;

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

export interface PanelDragGuides {
  /** X coordinates (in SVG units) for vertical alignment guides. */
  v: number[];
  /** Y coordinates (in SVG units) for horizontal alignment guides. */
  h: number[];
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
   *  line snaps the dragged panel. Defaults to 6 px. */
  snapThreshold?: number;
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
   *  pointer capture. */
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
  } = options;

  const dragStateRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [guides, setGuides] = useState<PanelDragGuides>({ v: [], h: [] });

  // Stable lookups so the move handler doesn't allocate maps every frame.
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
      };
      setDraggingId(panelId);
      const target = e.currentTarget as Element;
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        /* ignore — older browsers */
      }
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

      const rawX = ds.panelStartX + (pt.x - ds.pointerStartX);
      const rawY = ds.panelStartY + (pt.y - ds.pointerStartY);
      ds.totalMovement +=
        Math.abs(pt.x - ds.pointerStartX) + Math.abs(pt.y - ds.pointerStartY);

      let snappedX = rawX;
      let snappedY = rawY;
      const newGuides: PanelDragGuides = { v: [], h: [] };

      // 3 vertical reference lines on the dragged panel: left, hcenter, right.
      const myXLines = [rawX, rawX + slot.w / 2, rawX + slot.w];
      const myYLines = [rawY, rawY + slot.h / 2, rawY + slot.h];

      let bestX: { delta: number; guide: number } | null = null;
      let bestY: { delta: number; guide: number } | null = null;
      for (const candidate of slots) {
        if (candidate.id === ds.panelId) continue;
        const cXs = [candidate.x, candidate.x + candidate.w / 2, candidate.x + candidate.w];
        const cYs = [candidate.y, candidate.y + candidate.h / 2, candidate.y + candidate.h];
        for (const cx of cXs) {
          for (const mx of myXLines) {
            const delta = cx - mx;
            if (
              Math.abs(delta) <= snapThreshold &&
              (bestX === null || Math.abs(delta) < Math.abs(bestX.delta))
            ) {
              bestX = { delta, guide: cx };
            }
          }
        }
        for (const cy of cYs) {
          for (const my of myYLines) {
            const delta = cy - my;
            if (
              Math.abs(delta) <= snapThreshold &&
              (bestY === null || Math.abs(delta) < Math.abs(bestY.delta))
            ) {
              bestY = { delta, guide: cy };
            }
          }
        }
      }
      if (bestX !== null) {
        snappedX += bestX.delta;
        newGuides.v.push(bestX.guide);
      }
      if (bestY !== null) {
        snappedY += bestY.delta;
        newGuides.h.push(bestY.guide);
      }

      setGuides((prev) => {
        if (
          prev.v.length === newGuides.v.length &&
          prev.h.length === newGuides.h.length &&
          prev.v.every((x, i) => x === newGuides.v[i]) &&
          prev.h.every((y, i) => y === newGuides.h[i])
        ) {
          return prev;
        }
        return newGuides;
      });

      const newDx = snappedX - ds.baseX;
      const newDy = snappedY - ds.baseY;
      onDrag(ds.panelId, newDx, newDy);
    },
    [onDrag, slotMap, slots, snapThreshold, toSvgPoint],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<Element>) => {
    const ds = dragStateRef.current;
    if (!ds || ds.pointerId !== e.pointerId) return;
    if (ds.totalMovement > CLICK_THRESHOLD) {
      suppressClickRef.current = true;
    }
    dragStateRef.current = null;
    setDraggingId(null);
    setGuides({ v: [], h: [] });
    const target = e.currentTarget as Element;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
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
