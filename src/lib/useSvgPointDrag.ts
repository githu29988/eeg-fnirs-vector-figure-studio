/**
 * Generic SVG-coordinate single-point drag hook.
 *
 * Used for direct manipulation of arrow endpoints, polyline
 * waypoints, and annotation handles in the encoder-detail charts.
 * Works with any opaque caller-defined `T` "tag" so the same hook
 * can drive multiple kinds of handles (endpoints, waypoints, ...).
 *
 * Design notes:
 *   - Pointer capture is acquired lazily on first movement past
 *     `CLICK_THRESHOLD` (3 px) so a click on a handle can still
 *     propagate to e.g. select-the-edge logic without immediately
 *     starting a phantom drag.
 *   - Snap targets are computed lazily via a caller-supplied
 *     `getSnapTargets` callback so they can depend on the latest
 *     panel layout each frame.
 *   - The hook owns no notion of "what is being dragged" — it just
 *     reports the new SVG-coordinates back to the caller, which is
 *     responsible for translating that into whatever override field
 *     it persists.
 */
import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

const CLICK_THRESHOLD = 3;
const DEFAULT_SNAP_THRESHOLD = 8;

export interface SvgDragGuide {
  /** Coordinate (X for vertical guide, Y for horizontal guide) of
   *  the line to draw. */
  coord: number;
  /** Origin of the guide for color-coding ('panel' = blue, 'canvas'
   *  = orange in the standard preview style). */
  source: 'panel' | 'canvas' | 'point';
}

export interface SvgDragGuides {
  v: SvgDragGuide[];
  h: SvgDragGuide[];
  /** Single-point snap circles to highlight (e.g. snapped to a
   *  panel anchor). */
  points: { x: number; y: number }[];
}

export interface SvgDragSnapTargets {
  /** X coordinates the dragged X should snap to (with `source`
   *  metadata for color). */
  xLines?: { coord: number; source: 'panel' | 'canvas' }[];
  yLines?: { coord: number; source: 'panel' | 'canvas' }[];
  /** Points where BOTH x AND y should snap simultaneously (e.g.
   *  panel anchor points for arrow endpoints). The closest point
   *  within `snapThreshold` (in 2D distance) wins and overrides any
   *  per-axis line snap. */
  points?: { x: number; y: number }[];
}

export interface UseSvgPointDragOptions<T> {
  svgRef: RefObject<SVGSVGElement | null>;
  /** Called continuously during a drag with the snapped (x, y).
   *  Caller is responsible for persisting this to whatever override
   *  store backs the dragged element. */
  onMove: (tag: T, x: number, y: number) => void;
  /** Called once on pointer-up of a real drag (>3 px movement). */
  onCommit?: (tag: T, x: number, y: number) => void;
  /** Returns snap candidates for the current frame. Receives the
   *  active drag tag so callers can exclude self-snapping. */
  getSnapTargets?: (tag: T) => SvgDragSnapTargets;
  snapThreshold?: number;
}

export interface UseSvgPointDragResult<T> {
  activeTag: T | null;
  guides: SvgDragGuides;
  /** Begin a drag. Pass the element-start position in SVG
   *  coordinates so we can compute deltas correctly. */
  beginDrag: (
    tag: T,
    elementStartX: number,
    elementStartY: number,
    e: ReactPointerEvent<Element>,
  ) => void;
  onPointerMove: (e: ReactPointerEvent<Element>) => void;
  onPointerUp: (e: ReactPointerEvent<Element>) => void;
  consumeClickSuppression: () => boolean;
}

interface DragState<T> {
  tag: T;
  pointerId: number;
  pointerStartX: number;
  pointerStartY: number;
  elementStartX: number;
  elementStartY: number;
  totalMovement: number;
  committed: boolean;
  capturedTarget: Element | null;
  lastSnappedX: number;
  lastSnappedY: number;
}

