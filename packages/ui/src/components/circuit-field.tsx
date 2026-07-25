import * as React from "react";

import { RESIZE_SETTLE_MS, useDebouncedSize, useReducedMotion, useViewportSize } from "./circuit-field-hooks.js";
import { type Point, type RoutePoint, densify, easeInOutCubic, hashString, pathData, recomputeCorners } from "./grid-math.js";
import {
  buildCellAxisMap,
  buildRoute,
  findIntersections,
  isColinearWithOther,
  sliceWindow,
  travelDuration,
} from "./route-engine.js";
import { type KeepOut, generateTraces } from "./trace-generation.js";

const MIN_TRACE_COUNT_AREA_DIVISOR = 55000;
// Mirrors `circuit-draw`'s animation-duration in packages/ui/src/styles.css —
// JS can't read a CSS animation-duration back out, so a via's boot delay
// (computed from how far along the trace it sits) needs this value kept in
// sync by hand if that keyframe's duration ever changes.
const TRACE_DRAW_MS = 650;
// Cap on the trace-to-trace boot stagger, matching the old index-based
// `Math.min(i * 30, 500)` cap this replaces.
const BOOT_STAGGER_MAX_MS = 500;

type ViaItem = {
  key: string;
  traceIndex: number;
  index: number;
  x: number;
  y: number;
  boot: boolean;
  delay: number;
  initiallyVisible: boolean;
};

export type CircuitFieldProps = {
  /**
   * Value that should trigger a re-seed/redraw when it changes — pass the
   * current route pathname so the layout regenerates on client-side
   * navigation within the app.
   */
  routeKey?: string;
};

/**
 * Animated, grid-aligned circuit-trace layer for `.grid-backdrop` pages.
 * Renders above the static CSS grid and below page content (fixed,
 * `z-index: -1`, so any unpositioned in-flow content still paints on top).
 *
 * A fixed number of trace "slots" is picked once from the first known
 * viewport size and kept alive for the component's whole lifetime. On the
 * very first mount, traces draw in with a staggered stroke animation (the
 * "boot" moment). On every subsequent `routeKey` change or settled resize,
 * each trace crawls — snake-style — from its old body to its new one: a
 * lattice route is built from the current body, through an L-shaped
 * connector corridor, to the target body, and a `requestAnimationFrame` loop
 * slides a fixed-arc-length window along that route each frame, writing the
 * SVG path/via attributes directly. Every frame's visible body is a
 * contiguous sub-path of an orthogonal lattice route, so it only ever moves
 * along grid lines — never diagonally — and never fully disappears; an
 * in-flight crawl retargets smoothly if interrupted by another change.
 * Skips the crawl (snaps immediately) under `prefers-reduced-motion`.
 */
