import * as React from "react";

import { HEIGHT_JITTER_IGNORE_PX, RESIZE_SETTLE_MS, useDebouncedSize, useReducedMotion, useViewportSize } from "./circuit-field-hooks.js";
import { useCircuitOccluderDelta, useCircuitOccluderRects } from "./circuit-occluder.js";
import { type Point, type RoutePoint, cellKey, densify, easeInOutCubic, hashString, pathData, polylineLength, recomputeCorners, snap } from "./grid-math.js";
import { type Occluder, type Rect, OCCLUDER_FALLOFF_PX, estimateEffectiveArea } from "./occlusion.js";
import {
  buildCellAxisMap,
  buildRoute,
  findIntersections,
  isColinearWithOther,
  sliceWindow,
  travelDuration,
} from "./route-engine.js";
import { buildOccupiedFootprint, findAffectedTraceIds, retargetTip } from "./scroll-retarget.js";
import { type Trace, generateTraces } from "./trace-generation.js";

const MIN_TRACE_COUNT = 14;
const MIN_TRACE_COUNT_AREA_DIVISOR = 55000;
// A traceCount recompute only commits if the desired value differs from the
// currently-committed one by more than this band — otherwise small occluder
// jitter (e.g. a header reflowing a couple px on font load) would thrash the
// slot count on every measurement.
const TRACE_COUNT_HYSTERESIS_RATIO = 0.1;
const TRACE_COUNT_HYSTERESIS_MIN_STEP = 2;
// Mirrors `circuit-draw`'s animation-duration in packages/ui/src/styles.css —
// JS can't read a CSS animation-duration back out, so a via's boot delay
// (computed from how far along the trace it sits) needs this value kept in
// sync by hand if that keyframe's duration ever changes.
const TRACE_DRAW_MS = 650;
// Cap on the trace-to-trace boot stagger.
const BOOT_STAGGER_MAX_MS = 500;
// Per-tree-depth-level boot delay step — replaces the old distance-from-
// keep-out-center proxy now that generation produces a real spanning tree.
const DEPTH_STAGGER_MS = 60;
// Secondary guard only — `transitionsRef.current.has(id)` filtering already
// prevents a same-tick double retarget (a nudge's `travelDuration` floors at
// 4000ms), this only covers the settle-then-immediately-dirty edge case.
const RETARGET_COOLDOWN_MS = 600;
const MAX_SCROLL_RETARGETS_PER_EVENT = 4;

type ViaItem = {
  key: string;
  traceId: string;
  index: number;
  x: number;
  y: number;
  boot: boolean;
  delay: number;
  initiallyVisible: boolean;
};

type TraceTransition = {
  route: RoutePoint[];
  lenO: number;
  lenN: number;
  toBody: RoutePoint[];
  startTime: number;
  duration: number;
};

export type CircuitFieldProps = {
  /**
   * Value that should trigger a re-seed/redraw when it changes — pass the
   * current route pathname so the layout regenerates on client-side
   * navigation within the app.
   */
  routeKey?: string;
};

function pointsEqual(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((point, i) => point.x === b[i]?.x && point.y === b[i]?.y);
}

/**
 * Animated, grid-aligned circuit-trace layer for `.grid-backdrop` pages.
 * Renders above the static CSS grid and below page content (fixed,
 * `z-index: -1`, so any unpositioned in-flow content still paints on top).
 *
 * Trace count reacts to *available* area (viewport size minus soft DOM
 * occlusion, registered via `useCircuitOccluder`/`CircuitOccluderProvider`)
 * rather than being frozen at mount. On the very first mount, traces draw in
 * with a staggered stroke animation (the "boot" moment, ordered by each
 * trace's depth in the generated spanning tree — see `trace-generation.ts`).
 * The same boot treatment applies to any slot added later by a trace-count
 * increase. On every `routeKey` change, settled resize, or occlusion change,
 * each *already-live* trace crawls — snake-style — from its old body to its
 * new one: a lattice route is built from the current body, through an
 * L-shaped connector corridor, to the target body, and a
 * `requestAnimationFrame` loop slides a fixed-arc-length window along that
 * route each frame, writing the SVG path/via attributes directly. Every
 * frame's visible body is a contiguous sub-path of an orthogonal lattice
 * route, so it only ever moves along grid lines — never diagonally — and
 * never fully disappears; an in-flight crawl retargets smoothly if
 * interrupted by another change. A trace whose target geometry is unchanged
 * since the last generation is skipped entirely (no transition, no DOM
 * write) — occlusion-driven regeneration is expected to be small/frequent,
 * so most traces on most updates are untouched. Skips the crawl (snaps
 * immediately) under `prefers-reduced-motion`.
 */