export function useSvgPointDrag<T>(
  options: UseSvgPointDragOptions<T>,
): UseSvgPointDragResult<T> {
  const {
    svgRef,
    onMove,
    onCommit,
    getSnapTargets,
    snapThreshold = DEFAULT_SNAP_THRESHOLD,
  } = options;

  const dragStateRef = useRef<DragState<T> | null>(null);
  const suppressClickRef = useRef(false);
  const [activeTag, setActiveTag] = useState<T | null>(null);
  const [guides, setGuides] = useState<SvgDragGuides>({
    v: [],
    h: [],
    points: [],
  });

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

  const beginDrag = useCallback(
    (
      tag: T,
      elementStartX: number,
      elementStartY: number,
      e: ReactPointerEvent<Element>,
    ) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
      const pt = toSvgPoint(e.clientX, e.clientY);
      if (!pt) return;
      dragStateRef.current = {
        tag,
        pointerId: e.pointerId,
        pointerStartX: pt.x,
        pointerStartY: pt.y,
        elementStartX,
        elementStartY,
        totalMovement: 0,
        committed: false,
        capturedTarget: null,
        lastSnappedX: elementStartX,
        lastSnappedY: elementStartY,
      };
    },
    [toSvgPoint],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      const pt = toSvgPoint(e.clientX, e.clientY);
      if (!pt) return;

      const dx = pt.x - ds.pointerStartX;
      const dy = pt.y - ds.pointerStartY;
      ds.totalMovement = Math.abs(dx) + Math.abs(dy);

      if (!ds.committed && ds.totalMovement > CLICK_THRESHOLD) {
        ds.committed = true;
        const target = e.currentTarget as Element;
        try {
          target.setPointerCapture(e.pointerId);
          ds.capturedTarget = target;
        } catch {
          /* ignore */
        }
        setActiveTag(ds.tag);
      }
      if (!ds.committed) return;

      const rawX = ds.elementStartX + dx;
      const rawY = ds.elementStartY + dy;

      let snappedX = rawX;
      let snappedY = rawY;
      const newGuides: SvgDragGuides = { v: [], h: [], points: [] };

      const snapTargets = getSnapTargets ? getSnapTargets(ds.tag) : undefined;

      // 2D point snap takes priority — it locks both axes at once,
      // so a panel anchor point becomes a magnet, not just two
      // independent lines.
      if (snapTargets?.points) {
        let bestPt: { d: number; pt: { x: number; y: number } } | null = null;
        for (const p of snapTargets.points) {
          const d = Math.hypot(p.x - rawX, p.y - rawY);
          if (d <= snapThreshold && (bestPt === null || d < bestPt.d)) {
            bestPt = { d, pt: p };
          }
        }
        if (bestPt !== null) {
          snappedX = bestPt.pt.x;
          snappedY = bestPt.pt.y;
          newGuides.points.push(bestPt.pt);
        }
      }

      // Fallback to axis-only snap if no 2D point grabbed.
      if (newGuides.points.length === 0) {
        let bestX: { delta: number; line: SvgDragGuide } | null = null;
        let bestY: { delta: number; line: SvgDragGuide } | null = null;
        for (const xl of snapTargets?.xLines ?? []) {
          const d = xl.coord - rawX;
          if (
            Math.abs(d) <= snapThreshold &&
            (bestX === null || Math.abs(d) < Math.abs(bestX.delta))
          ) {
            bestX = { delta: d, line: { coord: xl.coord, source: xl.source } };
          }
        }
        for (const yl of snapTargets?.yLines ?? []) {
          const d = yl.coord - rawY;
          if (
            Math.abs(d) <= snapThreshold &&
            (bestY === null || Math.abs(d) < Math.abs(bestY.delta))
          ) {
            bestY = { delta: d, line: { coord: yl.coord, source: yl.source } };
          }
        }
        if (bestX !== null) {
          snappedX += bestX.delta;
          newGuides.v.push(bestX.line);
        }
        if (bestY !== null) {
          snappedY += bestY.delta;
          newGuides.h.push(bestY.line);
        }
      }

      ds.lastSnappedX = snappedX;
      ds.lastSnappedY = snappedY;
      setGuides((prev) => (guidesEqual(prev, newGuides) ? prev : newGuides));
      onMove(ds.tag, snappedX, snappedY);
    },
    [getSnapTargets, onMove, snapThreshold, toSvgPoint],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<Element>) => {
      const ds = dragStateRef.current;
      if (!ds || ds.pointerId !== e.pointerId) return;
      if (ds.committed) {
        suppressClickRef.current = true;
        if (onCommit) onCommit(ds.tag, ds.lastSnappedX, ds.lastSnappedY);
        setActiveTag(null);
        setGuides({ v: [], h: [], points: [] });
      }
      if (ds.capturedTarget) {
        try {
          ds.capturedTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      dragStateRef.current = null;
    },
    [onCommit],
  );

  const consumeClickSuppression = useCallback((): boolean => {
    const v = suppressClickRef.current;
    suppressClickRef.current = false;
    return v;
  }, []);

  return {
    activeTag,
    guides,
    beginDrag,
    onPointerMove,
    onPointerUp,
    consumeClickSuppression,
  };
}

function guidesEqual(a: SvgDragGuides, b: SvgDragGuides): boolean {
  if (
    a.v.length !== b.v.length ||
    a.h.length !== b.h.length ||
    a.points.length !== b.points.length
  )
    return false;
  for (let i = 0; i < a.v.length; i++)
    if (a.v[i].coord !== b.v[i].coord || a.v[i].source !== b.v[i].source)
      return false;
  for (let i = 0; i < a.h.length; i++)
    if (a.h[i].coord !== b.h[i].coord || a.h[i].source !== b.h[i].source)
      return false;
  for (let i = 0; i < a.points.length; i++)
    if (a.points[i].x !== b.points[i].x || a.points[i].y !== b.points[i].y)
      return false;
  return true;
}