export function CircuitField({ routeKey = "" }: CircuitFieldProps): React.JSX.Element | null {
  const size = useViewportSize();
  const debouncedSize = useDebouncedSize(size, RESIZE_SETTLE_MS);
  const reducedMotion = useReducedMotion();

  const reducedMotionRef = React.useRef(reducedMotion);
  React.useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const traceCountRef = React.useRef<number | null>(null);
  if (traceCountRef.current === null && size) {
    traceCountRef.current = Math.max(14, Math.round((size.width * size.height) / MIN_TRACE_COUNT_AREA_DIVISOR));
  }
  const traceCount = traceCountRef.current;

  const traceIds = React.useMemo(
    () => (traceCount === null ? [] : Array.from({ length: traceCount }, (_, i) => `t${i}`)),
    [traceCount],
  );

  const pathElRefs = React.useRef(new Map<string, SVGPathElement>());
  const viaElRefs = React.useRef(new Map<string, SVGRectElement>());
  const viaItemIndexRef = React.useRef(new Map<string, ViaItem>());
  const tipElRefs = React.useRef(new Map<string, SVGRectElement>());
  const liveBodyRef = React.useRef<RoutePoint[][] | null>(null);
  const rafRef = React.useRef<number | null>(null);

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
  // including every tick() frame — the same direct-ref approach as the path
  // `d` and tip positions above, so this never triggers a per-frame React
  // re-render. Unused pool slots are hidden rather than unmounted.
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

  // `tick()` writes `el.style.opacity` directly on existing via rects every
  // frame, bypassing React. When a key survives from one `setViaItems` call
  // to the next with the same computed `initiallyVisible` value (e.g. a
  // corner within the untouched `from` portion of a route), React's own
  // prop diffing sees no change between renders and skips reapplying the
  // style — leaving the DOM stuck at whatever opacity `tick()` last wrote,
  // even though the settled render means "visible". Force it explicitly so
  // rendered opacity never depends on React's diff bailing out.
  React.useLayoutEffect(() => {
    viaItems.forEach((item) => {
      if (item.boot) return;
      const el = viaElRefs.current.get(item.key);
      if (el) el.style.opacity = item.initiallyVisible ? "1" : "0";
    });
  }, [viaItems]);

  const targetTraces = React.useMemo(() => {
    if (!debouncedSize || traceCount === null) return null;

    const seed = hashString(`${routeKey}:${debouncedSize.width}x${debouncedSize.height}`);
    const keepOut: KeepOut = {
      x0: debouncedSize.width * 0.14,
      y0: debouncedSize.height * 0.1,
      x1: debouncedSize.width * 0.86,
      y1: debouncedSize.height * 0.78,
    };

    return { traces: generateTraces(debouncedSize.width, debouncedSize.height, seed, keepOut, traceCount), keepOut };
  }, [routeKey, debouncedSize?.width, debouncedSize?.height, traceCount]);

  React.useLayoutEffect(() => {
    if (!targetTraces) return;

    if (liveBodyRef.current === null) {
      const bodies = targetTraces.traces.map((trace) => recomputeCorners(densify(trace.points)));
      liveBodyRef.current = bodies;

      const cellAxisMap = buildCellAxisMap(
        targetTraces.traces.map((trace, i) => ({ id: trace.id, points: bodies[i] as RoutePoint[] })),
      );

      // "Sequential board power-on": traces closer to the keep-out's center
      // (the board's "chip") boot first, farther ones trail — a proxy for
      // real dependency order until Session C's spanning tree exists. Each
      // via's own delay then rides its trace's delay plus how far along the
      // body it sits, so vias pop in sequence as the stroke-draw animation
      // visually reaches them instead of all together.
      const keepOutCenter = {
        x: (targetTraces.keepOut.x0 + targetTraces.keepOut.x1) / 2,
        y: (targetTraces.keepOut.y0 + targetTraces.keepOut.y1) / 2,
      };
      const startDistances = targetTraces.traces.map((trace) => {
        const start = trace.points[0] as Point;
        return Math.hypot(start.x - keepOutCenter.x, start.y - keepOutCenter.y);
      });
      const minDistance = Math.min(...startDistances);
      const maxDistance = Math.max(...startDistances);
      const traceDelays = startDistances.map((distance) =>
        maxDistance > minDistance
          ? Math.round(((distance - minDistance) / (maxDistance - minDistance)) * BOOT_STAGGER_MAX_MS)
          : 0,
      );

      const items: ViaItem[] = [];
      targetTraces.traces.forEach((trace, i) => {
        const body = bodies[i] as RoutePoint[];
        const traceDelay = traceDelays[i] as number;

        body.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === body.length - 1) return;
          const arcFraction = body.length > 1 ? idx / (body.length - 1) : 0;
          items.push({
            key: `${trace.id}-${idx}`,
            traceIndex: i,
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
      });
      setViaItems(items);
      applyIntersections(findIntersections(cellAxisMap));

      targetTraces.traces.forEach((trace, i) => {
        const el = pathElRefs.current.get(trace.id);
        const body = bodies[i];
        if (!el || !body) return;

        el.setAttribute("d", pathData(body));

        if (reducedMotionRef.current) {
          el.style.strokeDasharray = "none";
          el.style.strokeDashoffset = "0";
        } else {
          const dashLength = trace.length || 1;
          el.classList.add("circuit-field-trace");
          el.style.strokeDasharray = String(dashLength);
          el.style.strokeDashoffset = String(dashLength);
          el.style.animationDelay = `${traceDelays[i]}ms`;
        }
      });

      return;
    }

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    pathElRefs.current.forEach((el) => {
      el.classList.remove("circuit-field-trace");
      el.style.strokeDasharray = "none";
      el.style.strokeDashoffset = "0";
    });

    const fromBodies = liveBodyRef.current;
    const transitions = targetTraces.traces.map((trace, i) => {
      const from = fromBodies[i] ?? recomputeCorners(densify(trace.points));
      const to = recomputeCorners(densify(trace.points));
      const route = buildRoute(from, to);

      return { id: trace.id, route, lenO: from.length, lenN: to.length, toBody: to };
    });

    if (reducedMotionRef.current) {
      liveBodyRef.current = transitions.map((transition) => transition.toBody);

      const cellAxisMap = buildCellAxisMap(
        transitions.map((transition) => ({ id: transition.id, points: transition.toBody })),
      );

      const items: ViaItem[] = [];
      transitions.forEach((transition, i) => {
        const el = pathElRefs.current.get(transition.id);
        if (el) el.setAttribute("d", pathData(transition.toBody));

        transition.toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === transition.toBody.length - 1) return;
          items.push({
            key: `${transition.id}-${idx}`,
            traceIndex: i,
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
      setViaItems(items);
      applyIntersections(findIntersections(cellAxisMap));

      return;
    }

    const initialCellAxisMap = buildCellAxisMap(
      transitions.map((transition) => ({ id: transition.id, points: transition.route.slice(0, transition.lenO) })),
    );

    const items: ViaItem[] = [];
    transitions.forEach((transition, i) => {
      transition.route.forEach((point, idx) => {
        if (!point.corner || idx === 0 || idx === transition.route.length - 1) return;
        items.push({
          key: `${transition.id}-${idx}`,
          traceIndex: i,
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
    setViaItems(items);

    const durations = transitions.map((transition) => travelDuration(transition.route.length - transition.lenO));
    const startTime = performance.now();
    const windowBounds: { tail: number; head: number }[] = [];

    const tick = (now: number) => {
      const elapsed = now - startTime;
      let allDone = true;
      const currentBodies: { id: string; points: RoutePoint[] }[] = [];
      const tipInfo: { id: string; end: "tail" | "head"; point: RoutePoint; axis: "h" | "v" }[] = [];

      transitions.forEach((transition, i) => {
        const duration = durations[i] as number;
        const t = Math.min(1, elapsed / duration);
        if (t < 1) allDone = false;

        const eased = easeInOutCubic(t);
        const headIndex = transition.lenO - 1 + (transition.route.length - transition.lenO) * eased;
        const bodySpan = transition.lenO - 1 + (transition.lenN - transition.lenO) * eased;
        const tailIndex = Math.max(0, headIndex - bodySpan);

        windowBounds[i] = { tail: tailIndex, head: headIndex };

        const window = sliceWindow(transition.route, tailIndex, headIndex);
        if (liveBodyRef.current) liveBodyRef.current[i] = window;
        currentBodies.push({ id: transition.id, points: window });

        const el = pathElRefs.current.get(transition.id);
        if (el) el.setAttribute("d", pathData(window));

        const tail = window[0];
        const tailNext = window[1];
        const head = window[window.length - 1];
        const headPrev = window[window.length - 2];
        if (tail && tailNext) tipInfo.push({ id: transition.id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
        if (head && headPrev) tipInfo.push({ id: transition.id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });
      });

      const cellAxisMap = buildCellAxisMap(currentBodies);
      tipInfo.forEach(({ id, end, point, axis }) => {
        setTipPosition(id, end, point, !isColinearWithOther(cellAxisMap, id, point, axis));
      });
      applyIntersections(findIntersections(cellAxisMap));

      viaElRefs.current.forEach((el, key) => {
        const item = viaItemIndexRef.current.get(key);
        const bounds = item ? windowBounds[item.traceIndex] : undefined;
        const visible = item && bounds ? item.index >= bounds.tail - 1e-3 && item.index <= bounds.head + 1e-3 : false;

        el.style.opacity = visible ? "1" : "0";
      });

      if (!allDone) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      rafRef.current = null;
      liveBodyRef.current = transitions.map((transition) => transition.toBody);

      const settled: ViaItem[] = [];
      transitions.forEach((transition, i) => {
        transition.toBody.forEach((point, idx) => {
          if (!point.corner || idx === 0 || idx === transition.toBody.length - 1) return;
          settled.push({
            key: `${transition.id}-${idx}`,
            traceIndex: i,
            index: idx,
            x: point.x,
            y: point.y,
            boot: false,
            delay: 0,
            initiallyVisible: true,
          });
        });
      });
      setViaItems(settled);
    };

    rafRef.current = requestAnimationFrame(tick);
    // Only the target trace identity should retrigger this effect — the
    // refs and callbacks it closes over are stable across renders.
  }, [targetTraces]);

  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
        stroke="var(--primary)"
        strokeLinecap="square"
        strokeWidth={1.5}
      >
        {traceIds.map((id) => (
          <path key={id} ref={pathRefCallbacks.get(id)} />
        ))}
      </g>
      <g className="circuit-field-glow" fill="var(--primary)">
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