export function CircuitField({ routeKey = "" }: CircuitFieldProps): React.JSX.Element | null {
  const size = useViewportSize();
  const debouncedSize = useDebouncedSize(size, RESIZE_SETTLE_MS, { heightJitterIgnorePx: HEIGHT_JITTER_IGNORE_PX });
  const reducedMotion = useReducedMotion();
  const occluders = useCircuitOccluderRects();

  const reducedMotionRef = React.useRef(reducedMotion);
  React.useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const [traceCount, setTraceCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!debouncedSize) return;

    const effectiveArea = estimateEffectiveArea(debouncedSize.width, debouncedSize.height, occluders);
    const desired = Math.max(MIN_TRACE_COUNT, Math.round(effectiveArea / MIN_TRACE_COUNT_AREA_DIVISOR));

    setTraceCount((current) => {
      if (current === null) return desired;
      const band = Math.max(TRACE_COUNT_HYSTERESIS_MIN_STEP, Math.round(current * TRACE_COUNT_HYSTERESIS_RATIO));
      return Math.abs(desired - current) > band ? desired : current;
    });
  }, [debouncedSize?.width, debouncedSize?.height, occluders]);

  const traceIds = React.useMemo(
    () => (traceCount === null ? [] : Array.from({ length: traceCount }, (_, i) => `t${i}`)),
    [traceCount],
  );

  const pathElRefs = React.useRef(new Map<string, SVGPathElement>());
  const viaElRefs = React.useRef(new Map<string, SVGRectElement>());
  const viaItemIndexRef = React.useRef(new Map<string, ViaItem>());
  const tipElRefs = React.useRef(new Map<string, SVGRectElement>());
  const liveBodyRef = React.useRef(new Map<string, RoutePoint[]>());
  const previousTracesRef = React.useRef(new Map<string, Trace>());
  const transitionsRef = React.useRef(new Map<string, TraceTransition>());
  const rafActiveRef = React.useRef<number | null>(null);
  const lastRetargetAtRef = React.useRef(new Map<string, number>());

  const [viaItems, setViaItemsState] = React.useState<ViaItem[]>([]);

  const setViaItems = React.useCallback((items: ViaItem[]) => {
    viaItemIndexRef.current = new Map(items.map((item) => [item.key, item]));
    setViaItemsState(items);
  }, []);

  const pathRefCallbacks = React.useMemo(() => {
    const map = new Map<string, (el: SVGPathElement | null) => void>();

    traceIds.forEach((id) => {
      map.set(id, (el) => {
        if (el) pathElRefs.current.set(id, el);
        else pathElRefs.current.delete(id);
      });
    });

    return map;
  }, [traceIds]);

  const viaRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) viaElRefs.current.set(key, el);
      else viaElRefs.current.delete(key);
    };
  }, []);

  // A trace's own start/end are rarely real lattice corners while a crawl is
  // in flight — the visible window's tail/head are usually mid-segment
  // (`pointAtIndex` interpolation), so the corner-based via set (which only
  // ever marks real bends) never has anything to show there. These two
  // always-mounted "tip" rects per trace ride the current window's tail and
  // head every frame instead, so an end always has a node — moving with the
  // line while it crawls, landing exactly on the endpoint once it settles.
  const tipRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) tipElRefs.current.set(key, el);
      else tipElRefs.current.delete(key);
    };
  }, []);

  const setTipPosition = React.useCallback(
    (id: string, end: "tail" | "head", point: Point, visible: boolean) => {
      const el = tipElRefs.current.get(`${id}-${end}`);
      if (!el) return;
      el.setAttribute("x", String(point.x - 3));
      el.setAttribute("y", String(point.y - 3));
      el.style.opacity = visible ? "1" : "0";
    },
    [],
  );

  // Cross-trace intersection vias: a fixed pool of pre-mounted rects (sized
  // generously, well past any realistic simultaneous-crossing count) that
  // findIntersections' output is assigned into every time bodies change —
  // including every runTick() frame — the same direct-ref approach as the
  // path `d` and tip positions above, so this never triggers a per-frame
  // React re-render. Unused pool slots are hidden rather than unmounted.
  const intersectionElRefs = React.useRef(new Map<string, SVGRectElement>());
  const intersectionPoolSizeRef = React.useRef(0);

  const intersectionSlotIds = React.useMemo(
    () => (traceCount === null ? [] : Array.from({ length: traceCount * 3 }, (_, i) => `x${i}`)),
    [traceCount],
  );

  React.useEffect(() => {
    intersectionPoolSizeRef.current = intersectionSlotIds.length;
  }, [intersectionSlotIds]);

  const intersectionRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) intersectionElRefs.current.set(key, el);
      else intersectionElRefs.current.delete(key);
    };
  }, []);

  const applyIntersections = React.useCallback((points: Point[]) => {
    const poolSize = intersectionPoolSizeRef.current;

    points.forEach((point, i) => {
      if (i >= poolSize) return;
      const el = intersectionElRefs.current.get(`x${i}`);
      if (!el) return;
      el.setAttribute("x", String(point.x - 3));
      el.setAttribute("y", String(point.y - 3));
      el.style.opacity = "1";
    });

    for (let i = points.length; i < poolSize; i += 1) {
      const el = intersectionElRefs.current.get(`x${i}`);
      if (el) el.style.opacity = "0";
    }
  }, []);

  // `runTick()` writes `el.style.opacity` directly on existing via rects
  // every frame, bypassing React. When a key survives from one
  // `setViaItems` call to the next with the same computed
  // `initiallyVisible` value (e.g. a corner within the untouched `from`
  // portion of a route), React's own prop diffing sees no change between
  // renders and skips reapplying the style — leaving the DOM stuck at
  // whatever opacity `runTick()` last wrote, even though the settled
  // render means "visible". Force it explicitly so rendered opacity never
  // depends on React's diff bailing out.
  React.useLayoutEffect(() => {
    viaItems.forEach((item) => {
      if (item.boot) return;
      const el = viaElRefs.current.get(item.key);
      if (el) el.style.opacity = item.initiallyVisible ? "1" : "0";
    });
  }, [viaItems]);

  const targetTraces = React.useMemo(() => {
    if (!debouncedSize || traceCount === null) return null;

    // Occluder rects feed weighting only, never the seed — a panel resize
    // must not re-seed the whole field and blow away an in-flight crawl.
    const seed = hashString(`${routeKey}:${debouncedSize.width}x${debouncedSize.height}`);
    return generateTraces(debouncedSize.width, debouncedSize.height, seed, occluders, traceCount);
  }, [routeKey, debouncedSize?.width, debouncedSize?.height, traceCount, occluders]);

  // The single shared rAF driving every in-flight transition. Reads
  // `transitionsRef` fresh each frame instead of closing over a fixed
  // per-effect-run transition list, so starting/replacing an id's entry
  // (see the effect below) never needs to cancel and restart this loop —
  // it just keeps draining whatever's currently in the map. A trace that
  // finishes is removed from the map immediately (so the per-frame via
  // opacity pass below stops touching it — see the skip on missing
  // bounds) and its settled via items are folded into `viaItems` as soon
  // as it finishes, independent of any siblings still crawling.
  const runTick = React.useCallback(() => {
    const bodies = liveBodyRef.current;
    const now = performance.now();
    const currentBodies: { id: string; points: RoutePoint[] }[] = [];
    const tipInfo: { id: string; end: "tail" | "head"; point: RoutePoint; axis: "h" | "v" }[] = [];
    const windowBounds = new Map<string, { tail: number; head: number }>();
    const finished: { id: string; toBody: RoutePoint[] }[] = [];

    traceIds.forEach((id) => {
      const transition = transitionsRef.current.get(id);

      if (!transition) {
        const points = bodies.get(id) ?? [];
        currentBodies.push({ id, points });

        const tail = points[0];
        const tailNext = points[1];
        const head = points[points.length - 1];
        const headPrev = points[points.length - 2];
        if (tail && tailNext) tipInfo.push({ id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
        if (head && headPrev) tipInfo.push({ id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });
        return;
      }

      const t = Math.min(1, (now - transition.startTime) / transition.duration);
      const eased = easeInOutCubic(t);
      const headIndex = transition.lenO - 1 + (transition.route.length - transition.lenO) * eased;
      const bodySpan = transition.lenO - 1 + (transition.lenN - transition.lenO) * eased;
      const tailIndex = Math.max(0, headIndex - bodySpan);
      const window = sliceWindow(transition.route, tailIndex, headIndex);

      bodies.set(id, window);
      currentBodies.push({ id, points: window });

      const el = pathElRefs.current.get(id);
      if (el) el.setAttribute("d", pathData(window));

      const tail = window[0];
      const tailNext = window[1];
      const head = window[window.length - 1];
      const headPrev = window[window.length - 2];
      if (tail && tailNext) tipInfo.push({ id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
      if (head && headPrev) tipInfo.push({ id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });

      if (t >= 1) {
        bodies.set(id, transition.toBody);
        transitionsRef.current.delete(id);
        finished.push({ id, toBody: transition.toBody });
      } else {
        windowBounds.set(id, { tail: tailIndex, head: headIndex });
      }
    });

    const cellAxisMap = buildCellAxisMap(currentBodies);
    tipInfo.forEach(({ id, end, point, axis }) => {
      setTipPosition(id, end, point, !isColinearWithOther(cellAxisMap, id, point, axis));
    });
    applyIntersections(findIntersections(cellAxisMap));

    // A via whose trace isn't in `windowBounds` this frame is either
    // settled (never touched here) or just finished (handled by the
    // settled-items commit below, which the viaItems layout effect then
    // forces to its final opacity) — leaving it alone rather than treating
    // "no bounds" as "hidden" is what keeps a fast-finishing trace's vias
    // from flickering off while slower siblings are still crawling.
    viaElRefs.current.forEach((el, key) => {
      const item = viaItemIndexRef.current.get(key);
      if (!item) return;
      const bounds = windowBounds.get(item.traceId);
      if (!bounds) return;

      const visible = item.index >= bounds.tail - 1e-3 && item.index <= bounds.head + 1e-3;
      el.style.opacity = visible ? "1" : "0";
    });

    if (finished.length > 0) {
      const finishedIds = new Set(finished.map((f) => f.id));
      const carried = Array.from(viaItemIndexRef.current.values()).filter((item) => !finishedIds.has(item.traceId));
      const settled: ViaItem[] = [];

      finished.forEach(({ id, toBody }) => {
        toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === toBody.length - 1) return;
          settled.push({
            key: `${id}-${idx}`,
            traceId: id,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: true,
          });
        });
      });

      setViaItems([...carried, ...settled]);
    }

    if (transitionsRef.current.size > 0) {
      rafActiveRef.current = requestAnimationFrame(runTick);
    } else {
      rafActiveRef.current = null;
    }
  }, [applyIntersections, setTipPosition, setViaItems, traceIds]);

  // Handles a trace-count *shrink*: prunes stale entries for ids no longer
  // in `traceIds` from every id-keyed structure, and stops the shared rAF
  // loop if the only transitions left in flight belonged to removed ids
  // (otherwise it would keep animating something nobody renders, forever).
  // Declared before the main targetTraces effect (React runs layout effects
  // in declaration order) so a count change is fully pruned before the boot/
  // crawl effect below runs against the new `targetTraces`.
  React.useLayoutEffect(() => {
    const validIds = new Set(traceIds);

    liveBodyRef.current.forEach((_body, id) => {
      if (!validIds.has(id)) liveBodyRef.current.delete(id);
    });
    previousTracesRef.current.forEach((_trace, id) => {
      if (!validIds.has(id)) previousTracesRef.current.delete(id);
    });

    let removedInFlight = false;
    transitionsRef.current.forEach((_transition, id) => {
      if (!validIds.has(id)) {
        transitionsRef.current.delete(id);
        removedInFlight = true;
      }
    });

    if (removedInFlight && transitionsRef.current.size === 0 && rafActiveRef.current !== null) {
      cancelAnimationFrame(rafActiveRef.current);
      rafActiveRef.current = null;
    }

    const stale = Array.from(viaItemIndexRef.current.values()).some((item) => !validIds.has(item.traceId));
    if (stale) {
      setViaItems(Array.from(viaItemIndexRef.current.values()).filter((item) => validIds.has(item.traceId)));
    }
  }, [traceIds, setViaItems]);

  React.useLayoutEffect(() => {
    if (!targetTraces) return;

    const liveBodies = liveBodyRef.current;
    const priorBodies = new Map(liveBodies);
    const newTraces = targetTraces.traces.filter((trace) => !liveBodies.has(trace.id));
    const existingTraces = targetTraces.traces.filter((trace) => {
      if (!liveBodies.has(trace.id)) return false;
      const previous = previousTracesRef.current.get(trace.id);
      // A trace whose target geometry hasn't changed since the last
      // generation is skipped entirely — no transition, no DOM write. Most
      // traces on most occlusion-driven regenerations are unaffected, so
      // this is what keeps visible churn roughly proportional to what
      // actually changed rather than retargeting everything every time.
      return !previous || !pointsEqual(previous.points, trace.points);
    });

    previousTracesRef.current = new Map(targetTraces.traces.map((trace) => [trace.id, trace]));

    // --- Boot pass: brand-new slots (first mount, or growth from a
    // reactive trace-count increase) draw in with the staggered stroke
    // animation, ordered by their depth in the generated spanning tree.
    if (newTraces.length > 0) {
      const newBodies = new Map(newTraces.map((trace) => [trace.id, recomputeCorners(densify(trace.points))]));
      newBodies.forEach((body, id) => liveBodies.set(id, body));

      const cellAxisMap = buildCellAxisMap([
        ...newTraces.map((trace) => ({ id: trace.id, points: newBodies.get(trace.id) as RoutePoint[] })),
        ...existingTraces.map((trace) => ({ id: trace.id, points: priorBodies.get(trace.id) as RoutePoint[] })),
      ]);

      const bootItems: ViaItem[] = [];
      newTraces.forEach((trace) => {
        const body = newBodies.get(trace.id) as RoutePoint[];
        const traceDelay = Math.min(trace.depth * DEPTH_STAGGER_MS, BOOT_STAGGER_MAX_MS);

        body.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === body.length - 1) return;
          const arcFraction = body.length > 1 ? idx / (body.length - 1) : 0;
          bootItems.push({
            key: `${trace.id}-${idx}`,
            traceId: trace.id,
            index: idx,
            x: point.x,
            y: point.y,
            boot: !reducedMotionRef.current,
            delay: traceDelay + arcFraction * TRACE_DRAW_MS,
            initiallyVisible: true,
          });
        });

        const first = body[0];
        const second = body[1];
        const last = body[body.length - 1];
        const beforeLast = body[body.length - 2];
        if (first && second) {
          const axis: "h" | "v" = first.y === second.y ? "h" : "v";
          setTipPosition(trace.id, "tail", first, !isColinearWithOther(cellAxisMap, trace.id, first, axis));
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(trace.id, "head", last, !isColinearWithOther(cellAxisMap, trace.id, last, axis));
        }

        const el = pathElRefs.current.get(trace.id);
        if (!el) return;

        el.setAttribute("d", pathData(body));

        if (reducedMotionRef.current) {
          el.style.strokeDasharray = "none";
          el.style.strokeDashoffset = "0";
        } else {
          const dashLength = trace.length || 1;
          el.classList.add("circuit-field-trace");
          el.style.strokeDasharray = String(dashLength);
          el.style.strokeDashoffset = String(dashLength);
          el.style.animationDelay = `${traceDelay}ms`;
        }
      });

      setViaItems([...Array.from(viaItemIndexRef.current.values()), ...bootItems]);
      applyIntersections(findIntersections(cellAxisMap));
    }

    // --- Crawl pass: already-live traces whose target geometry changed.
    if (existingTraces.length === 0) return;

    existingTraces.forEach((trace) => {
      const el = pathElRefs.current.get(trace.id);
      if (el) {
        el.classList.remove("circuit-field-trace");
        el.style.strokeDasharray = "none";
        el.style.strokeDashoffset = "0";
      }
    });

    const transitions = existingTraces.map((trace) => {
      const from = liveBodies.get(trace.id) ?? recomputeCorners(densify(trace.points));
      const to = recomputeCorners(densify(trace.points));
      const route = buildRoute(from, to);

      return { id: trace.id, route, lenO: from.length, lenN: to.length, toBody: to };
    });

    if (reducedMotionRef.current) {
      transitions.forEach((transition) => {
        transitionsRef.current.delete(transition.id);
        liveBodies.set(transition.id, transition.toBody);
      });

      if (rafActiveRef.current !== null && transitionsRef.current.size === 0) {
        cancelAnimationFrame(rafActiveRef.current);
        rafActiveRef.current = null;
      }

      const cellAxisMap = buildCellAxisMap(
        transitions.map((transition) => ({ id: transition.id, points: transition.toBody })),
      );

      const items: ViaItem[] = [];
      transitions.forEach((transition) => {
        const el = pathElRefs.current.get(transition.id);
        if (el) el.setAttribute("d", pathData(transition.toBody));

        transition.toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === transition.toBody.length - 1) return;
          items.push({
            key: `${transition.id}-${idx}`,
            traceId: transition.id,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: true,
          });
        });

        const first = transition.toBody[0];
        const second = transition.toBody[1];
        const last = transition.toBody[transition.toBody.length - 1];
        const beforeLast = transition.toBody[transition.toBody.length - 2];
        if (first && second) {
          const axis: "h" | "v" = first.y === second.y ? "h" : "v";
          setTipPosition(transition.id, "tail", first, !isColinearWithOther(cellAxisMap, transition.id, first, axis));
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(transition.id, "head", last, !isColinearWithOther(cellAxisMap, transition.id, last, axis));
        }
      });

      const untouched = Array.from(viaItemIndexRef.current.values()).filter(
        (item) => !existingTraces.some((trace) => trace.id === item.traceId),
      );
      setViaItems([...untouched, ...items]);
      applyIntersections(findIntersections(cellAxisMap));

      return;
    }

    const initialCellAxisMap = buildCellAxisMap(
      transitions.map((transition) => ({ id: transition.id, points: transition.route.slice(0, transition.lenO) })),
    );

    const crawlItems: ViaItem[] = [];
    transitions.forEach((transition) => {
      transition.route.forEach((point, idx) => {
        if (!point.corner || idx === 0 || idx === transition.route.length - 1) return;
        crawlItems.push({
          key: `${transition.id}-${idx}`,
          traceId: transition.id,
          index: idx,
          x: point.x,
          y: point.y,
          boot: false,
          delay: 0,
          initiallyVisible: idx < transition.lenO,
        });
      });

      const start = transition.route[0];
      const second = transition.route[1];
      const head = transition.route[transition.lenO - 1];
      const beforeHead = transition.route[transition.lenO - 2];
      if (start && second) {
        const axis: "h" | "v" = start.y === second.y ? "h" : "v";
        setTipPosition(
          transition.id,
          "tail",
          start,
          !isColinearWithOther(initialCellAxisMap, transition.id, start, axis),
        );
      }
      if (head && beforeHead) {
        const axis: "h" | "v" = beforeHead.y === head.y ? "h" : "v";
        setTipPosition(
          transition.id,
          "head",
          head,
          !isColinearWithOther(initialCellAxisMap, transition.id, head, axis),
        );
      }
    });

    const untouched = Array.from(viaItemIndexRef.current.values()).filter(
      (item) => !existingTraces.some((trace) => trace.id === item.traceId),
    );
    setViaItems([...untouched, ...crawlItems]);

    // Seed/replace each trace's transition in place — an id already mid-crawl
    // keeps its slot overwritten (retargeting from its live in-flight body,
    // read back via `liveBodies.get(id)` above), everyone else gets a fresh
    // one. The shared loop below is started only if it isn't already
    // running; it drains whichever ids are in the map each frame, so this
    // never needs to cancel/restart transitions for ids that aren't changing.
    const startTime = performance.now();
    transitions.forEach((transition) => {
      transitionsRef.current.set(transition.id, {
        route: transition.route,
        lenO: transition.lenO,
        lenN: transition.lenN,
        toBody: transition.toBody,
        startTime,
        duration: travelDuration(transition.route.length - transition.lenO),
      });
    });

    if (rafActiveRef.current === null) {
      rafActiveRef.current = requestAnimationFrame(runTick);
    }
    // Only the target trace identity should retrigger this effect — the
    // refs and callbacks it closes over are stable across renders.
  }, [applyIntersections, runTick, setTipPosition, setViaItems, targetTraces]);

  // Scroll-driven retarget: nudges a live trace's tip away from an occluder
  // that just moved under it, using Session B's per-trace transition engine
  // exactly as the boot/crawl effect above does — never touches
  // `targetTraces`/`traceCount`/`generateTraces`, only `transitionsRef`/
  // `liveBodyRef`/`previousTracesRef` for the specific ids affected. Fires
  // from `useCircuitOccluderDelta`, which — unlike `useCircuitOccluderRects`
  // above — never causes a re-render on its own; this callback mutates refs
  // and writes SVG attributes directly, the same "outside the render cycle"
  // approach `runTick` already uses.
  const handleOccluderDelta = React.useCallback(
    (dirtyRects: Rect[], liveOccluders: Occluder[]) => {
      if (!debouncedSize) return;
      const now = performance.now();

      const tips: { id: string; point: Point }[] = [];
      traceIds.forEach((id) => {
        const body = liveBodyRef.current.get(id);
        const last = body?.[body.length - 1];
        if (last) tips.push({ id, point: last });
      });

      const candidateIds = findAffectedTraceIds(tips, dirtyRects, OCCLUDER_FALLOFF_PX)
        // A trace already mid-crawl has a `liveBodyRef` entry that's a
        // `sliceWindow(...)` partial window (old body + connector + new
        // body) — retargeting off that would truncate it and abandon its
        // real target, so never interrupt one.
        .filter((id) => !transitionsRef.current.has(id))
        .filter((id) => now - (lastRetargetAtRef.current.get(id) ?? 0) >= RETARGET_COOLDOWN_MS)
        .slice(0, MAX_SCROLL_RETARGETS_PER_EVENT);

      if (candidateIds.length === 0) return;

      const retargets: { id: string; route: RoutePoint[]; lenO: number; lenN: number; toBody: RoutePoint[] }[] = [];
      // Cells claimed by a candidate already resolved earlier in this same
      // delta event — `liveBodyRef` for that candidate isn't mutated until
      // later (the reduced-motion branch below, or `runTick` draining
      // `transitionsRef` on a future frame), so without this a second
      // candidate in the same event can't see the first one's new tip and
      // could pick the same cell.
      const pendingCells = new Set<string>();

      candidateIds.forEach((id) => {
        const liveBody = liveBodyRef.current.get(id);
        const trace = previousTracesRef.current.get(id);
        if (!liveBody || !trace) return;

        const occupied = buildOccupiedFootprint(liveBodyRef.current, id);
        pendingCells.forEach((cell) => occupied.add(cell));
        const newTip = retargetTip(liveBody, occupied, liveOccluders, debouncedSize.width, debouncedSize.height);
        if (!newTip) return;
        pendingCells.add(cellKey(newTip));

        const sparsePoints = [...trace.points.slice(0, -1), newTip];
        const toBody = recomputeCorners(
          densify(sparsePoints).map((point) => ({ ...point, x: snap(point.x), y: snap(point.y) })),
        );
        const route = buildRoute(liveBody, toBody);

        // The sparse point list, not the densified body — writing the dense
        // body here would make the next legitimate regeneration's
        // `pointsEqual(previous.points, trace.points)` check permanently
        // miscompare dense-vs-sparse for this trace, defeating the
        // skip-if-unchanged optimization for it forever.
        previousTracesRef.current.set(id, { ...trace, points: sparsePoints, length: polylineLength(sparsePoints) });
        lastRetargetAtRef.current.set(id, now);
        retargets.push({ id, route, lenO: liveBody.length, lenN: toBody.length, toBody });
      });

      if (retargets.length === 0) return;

      if (reducedMotionRef.current) {
        const cellAxisMap = buildCellAxisMap(retargets.map((r) => ({ id: r.id, points: r.toBody })));
        const settled: ViaItem[] = [];

        retargets.forEach((r) => {
          liveBodyRef.current.set(r.id, r.toBody);
          const el = pathElRefs.current.get(r.id);
          if (el) el.setAttribute("d", pathData(r.toBody));

          r.toBody.forEach((point, idx) => {
            if (!point.corner || idx === 0 || idx === r.toBody.length - 1) return;
            settled.push({
              key: `${r.id}-${idx}`,
              traceId: r.id,
              index: idx,
              x: point.x,
              y: point.y,
              boot: false,
              delay: 0,
              initiallyVisible: true,
            });
          });

          const first = r.toBody[0];
          const second = r.toBody[1];
          const last = r.toBody[r.toBody.length - 1];
          const beforeLast = r.toBody[r.toBody.length - 2];
          if (first && second) {
            const axis: "h" | "v" = first.y === second.y ? "h" : "v";
            setTipPosition(r.id, "tail", first, !isColinearWithOther(cellAxisMap, r.id, first, axis));
          }
          if (last && beforeLast) {
            const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
            setTipPosition(r.id, "head", last, !isColinearWithOther(cellAxisMap, r.id, last, axis));
          }
        });

        const retargetedIds = new Set(retargets.map((r) => r.id));
        const untouched = Array.from(viaItemIndexRef.current.values()).filter(
          (item) => !retargetedIds.has(item.traceId),
        );
        setViaItems([...untouched, ...settled]);
        applyIntersections(findIntersections(cellAxisMap));
        return;
      }

      const initialCellAxisMap = buildCellAxisMap(retargets.map((r) => ({ id: r.id, points: r.route.slice(0, r.lenO) })));
      const crawlItems: ViaItem[] = [];

      retargets.forEach((r) => {
        r.route.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === r.route.length - 1) return;
          crawlItems.push({
            key: `${r.id}-${idx}`,
            traceId: r.id,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: idx < r.lenO,
          });
        });

        const start = r.route[0];
        const second = r.route[1];
        const head = r.route[r.lenO - 1];
        const beforeHead = r.route[r.lenO - 2];
        if (start && second) {
          const axis: "h" | "v" = start.y === second.y ? "h" : "v";
          setTipPosition(r.id, "tail", start, !isColinearWithOther(initialCellAxisMap, r.id, start, axis));
        }
        if (head && beforeHead) {
          const axis: "h" | "v" = beforeHead.y === head.y ? "h" : "v";
          setTipPosition(r.id, "head", head, !isColinearWithOther(initialCellAxisMap, r.id, head, axis));
        }
      });

      const retargetedIds = new Set(retargets.map((r) => r.id));
      const untouched = Array.from(viaItemIndexRef.current.values()).filter(
        (item) => !retargetedIds.has(item.traceId),
      );
      setViaItems([...untouched, ...crawlItems]);

      retargets.forEach((r) => {
        transitionsRef.current.set(r.id, {
          route: r.route,
          lenO: r.lenO,
          lenN: r.lenN,
          toBody: r.toBody,
          startTime: now,
          duration: travelDuration(r.route.length - r.lenO),
        });
      });

      if (rafActiveRef.current === null) {
        rafActiveRef.current = requestAnimationFrame(runTick);
      }
    },
    [applyIntersections, debouncedSize, runTick, setTipPosition, setViaItems, traceIds],
  );

  useCircuitOccluderDelta(handleOccluderDelta);

  React.useEffect(
    () => () => {
      if (rafActiveRef.current !== null) cancelAnimationFrame(rafActiveRef.current);
    },
    [],
  );

  if (!size) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      className="circuit-field"
      height={size.height}
      style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }}
      width={size.width}
    >
      <g
        className="circuit-field-glow"
        fill="none"
        stroke="color-mix(in oklab, var(--primary) 60%, var(--background))"
        strokeLinecap="square"
        strokeWidth={1.5}
      >
        {traceIds.map((id) => (
          <path key={id} ref={pathRefCallbacks.get(id)} />
        ))}
      </g>
      <g className="circuit-field-glow" fill="color-mix(in oklab, var(--primary) 60%, var(--background))">
        {viaItems.map((item) => (
          <rect
            className={item.boot ? "circuit-field-via" : undefined}
            height={6}
            key={item.key}
            ref={viaRefCallback(item.key)}
            style={item.boot ? { animationDelay: `${item.delay}ms` } : { opacity: item.initiallyVisible ? 1 : 0 }}
            width={6}
            x={item.x - 3}
            y={item.y - 3}
          />
        ))}
        {traceIds.flatMap((id) => [
          <rect
            height={6}
            key={`${id}-tail`}
            ref={tipRefCallback(`${id}-tail`)}
            style={{ opacity: 0 }}
            width={6}
            x={-3}
            y={-3}
          />,
          <rect
            height={6}
            key={`${id}-head`}
            ref={tipRefCallback(`${id}-head`)}
            style={{ opacity: 0 }}
            width={6}
            x={-3}
            y={-3}
          />,
        ])}
        {intersectionSlotIds.map((key) => (
          <rect
            height={6}
            key={key}
            ref={intersectionRefCallback(key)}
            style={{ opacity: 0 }}
            width={6}
            x={-3}
            y={-3}
          />
        ))}
      </g>
    </svg>
  );
}
