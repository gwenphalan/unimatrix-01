import * as React from "react";

import {
  HEIGHT_JITTER_IGNORE_PX,
  RESIZE_SETTLE_MS,
  useDebouncedSize,
  useMotionMode,
  useViewportSize,
} from "./circuit-field-hooks.js";
import { CircuitDebugOverlay } from "./circuit-debug-overlay.js";
import { installCircuitDebugConsoleApi } from "./circuit-debug.js";
import { useCircuitOccluderDelta, useCircuitOccluderRects } from "./circuit-occluder.js";
import { createFrameBudgetProbe } from "./frame-budget.js";
import {
  GRID,
  type Point,
  type RoutePoint,
  cellKey,
  densify,
  easeInOutCubic,
  hashString,
  pathData,
  polylineLength,
  recomputeCorners,
  snap,
} from "./grid-math.js";
import {
  IDLE_PACKET_MAX_CONCURRENT,
  IDLE_PACKET_POOL_SIZE,
  PACKET_SPAWN_INTERVAL_MS,
  type Packet,
  type PacketGraph,
  advancePacket,
  buildPacketGraph,
  packetsOffLiveGeometry,
} from "./idle-packets.js";
import { TRAIL_SEGMENTS, pushTrailPoint, trailSlices } from "./packet-trail.js";
import {
  type BarrierField,
  type Occluder,
  type Rect,
  OCCLUDER_AFFECT_MARGIN_PX,
  buildBarrierField,
  isCellBlocked,
  translateRect,
} from "./occlusion.js";
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

// Tile size of `.grid-backdrop`'s bold background tier, in `GRID` cells — a
// mirror of the `240px` in `styles.css`, needed here only to phase that tier
// (see the `--grid-bold-phase-*` effect below). Nothing else in this file
// knows about the bold tier.
const BOLD_GRID = GRID * 6;

/**
 * Offset that puts a line of a `tile`-sized lattice exactly on `extent`'s
 * midpoint: `background-position: P` on a tile of size T puts lines at
 * `P + n * T`, so a line hits `center` exactly when `P ≡ center (mod T)`.
 */
function latticePhase(extent: number, tile: number): number {
  return ((extent / 2) % tile) + (extent < 0 ? tile : 0);
}

/** The fine-lattice phase for the current document, or 0,0 outside a DOM. */
function measureGridPhase(): Point {
  if (typeof document === "undefined") return { x: 0, y: 0 };

  const root = document.documentElement;
  return { x: latticePhase(root.clientWidth, GRID), y: latticePhase(root.clientHeight, GRID) };
}

// Opacity of the trail slice nearest the packet; the rest fade linearly to
// nothing at the tail. Deliberately below the packet's own so the head still
// reads as the brightest thing on the trace.
const TRAIL_HEAD_OPACITY = 0.3;

// Stroke width (px) of the trail slice nearest the packet. Slices narrow
// linearly from here toward the tail, which is what reads as a taper — SVG
// strokes are uniform-width, so the taper has to be faked by slicing.
const TRAIL_HEAD_WIDTH = 4;

const MIN_TRACE_COUNT = 18;
const MIN_TRACE_COUNT_AREA_DIVISOR = 40000;
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
// Idle packets must not start before boot's CSS stagger has actually finished
// drawing — a packet walking an undrawn stroke would visibly misbehave.
// Mirrors the same two constants boot's own delay math already uses.
const IDLE_READY_DELAY_MS = BOOT_STAGGER_MAX_MS + TRACE_DRAW_MS;

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

// Input shape for an in-place tip retarget (scroll delta) — see
// `applyRetargets` below.
type RetargetEntry = {
  id: string;
  route: RoutePoint[];
  lenO: number;
  lenN: number;
  toBody: RoutePoint[];
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
 * Trace count reacts to raw viewport area (see the `traceCount` effect's own
 * comment for why occluder-adjusted area was reverted) rather than being
 * frozen at mount; barrier geometry from `useCircuitOccluder`/
 * `CircuitOccluderProvider`-registered rects still drives where each trace
 * *routes*, as a hard keep-out with a small buffer, never where its count
 * lands. On the very first mount, traces draw in
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
  const debouncedSize = useDebouncedSize(size, RESIZE_SETTLE_MS, {
    heightJitterIgnorePx: HEIGHT_JITTER_IGNORE_PX,
  });

  // How far the whole lattice — background grid *and* rendered traces — is
  // offset from the 0,0 origin so a grid line lands exactly on the page's
  // centerline. Without it the lattice is lopsided against centered content
  // on any viewport whose half-extent isn't a whole number of cells: the
  // content edges sit at different distances from their nearest lines.
  // Content is centered in the viewport here — measured live, the `mx-auto
  // max-w-[92rem]` shell's rect center equals `clientWidth / 2` — so the
  // viewport centerline *is* the content centerline.
  //
  // Both background tiers get a phase (`--grid-phase-*` for the 40px tier,
  // `--grid-bold-phase-*` for the 240px one). They stay seam-locked because
  // 240 is a whole multiple of GRID, so `center % 240 ≡ center % GRID`.
  //
  // `ResizeObserver` on `documentElement`, not a `size`/`useViewportSize`
  // (`window.innerWidth/innerHeight`) dependency — this centers against
  // `clientWidth/clientHeight` (excludes the scrollbar gutter), which can
  // change from a vertical scrollbar toggling on/off, with no matching
  // `innerWidth/innerHeight` change to re-trigger a `size`-keyed effect.
  // That gap left the phase permanently stale at whatever it computed
  // before the first scrollbar appeared — confirmed live. `clientHeight` on
  // `documentElement` is the *viewport* height, not the content height, so
  // this fires on real viewport changes only and never thrashes.
  //
  // Seeded synchronously from the real document rather than starting at 0,0
  // and being corrected by the effect below: generation routes against
  // `-gridPhase`-shifted barriers but renders `+gridPhase`, so a first pass
  // at a stale zero phase draws every trace offset from the barriers it was
  // routed around — traces sat behind the footer and ran past the bottom of
  // the viewport until something else happened to force a regeneration.
  const [gridPhase, setGridPhase] = React.useState<Point>(measureGridPhase);

  React.useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const { x, y } = measureGridPhase();
      root.style.setProperty("--grid-phase-x", `${x}px`);
      root.style.setProperty("--grid-phase-y", `${y}px`);
      root.style.setProperty(
        "--grid-bold-phase-x",
        `${latticePhase(root.clientWidth, BOLD_GRID)}px`,
      );
      root.style.setProperty(
        "--grid-bold-phase-y",
        `${latticePhase(root.clientHeight, BOLD_GRID)}px`,
      );
      // Traces are generated on the unphased `n * GRID` lattice and shifted
      // into place at render time (see the translated `<g>` below), so the
      // fine phase has to reach the render as state, not just as a CSS var.
      setGridPhase((previous) => (previous.x === x && previous.y === y ? previous : { x, y }));
    };

    apply();
    const observer = new ResizeObserver(() => {
      apply();
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, []);
  const { mode: motionMode, demoteToStatic, idleGlowEligible } = useMotionMode();
  const occluders = useCircuitOccluderRects();

  const staticMode = motionMode === "static";
  const staticModeRef = React.useRef(staticMode);
  // Layout effect, not passive: the crawl/boot layout effects below read this
  // ref, and layout effects run in declaration order within the same commit —
  // a passive effect here would leave them reading the prior commit's value
  // on the frame `staticMode` actually flips (runtime demotion or an OS
  // preference change).
  React.useLayoutEffect(() => {
    staticModeRef.current = staticMode;
  }, [staticMode]);

  const [traceCount, setTraceCount] = React.useState<number | null>(null);

  // Deliberately raw viewport area, not barrier-adjusted free area —
  // occluders register asynchronously (CircuitOccluderProvider measures via
  // rAF-batched ResizeObserver), so computing `desired` from post-occlusion
  // area raced that registration: the very first commit (which bypasses the
  // hysteresis band below, since there is no `current` to compare against
  // yet) could land before any occluder had measured, producing an inflated
  // slot count that a moment later "corrected" downward by more than the
  // band once real occlusion arrived — a real, reproduced-on-production
  // add/remove of a dozen-plus slots at mount, and the same race on every
  // route's occluder set re-registering. Confirmed live: `unimatrix-01.dev`
  // mounted 32 traces, then dropped to 20 within ~1s with no user action.
  // Hard barriers still drive routing/placement (traces route around
  // registered occluders' buffered rects via `generateTraces`'
  // `barriers` argument) — this only decouples slot *count* from occluder
  // timing, matching the stated user preference that page-change
  // reactivity reuse the same fixed set of lines rather than add/remove
  // slots. `CircuitTree.adjacency` stays intentionally unconsumed in
  // production, test-only (see `idle-packets.ts`'s own doc comment on why
  // it builds from live bodies instead).
  React.useEffect(() => {
    if (!debouncedSize) return;

    const area = debouncedSize.width * debouncedSize.height;
    const desired = Math.max(MIN_TRACE_COUNT, Math.round(area / MIN_TRACE_COUNT_AREA_DIVISOR));

    setTraceCount((current) => {
      if (current === null) return desired;
      const band = Math.max(
        TRACE_COUNT_HYSTERESIS_MIN_STEP,
        Math.round(current * TRACE_COUNT_HYSTERESIS_RATIO),
      );
      return Math.abs(desired - current) > band ? desired : current;
    });
  }, [debouncedSize?.width, debouncedSize?.height]);

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
  // Set on `visibilitychange` hide, cleared on show — every rAF-start call
  // site below goes through `ensureLoop()` so none of them can restart the
  // shared loop while the tab is hidden.
  const documentHiddenRef = React.useRef(false);
  const hiddenAtRef = React.useRef<number | null>(null);
  // The watchdog probe below is a second, independent rAF consumer — these
  // let the single `visibilitychange` handler pause/resume it too, the same
  // way it pauses/resumes the shared transition loop.
  const watchdogFrameRef = React.useRef<number | null>(null);
  const watchdogStepRef = React.useRef<((timestamp: number) => void) | null>(null);

  // Session E2 (idle packets) state — all gated behind
  // `motionMode === "full"` via `idleEnabledRef`.
  const idleEnabledRef = React.useRef(false);
  const idleReadyAtRef = React.useRef(0);
  const packetGraphRef = React.useRef<PacketGraph | null>(null);
  const graphDirtyRef = React.useRef(true);
  const packetsRef = React.useRef(new Map<number, Packet>());
  const freeSlotsRef = React.useRef(Array.from({ length: IDLE_PACKET_POOL_SIZE }, (_, i) => i));
  const lastPacketSpawnAtRef = React.useRef(0);
  const packetElRefs = React.useRef(new Map<string, SVGRectElement>());
  // Per-slot walked-path history behind each packet, head-first, trimmed to
  // `TRAIL_LENGTH_PX` of arc length. Because it *is* the traversed polyline,
  // the drawn trail bends around corners for free. Cleared wherever a slot is
  // freed — a reused slot would otherwise splice the retired packet's tail
  // onto the new one's head and draw a streak across the field.
  const packetTrailsRef = React.useRef(new Map<number, Point[]>());
  const trailElRefs = React.useRef(new Map<string, SVGPathElement>());

  const loopShouldRun = React.useCallback(() => {
    return (
      !documentHiddenRef.current && (transitionsRef.current.size > 0 || idleEnabledRef.current)
    );
  }, []);

  // Hides a slot's packet rect and every one of its trail sub-paths, and
  // drops its history. Every path that frees a slot goes through this, so a
  // recycled slot always starts from an empty trail.
  const hidePacketSlot = React.useCallback((slot: number) => {
    const el = packetElRefs.current.get(`p${slot}`);
    if (el) el.style.opacity = "0";

    for (let i = 0; i < TRAIL_SEGMENTS; i += 1) {
      const trailEl = trailElRefs.current.get(`t${slot}-${i}`);
      if (trailEl) trailEl.style.opacity = "0";
    }

    packetTrailsRef.current.delete(slot);
  }, []);

  // Hides every pooled packet rect and returns its slot. Used wherever the
  // geometry packets are walking stops being valid: a trace-count prune, a
  // tab hide/show, and — the frame any crawl starts — `runTick` itself.
  // Retiring rather than trying to salvage in-flight packets is deliberate:
  // the graph is rebuilt from live bodies on the next idle frame anyway.
  const retireAllPackets = React.useCallback(() => {
    graphDirtyRef.current = true;
    packetsRef.current.forEach((_packet, slot) => {
      hidePacketSlot(slot);
    });
    packetsRef.current.clear();
    freeSlotsRef.current = Array.from({ length: IDLE_PACKET_POOL_SIZE }, (_, i) => i);
  }, [hidePacketSlot]);

  // `allowRebuild` gates the graph rebuild on nothing currently crawling —
  // during a transition, `liveBodyRef` holds mid-crawl `sliceWindow`
  // partial bodies, which must never become the packet graph; surviving
  // packets keep walking whatever graph was frozen before the crawl
  // started. `allowSpawn` similarly stops new packets/forks from appearing
  // mid-crawl (existing ones just keep running). `isCellLive`, when
  // supplied, culls any packet whose next (or current) cell just stopped
  // being rendered — see `packetsOffLiveGeometry` — which is what lets a
  // packet disappear exactly when the trace it's on is crawled past,
  // instead of at the moment the crawl starts.
  const advanceIdlePackets = React.useCallback(
    (
      now: number,
      options: {
        isCellLive?: (cell: string) => boolean;
        allowSpawn: boolean;
        allowRebuild: boolean;
      },
    ) => {
      if (graphDirtyRef.current && options.allowRebuild) {
        packetGraphRef.current = buildPacketGraph(liveBodyRef.current);
        graphDirtyRef.current = false;
      }
      const graph = packetGraphRef.current;
      if (!graph || graph.leaves.length === 0) return;

      if (options.isCellLive) {
        const isCellLive = options.isCellLive;
        packetsOffLiveGeometry(packetsRef.current, isCellLive).forEach((slot) => {
          hidePacketSlot(slot);
          packetsRef.current.delete(slot);
          freeSlotsRef.current.push(slot);
        });
      }

      // Snapshot before iterating: the fork branch below inserts into this
      // same map, and `Map.forEach` visits entries added during iteration —
      // so a freshly forked packet would be advanced again in the frame it
      // was created, double-stepping it away from the junction it forked at.
      Array.from(packetsRef.current.entries()).forEach(([slot, packet]) => {
        const result = advancePacket(packet, graph, now);
        const el = packetElRefs.current.get(`p${slot}`);

        if (!result) {
          packetsRef.current.delete(slot);
          freeSlotsRef.current.push(slot);
          hidePacketSlot(slot);
          return;
        }

        // A hop just completed this frame (arrived at a new cell): fork down
        // a second branch if that cell is a real junction and a slot is free
        // — max one fork per junction visit, never queued/preempting on pool
        // exhaustion. Gated on `allowSpawn` same as the leaf-spawn below —
        // forking mid-crawl could land a fresh packet on a cell that's about
        // to vanish, retiring it the very next frame.
        if (
          options.allowSpawn &&
          result.packet.hops === packet.hops + 1 &&
          graph.junctions.has(result.packet.at)
        ) {
          const neighborSet = graph.neighbors.get(result.packet.at);
          const forkCandidates = neighborSet
            ? Array.from(neighborSet).filter(
                (n) => n !== result.packet.cameFrom && n !== result.packet.next,
              )
            : [];
          const forkTarget = forkCandidates[Math.floor(Math.random() * forkCandidates.length)];

          if (
            forkTarget &&
            freeSlotsRef.current.length > 0 &&
            packetsRef.current.size < IDLE_PACKET_POOL_SIZE
          ) {
            const forkSlot = freeSlotsRef.current.pop() as number;
            packetsRef.current.set(forkSlot, {
              slot: forkSlot,
              at: result.packet.at,
              cameFrom: result.packet.cameFrom,
              next: forkTarget,
              stepStart: now,
              hops: result.packet.hops,
            });
          }
        }

        packetsRef.current.set(slot, result.packet);
        if (el) {
          el.setAttribute("x", String(result.point.x - 3));
          el.setAttribute("y", String(result.point.y - 3));
          el.style.opacity = "1";
        }

        // Trail: extend this slot's history with the frame's position, then
        // repaint its sub-paths head-first. `trailSlices` hands back at most
        // `TRAIL_SEGMENTS` entries, and a slice too short to draw comes back
        // empty — either way every unused element is explicitly hidden, so a
        // shrinking trail never leaves a stale sub-path on screen.
        const trail = pushTrailPoint(packetTrailsRef.current.get(slot) ?? [], result.point);
        packetTrailsRef.current.set(slot, trail);

        const slices = trailSlices(trail);
        for (let i = 0; i < TRAIL_SEGMENTS; i += 1) {
          const trailEl = trailElRefs.current.get(`t${slot}-${i}`);
          if (!trailEl) continue;

          const slice = slices[i];
          if (!slice || slice.length < 2) {
            trailEl.style.opacity = "0";
            continue;
          }

          trailEl.setAttribute("d", pathData(slice));
          trailEl.style.opacity = String(TRAIL_HEAD_OPACITY * (1 - i / TRAIL_SEGMENTS));
        }
      });

      if (
        options.allowSpawn &&
        packetsRef.current.size < IDLE_PACKET_MAX_CONCURRENT &&
        freeSlotsRef.current.length > 0 &&
        now - lastPacketSpawnAtRef.current > PACKET_SPAWN_INTERVAL_MS + Math.random() * 400
      ) {
        const leaf = graph.leaves[Math.floor(Math.random() * graph.leaves.length)];
        if (leaf) {
          const slot = freeSlotsRef.current.pop() as number;
          packetsRef.current.set(slot, {
            slot,
            at: leaf,
            cameFrom: null,
            next: null,
            stepStart: now,
            hops: 0,
          });
          lastPacketSpawnAtRef.current = now;
        }
      }
    },
    [hidePacketSlot],
  );

  // The shared loop reschedules itself through this indirection rather than
  // through `runTick` directly. `runTick` closes over per-render values
  // (`traceIds`, and the per-frame via/tip/intersection passes keyed off it),
  // and a
  // self-rescheduling `requestAnimationFrame(runTick)` pins whichever closure
  // instance started the loop for as long as the loop stays alive — `ensureLoop`
  // only ever installs a fresh one when `rafActiveRef.current === null`. That was
  // harmless while the loop always drained to `null` between crawls, but `full`
  // mode's idle producers keep it running permanently *and* start it from the
  // idle layout effect on the first commit, where `traceCount` is still `null`
  // (so `traceIds` is `[]`) — pinning a closure that iterates zero traces for
  // the rest of the component's life. Same `*Ref` trampoline idiom as
  // `watchdogStepRef` above.
  const runTickRef = React.useRef<() => void>(() => {});
  const scheduleTick = React.useCallback(() => {
    runTickRef.current();
  }, []);

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

  // Idle-packet pool: a fixed `IDLE_PACKET_POOL_SIZE` slots (a perf ceiling,
  // not scaled by `traceCount` — density comes from spawn rate), mirroring
  // the intersection pool's direct-ref/opacity-toggle pattern exactly. Only
  // ever written to by `advanceIdlePackets`, itself only invoked while
  // `idleEnabledRef.current` (`full` mode) — in every other mode these stay
  // at their initial `opacity: 0` forever.
  const packetSlotIds = React.useMemo(
    () => Array.from({ length: IDLE_PACKET_POOL_SIZE }, (_, i) => `p${i}`),
    [],
  );

  const packetRefCallback = React.useCallback((key: string) => {
    return (el: SVGRectElement | null) => {
      if (el) packetElRefs.current.set(key, el);
      else packetElRefs.current.delete(key);
    };
  }, []);

  // One pooled path per (slot, trail slice), same fixed-pool/direct-ref
  // pattern as the packet rects themselves — never created per frame.
  const trailSlotIds = React.useMemo(
    () =>
      Array.from({ length: IDLE_PACKET_POOL_SIZE }, (_, slot) =>
        Array.from({ length: TRAIL_SEGMENTS }, (_, i) => ({ key: `t${slot}-${i}`, index: i })),
      ).flat(),
    [],
  );

  const trailRefCallback = React.useCallback((key: string) => {
    return (el: SVGPathElement | null) => {
      if (el) trailElRefs.current.set(key, el);
      else trailElRefs.current.delete(key);
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

  // Hard-barrier field derived from the structurally-committed occluder set
  // (`useCircuitOccluderRects()`). Mid-scroll this context lags the real
  // geometry (the scroll-delta path only commits once scrolling settles —
  // see `circuit-occluder.tsx`'s provider doc comment), so
  // `handleOccluderDelta` below builds its own barrier field from the
  // scroll-fresh `liveOccluders` it receives instead of reading this memo.
  //
  // Occluders are shifted by `-gridPhase` on the way in, the exact inverse of
  // the `+gridPhase` translate the rendered `<g>` applies: generation runs on
  // the unphased `n * GRID` lattice it has always used (nothing in
  // `trace-generation`/`route-engine`/`scroll-retarget` needs to learn about
  // phase), and a trace that clears a shifted barrier in that space clears
  // the real DOM rect once translated back. Exact, not approximate — the two
  // shifts cancel.
  const barriers: BarrierField = React.useMemo(
    () =>
      buildBarrierField(occluders.map((rect) => translateRect(rect, -gridPhase.x, -gridPhase.y))),
    [occluders, gridPhase.x, gridPhase.y],
  );

  // The viewport box as generation sees it: shrunk by the phase the rendered
  // `<g>` then adds back. Generation keeps everything within `GRID` of these
  // bounds, so without the shrink the `+gridPhase` translate pushes the
  // right/bottom-most traces past the real viewport edge, where the SVG
  // clips them mid-run — they read as running off the page.
  // Keyed on primitives, never the `debouncedSize`/`gridPhase` objects:
  // `targetTraces` below depends on this, and a new object carrying identical
  // numbers would regenerate the whole field and start a pointless crawl —
  // exactly what that memo's own primitive deps exist to prevent.
  const latticeSize = React.useMemo(
    () =>
      debouncedSize
        ? { width: debouncedSize.width - gridPhase.x, height: debouncedSize.height - gridPhase.y }
        : null,
    [debouncedSize?.width, debouncedSize?.height, gridPhase.x, gridPhase.y],
  );

  const targetTraces = React.useMemo(() => {
    if (!latticeSize || !debouncedSize || traceCount === null) return null;

    // Occluder rects feed barrier geometry only, never the seed — a panel
    // resize must not re-seed the whole field and blow away an in-flight
    // crawl. Seeded off the unshrunk viewport so a phase change alone (which
    // only ever accompanies a resize) isn't an extra source of re-seeding.
    const seed = hashString(`${routeKey}:${debouncedSize.width}x${debouncedSize.height}`);
    return generateTraces(latticeSize.width, latticeSize.height, seed, barriers, traceCount);
  }, [routeKey, debouncedSize?.width, debouncedSize?.height, latticeSize, traceCount, barriers]);

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
    const now = performance.now();

    // Idle fast path: nothing is crawling, so none of the cross-trace state
    // below (cellAxisMap, intersections, tip colinearity, via opacity) has
    // changed since it was last committed — recomputing it every frame
    // forever on settled geometry is exactly the per-frame cost E1's loop
    // gating was built to avoid. Only idle producers run here.
    if (transitionsRef.current.size === 0) {
      if (idleEnabledRef.current && !staticModeRef.current && now >= idleReadyAtRef.current) {
        advanceIdlePackets(now, { allowSpawn: true, allowRebuild: true });
      }
      rafActiveRef.current = loopShouldRun() ? requestAnimationFrame(scheduleTick) : null;
      return;
    }

    const bodies = liveBodyRef.current;
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
        if (tail && tailNext)
          tipInfo.push({ id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
        if (head && headPrev)
          tipInfo.push({ id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });
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
      if (tail && tailNext)
        tipInfo.push({ id, end: "tail", point: tail, axis: tail.y === tailNext.y ? "h" : "v" });
      if (head && headPrev)
        tipInfo.push({ id, end: "head", point: head, axis: headPrev.y === head.y ? "h" : "v" });

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

    // A crawl is in flight, but existing packets keep running on their
    // current route rather than being retired wholesale — they only
    // disappear once the trace they're on is crawled past (see
    // `packetsOffLiveGeometry`, driven by `cellAxisMap` above: exactly the
    // cells currently drawn on screen this frame). No rebuild, no spawning,
    // no forking while a crawl is in flight — surviving packets walk the
    // graph frozen from before the crawl started.
    if (idleEnabledRef.current && !staticModeRef.current && now >= idleReadyAtRef.current) {
      advanceIdlePackets(now, {
        isCellLive: (cell) => cellAxisMap.has(cell),
        allowSpawn: false,
        allowRebuild: false,
      });
    }

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
      const carried = Array.from(viaItemIndexRef.current.values()).filter(
        (item) => !finishedIds.has(item.traceId),
      );
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

      // The last transition just settled this frame — mark the packet graph
      // dirty so the next idle frame rebuilds it against the now-fully-
      // settled geometry, culling any survivor left standing on a cell that
      // no longer exists post-settle (the frozen pre-crawl graph it was
      // walking may not exactly match the new one).
      if (transitionsRef.current.size === 0) graphDirtyRef.current = true;
    }

    rafActiveRef.current = loopShouldRun() ? requestAnimationFrame(scheduleTick) : null;
  }, [
    advanceIdlePackets,
    applyIntersections,
    loopShouldRun,
    scheduleTick,
    setTipPosition,
    setViaItems,
    traceIds,
  ]);

  // Layout effect, not passive: a passive effect would leave the frame
  // scheduled by this same commit's crawl/idle layout effects running the
  // *previous* commit's `runTick` — exactly the staleness this trampoline
  // exists to remove.
  React.useLayoutEffect(() => {
    runTickRef.current = runTick;
  }, [runTick]);

  // Every other rAF-start call site below goes through this instead of a
  // direct `requestAnimationFrame(runTick)` — centralizes the
  // `documentHiddenRef` guard so a delta/crawl effect firing while the tab
  // is hidden can never restart the shared loop out from under the
  // `visibilitychange` handler.
  // Schedules the trampoline, not `runTick` itself, so this callback stays
  // referentially stable across renders — every effect that depends on it
  // (crawl/boot, idle enable, retarget, visibilitychange) would otherwise
  // re-run on every commit just because `runTick`'s identity changed.
  const ensureLoop = React.useCallback(() => {
    if (rafActiveRef.current === null && loopShouldRun()) {
      rafActiveRef.current = requestAnimationFrame(scheduleTick);
    }
  }, [loopShouldRun, scheduleTick]);

  // `full` mode's idle producers need the shared loop running permanently,
  // not just while a transition is in flight — nothing else starts it with
  // an empty `transitionsRef`, so this effect does, the moment idle becomes
  // eligible (mount already in `full`, or a runtime mode change). Calling
  // `ensureLoop()` unconditionally whenever enabled (not only on the
  // false→true edge) is defense in depth on top of the real fix (see the
  // unmount-cleanup effect below, which now resets `rafActiveRef`/
  // `watchdogFrameRef` to `null` after cancelling, not just cancels): an
  // edge-only guard here relies on nothing else ever leaving `rafActiveRef`
  // non-null-but-dead, which held until that reset was added. `ensureLoop()`
  // is idempotent (checks `rafActiveRef.current === null` before
  // scheduling), so calling it every time this effect runs while enabled
  // costs nothing.
  React.useLayoutEffect(() => {
    const wasEnabled = idleEnabledRef.current;
    idleEnabledRef.current = motionMode === "full";
    if (!wasEnabled && idleEnabledRef.current) {
      idleReadyAtRef.current = performance.now() + IDLE_READY_DELAY_MS;
    }
    if (wasEnabled && !idleEnabledRef.current) {
      // Runtime demotion away from `full` (watchdog, or a live OS preference
      // change) stops `advanceIdlePackets` from ever running again — without
      // this, packets on screen at the flip stay frozen at their last
      // position forever.
      retireAllPackets();
    }
    if (idleEnabledRef.current) {
      ensureLoop();
    }
  }, [motionMode, ensureLoop, retireAllPackets]);

  // Shared by every "skip the crawl, write final state directly" path —
  // static mode's transitions-effect branch, static mode's retarget branch,
  // and the frame-budget watchdog's demotion (below). Removes each item's id
  // from `transitionsRef` (a no-op if it was never in flight — the retarget
  // path never adds one before calling this), stops the loop if nothing's
  // left transitioning, then writes the same final path/via/tip state a
  // completed crawl would have settled into.
  const snapTransitionsToTarget = React.useCallback(
    (items: { id: string; toBody: RoutePoint[] }[]) => {
      if (items.length === 0) return;

      items.forEach((item) => {
        transitionsRef.current.delete(item.id);
        liveBodyRef.current.set(item.id, item.toBody);
      });

      if (rafActiveRef.current !== null && transitionsRef.current.size === 0) {
        cancelAnimationFrame(rafActiveRef.current);
        rafActiveRef.current = null;
      }

      // Every live body, not just the snapped subset — intersections and tip
      // colinearity are cross-trace properties, and `applyIntersections`
      // rewrites its whole pool from this map's output each call, so a
      // subset-only map would hide every untouched trace's crossings.
      const cellAxisMap = buildCellAxisMap(
        Array.from(liveBodyRef.current.entries()).map(([id, points]) => ({ id, points })),
      );
      const settled: ViaItem[] = [];

      items.forEach(({ id, toBody }) => {
        const el = pathElRefs.current.get(id);
        if (el) el.setAttribute("d", pathData(toBody));

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

        const first = toBody[0];
        const second = toBody[1];
        const last = toBody[toBody.length - 1];
        const beforeLast = toBody[toBody.length - 2];
        if (first && second) {
          const axis: "h" | "v" = first.y === second.y ? "h" : "v";
          setTipPosition(id, "tail", first, !isColinearWithOther(cellAxisMap, id, first, axis));
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(id, "head", last, !isColinearWithOther(cellAxisMap, id, last, axis));
        }
      });

      const snappedIds = new Set(items.map((item) => item.id));
      const untouched = Array.from(viaItemIndexRef.current.values()).filter(
        (item) => !snappedIds.has(item.traceId),
      );
      setViaItems([...untouched, ...settled]);
      applyIntersections(findIntersections(cellAxisMap));
    },
    [applyIntersections, setTipPosition, setViaItems],
  );

  // Owns the crawl/snap mechanics for an in-place tip retarget. Each entry's
  // `previousTracesRef`/`lastRetargetAtRef` bookkeeping already happened at
  // the caller (`handleOccluderDelta`, the scroll-delta producer).
  const applyRetargets = React.useCallback(
    (entries: RetargetEntry[], now: number) => {
      if (entries.length === 0) return;
      graphDirtyRef.current = true;

      if (staticModeRef.current) {
        snapTransitionsToTarget(entries.map((r) => ({ id: r.id, toBody: r.toBody })));
        return;
      }

      const initialCellAxisMap = buildCellAxisMap(
        entries.map((r) => ({ id: r.id, points: r.route.slice(0, r.lenO) })),
      );
      const crawlItems: ViaItem[] = [];

      entries.forEach((r) => {
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
          setTipPosition(
            r.id,
            "tail",
            start,
            !isColinearWithOther(initialCellAxisMap, r.id, start, axis),
          );
        }
        if (head && beforeHead) {
          const axis: "h" | "v" = beforeHead.y === head.y ? "h" : "v";
          setTipPosition(
            r.id,
            "head",
            head,
            !isColinearWithOther(initialCellAxisMap, r.id, head, axis),
          );
        }
      });

      const retargetedIds = new Set(entries.map((r) => r.id));
      const untouched = Array.from(viaItemIndexRef.current.values()).filter(
        (item) => !retargetedIds.has(item.traceId),
      );
      setViaItems([...untouched, ...crawlItems]);

      entries.forEach((r) => {
        transitionsRef.current.set(r.id, {
          route: r.route,
          lenO: r.lenO,
          lenN: r.lenN,
          toBody: r.toBody,
          startTime: now,
          duration: travelDuration(r.route.length - r.lenO),
        });
      });

      ensureLoop();
    },
    [ensureLoop, setTipPosition, setViaItems, snapTransitionsToTarget],
  );

  // Used only by the frame-budget watchdog: snaps whatever is currently
  // in-flight (of any origin — boot crawl, occlusion regeneration, scroll
  // retarget) straight to its target, same as a runtime static-mode demotion
  // should look like. Reads `transitionsRef` fresh rather than closing over
  // a stale list, since the watchdog can fire on any frame.
  const snapAllInFlightTransitions = React.useCallback(() => {
    const items = Array.from(transitionsRef.current.entries()).map(([id, transition]) => ({
      id,
      toBody: transition.toBody,
    }));
    snapTransitionsToTarget(items);
  }, [snapTransitionsToTarget]);

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
    lastRetargetAtRef.current.forEach((_at, id) => {
      if (!validIds.has(id)) lastRetargetAtRef.current.delete(id);
    });

    // A trace-count change invalidates the packet graph (it's built from
    // live bodies) and any packet currently walking a pruned trace's cells —
    // simplest correct response is to retire every packet and let idle rebuild
    // fresh next idle frame, rather than trying to salvage in-flight ones.
    retireAllPackets();

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

    const stale = Array.from(viaItemIndexRef.current.values()).some(
      (item) => !validIds.has(item.traceId),
    );
    if (stale) {
      setViaItems(
        Array.from(viaItemIndexRef.current.values()).filter((item) => validIds.has(item.traceId)),
      );
    }
  }, [retireAllPackets, traceIds, setViaItems]);

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
    // Idle packets walk live geometry -- any real regeneration invalidates
    // the graph built from it.
    if (newTraces.length > 0 || existingTraces.length > 0) graphDirtyRef.current = true;

    // --- Boot pass: brand-new slots (first mount, or growth from a
    // reactive trace-count increase) draw in with the staggered stroke
    // animation, ordered by their depth in the generated spanning tree.
    if (newTraces.length > 0) {
      const newBodies = new Map(
        newTraces.map((trace) => [trace.id, recomputeCorners(densify(trace.points))]),
      );
      newBodies.forEach((body, id) => liveBodies.set(id, body));

      const cellAxisMap = buildCellAxisMap([
        ...newTraces.map((trace) => ({
          id: trace.id,
          points: newBodies.get(trace.id) as RoutePoint[],
        })),
        ...existingTraces.map((trace) => ({
          id: trace.id,
          points: priorBodies.get(trace.id) as RoutePoint[],
        })),
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
            boot: !staticModeRef.current,
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
          setTipPosition(
            trace.id,
            "tail",
            first,
            !isColinearWithOther(cellAxisMap, trace.id, first, axis),
          );
        }
        if (last && beforeLast) {
          const axis: "h" | "v" = beforeLast.y === last.y ? "h" : "v";
          setTipPosition(
            trace.id,
            "head",
            last,
            !isColinearWithOther(cellAxisMap, trace.id, last, axis),
          );
        }

        const el = pathElRefs.current.get(trace.id);
        if (!el) return;

        el.setAttribute("d", pathData(body));

        if (staticModeRef.current) {
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
      const route = buildRoute(from, to, barriers);

      return { id: trace.id, route, lenO: from.length, lenN: to.length, toBody: to };
    });

    if (staticModeRef.current) {
      snapTransitionsToTarget(
        transitions.map((transition) => ({ id: transition.id, toBody: transition.toBody })),
      );
      return;
    }

    // Packets already running keep running through this crawl — see
    // `runTick`'s own `advanceIdlePackets(..., { isCellLive, allowSpawn:
    // false, allowRebuild: false })` call, which culls them individually as
    // the trace each one is on gets crawled past, rather than retiring the
    // whole pool the instant a crawl is seeded.

    const initialCellAxisMap = buildCellAxisMap(
      transitions.map((transition) => ({
        id: transition.id,
        points: transition.route.slice(0, transition.lenO),
      })),
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

    const crawlingIds = new Set(existingTraces.map((trace) => trace.id));
    const untouched = Array.from(viaItemIndexRef.current.values()).filter(
      (item) => !crawlingIds.has(item.traceId),
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

    ensureLoop();
    // Only the target trace identity should retrigger this effect — the
    // refs and callbacks it closes over are stable across renders.
  }, [
    applyIntersections,
    barriers,
    ensureLoop,
    setTipPosition,
    setViaItems,
    snapTransitionsToTarget,
    targetTraces,
  ]);

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
      if (!debouncedSize || !latticeSize) return;
      const now = performance.now();

      const tips: { id: string; point: Point }[] = [];
      traceIds.forEach((id) => {
        const body = liveBodyRef.current.get(id);
        const last = body?.[body.length - 1];
        if (last) tips.push({ id, point: last });
      });

      // Built from `liveOccluders` (the scroll-fresh full set this delta
      // callback receives), not the `barriers` memo above — that memo only
      // updates on a structural commit, which the scroll path deliberately
      // never triggers (see `circuit-occluder.tsx`'s provider doc comment).
      // Built before `candidateIds` below: the barrier-membership filter
      // needs it ahead of the `slice`, not after.
      // Shifted by `-gridPhase` for the same reason the `barriers` memo above
      // is: `tips` are in the unphased generation lattice, so every rect
      // compared against them — barriers *and* `dirtyRects` — has to be
      // pulled into that same space first.
      const liveBarriers = buildBarrierField(
        liveOccluders.map((rect) => translateRect(rect, -gridPhase.x, -gridPhase.y)),
      );
      const shiftedDirtyRects = dirtyRects.map((rect) =>
        translateRect(rect, -gridPhase.x, -gridPhase.y),
      );
      const tipById = new Map(tips.map((tip) => [tip.id, tip.point]));

      const candidateIds = findAffectedTraceIds(tips, shiftedDirtyRects, OCCLUDER_AFFECT_MARGIN_PX)
        // A trace already mid-crawl has a `liveBodyRef` entry that's a
        // `sliceWindow(...)` partial window (old body + connector + new
        // body) — retargeting off that would truncate it and abandon its
        // real target, so never interrupt one.
        .filter((id) => !transitionsRef.current.has(id))
        .filter((id) => now - (lastRetargetAtRef.current.get(id) ?? 0) >= RETARGET_COOLDOWN_MS)
        // `retargetTip` only ever fires as a genuine barrier escape (never
        // an ambient nudge — see its own doc comment), so a tip that isn't
        // actually swallowed by a barrier can never produce a retarget.
        // This must run *before* the slice below: `findAffectedTraceIds`'s
        // 160px margin can easily surface more than
        // `MAX_SCROLL_RETARGETS_PER_EVENT` nearby tips, and the one that's
        // actually blocked isn't guaranteed to be among the first few.
        .filter((id) => {
          const tip = tipById.get(id);
          return tip ? isCellBlocked(liveBarriers, tip) : false;
        })
        .slice(0, MAX_SCROLL_RETARGETS_PER_EVENT);

      if (candidateIds.length === 0) return;

      const retargets: RetargetEntry[] = [];
      // Cells claimed by a candidate already resolved earlier in this same
      // delta event — `liveBodyRef` for that candidate isn't mutated until
      // later (the reduced-motion branch below, or `runTick` draining
      // `transitionsRef` on a future frame), so without this a second
      // candidate in the same event can't see the first one's new tip and
      // could pick the same cell.
      const pendingCells = new Set<string>();

      // Loop-invariant: `transitionsRef` is not written until `applyRetargets`
      // below, well after this loop, so rebuilding this per candidate was
      // pure repeated work.
      const inFlightToBodies = new Map(
        Array.from(transitionsRef.current.entries()).map(([tid, t]) => [tid, t.toBody] as const),
      );

      candidateIds.forEach((id) => {
        const liveBody = liveBodyRef.current.get(id);
        const trace = previousTracesRef.current.get(id);
        if (!liveBody || !trace) return;

        const occupied = buildOccupiedFootprint(liveBodyRef.current, id, inFlightToBodies);
        pendingCells.forEach((cell) => occupied.add(cell));
        const newTip = retargetTip(
          liveBody,
          occupied,
          liveBarriers,
          latticeSize.width,
          latticeSize.height,
        );
        if (!newTip) return;
        pendingCells.add(cellKey(newTip));

        const sparsePoints = [...trace.points.slice(0, -1), newTip];
        const toBody = recomputeCorners(
          densify(sparsePoints).map((point) => ({ ...point, x: snap(point.x), y: snap(point.y) })),
        );
        const route = buildRoute(liveBody, toBody, liveBarriers);

        // The sparse point list, not the densified body — writing the dense
        // body here would make the next legitimate regeneration's
        // `pointsEqual(previous.points, trace.points)` check permanently
        // miscompare dense-vs-sparse for this trace, defeating the
        // skip-if-unchanged optimization for it forever.
        previousTracesRef.current.set(id, {
          ...trace,
          points: sparsePoints,
          length: polylineLength(sparsePoints),
        });
        lastRetargetAtRef.current.set(id, now);
        retargets.push({ id, route, lenO: liveBody.length, lenN: toBody.length, toBody });
      });

      applyRetargets(retargets, now);
    },
    [applyRetargets, debouncedSize, gridPhase, latticeSize, traceIds],
  );

  useCircuitOccluderDelta(handleOccluderDelta);

  // Browsers already starve rAF in hidden tabs; without this, an in-flight
  // transition's `startTime` (a wall-clock timestamp) means the first frame
  // after returning sees `t >= 1` and every crawling trace teleports to its
  // target instead of resuming mid-crawl. Rebasing `startTime` by the hidden
  // duration on show is what makes a route change followed by a tab switch
  // resume smoothly instead. Idle-flight state (Session E2) is not rebased
  // here — that session's producers are expected to clear and reseed on
  // show rather than carry elapsed time across a hide.
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        documentHiddenRef.current = true;
        hiddenAtRef.current = performance.now();
        if (rafActiveRef.current !== null) {
          cancelAnimationFrame(rafActiveRef.current);
          rafActiveRef.current = null;
        }
        // The watchdog is a second, independent rAF consumer (below) — pause
        // it too rather than letting it keep sampling (misleadingly huge or
        // throttled) frame deltas from a hidden tab.
        if (watchdogFrameRef.current !== null) {
          cancelAnimationFrame(watchdogFrameRef.current);
          watchdogFrameRef.current = null;
        }
        return;
      }

      const hiddenSince = hiddenAtRef.current;
      hiddenAtRef.current = null;
      documentHiddenRef.current = false;

      if (hiddenSince !== null) {
        const hiddenDuration = performance.now() - hiddenSince;
        transitionsRef.current.forEach((transition) => {
          transition.startTime += hiddenDuration;
        });

        // Idle state, unlike transitions above, is not rebased -- retire
        // every packet and reset the idle timers instead, so the tab doesn't
        // come back to a burst of packets/shifts covering the entire hidden
        // duration in one frame.
        retireAllPackets();
        const now = performance.now();
        lastPacketSpawnAtRef.current = now;
      }

      ensureLoop();

      // Resume the watchdog only if it hasn't already reached a verdict
      // (its `step` clears this ref to `null` once resolved) and isn't
      // already scheduled.
      if (watchdogStepRef.current && watchdogFrameRef.current === null) {
        watchdogFrameRef.current = requestAnimationFrame(watchdogStepRef.current);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [ensureLoop, retireAllPackets]);

  // Standalone, self-cancelling boot-time sampling loop — deliberately not
  // routed through `runTick`/`ensureLoop`. Boot itself never populates
  // `transitionsRef` (it's a pure CSS stagger, not a JS crawl), so a probe
  // fed from the shared loop would silently collect zero samples in
  // `transitions-only` mode and never reach a verdict. Skipped entirely when
  // the mount-time mode is already `static` — nothing to measure, no rAF to
  // watch, no demotion possible below the floor. Also stops itself if a
  // *later* OS-level preference change (`staticModeRef` is kept current by
  // the layout effect above) flips the live mode to `static` mid-sampling —
  // otherwise this independent rAF consumer would keep sampling forever
  // despite static mode's "never schedules a frame" invariant. Paused/
  // resumed by the `visibilitychange` handler above via
  // `watchdogFrameRef`/`watchdogStepRef` — a large gap on resume reads as a
  // single discarded outlier delta (see `frame-budget.ts`), not a dropped
  // frame, so a hide/show cycle mid-sampling can't wrongly trip the verdict.
  React.useEffect(() => {
    if (staticModeRef.current) return undefined;

    const probe = createFrameBudgetProbe();

    const step = (timestamp: number) => {
      if (staticModeRef.current) {
        watchdogFrameRef.current = null;
        watchdogStepRef.current = null;
        return;
      }

      const verdict = probe.record(timestamp);
      if (verdict === "pending") {
        watchdogFrameRef.current = requestAnimationFrame(step);
        return;
      }

      watchdogFrameRef.current = null;
      watchdogStepRef.current = null;
      if (verdict === "over") {
        demoteToStatic();
        snapAllInFlightTransitions();
      }
    };

    watchdogStepRef.current = step;
    if (!documentHiddenRef.current) {
      watchdogFrameRef.current = requestAnimationFrame(step);
    }

    return () => {
      watchdogStepRef.current = null;
      if (watchdogFrameRef.current !== null) {
        cancelAnimationFrame(watchdogFrameRef.current);
        watchdogFrameRef.current = null;
      }
    };
  }, [demoteToStatic, snapAllInFlightTransitions]);

  React.useEffect(
    () => () => {
      // Reset both refs to `null` after cancelling, not just cancel — a
      // dead (already-cancelled) id left sitting in `rafActiveRef.current`
      // reads as "a frame is still pending" to every future `ensureLoop()`
      // call (`rafActiveRef.current === null` is its only signal to
      // reschedule), permanently wedging the shared loop. This was a
      // pre-existing bug that predates Session E2 -- confirmed live: React
      // 18 StrictMode's simulated mount->unmount->remount (all three
      // app-shells mount under it) runs this exact cleanup on the very
      // first mount, cancelling the frame the first pass's `ensureLoop()`
      // scheduled; without resetting the ref here, no crawl (route change,
      // occlusion regen, scroll/idle retarget) ever animates again for the
      // rest of the component's lifetime -- it silently "generates once and
      // stays that way," which is exactly how it was reported live.
      if (rafActiveRef.current !== null) {
        cancelAnimationFrame(rafActiveRef.current);
        rafActiveRef.current = null;
      }
      if (watchdogFrameRef.current !== null) {
        cancelAnimationFrame(watchdogFrameRef.current);
        watchdogFrameRef.current = null;
      }
    },
    [],
  );

  // Installs `window.__circuitField.debug(...)` once per app (idempotent
  // across every `CircuitField` mount) — the only way to toggle the barrier
  // debug overlay below. Never a UI control; see `circuit-debug.ts`.
  React.useEffect(() => {
    installCircuitDebugConsoleApi();
  }, []);

  if (!size) {
    return null;
  }

  return (
    <>
      <svg
        aria-hidden="true"
        className={
          staticMode
            ? `circuit-field circuit-field-static${idleGlowEligible ? " circuit-field-idle-glow" : ""}`
            : "circuit-field"
        }
        height={size.height}
        style={{ position: "fixed", inset: 0, zIndex: -1, pointerEvents: "none" }}
        width={size.width}
      >
        {/* The one place the lattice phase is applied to rendered output.
            Everything inside is generated on the unphased `n * GRID` lattice
            against `-gridPhase`-shifted barriers, so this translate is what
            puts traces back in real viewport coordinates — aligned with the
            equally-phased background grid, and still clear of the real
            occluder rects the sibling debug overlay draws unshifted. */}
        <g transform={`translate(${gridPhase.x} ${gridPhase.y})`}>
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
          <g
            className="circuit-field-glow"
            fill="color-mix(in oklab, var(--primary) 60%, var(--background))"
          >
            {viaItems.map((item) => (
              <rect
                className={item.boot ? "circuit-field-via" : undefined}
                height={6}
                key={item.key}
                ref={viaRefCallback(item.key)}
                style={
                  item.boot
                    ? { animationDelay: `${item.delay}ms` }
                    : { opacity: item.initiallyVisible ? 1 : 0 }
                }
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
          {/* Tapering glow trails, drawn under the packets so a packet always
              sits on top of its own tail. Each slice gets a fixed width from
              its index (widest at the packet, narrowing toward the tail); `d`
              and opacity are written per frame by `advanceIdlePackets`. */}
          <g
            className="circuit-field-glow"
            fill="none"
            stroke="var(--primary)"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {trailSlotIds.map(({ key, index }) => (
              <path
                key={key}
                ref={trailRefCallback(key)}
                strokeWidth={TRAIL_HEAD_WIDTH * (1 - index / (TRAIL_SEGMENTS + 1))}
                style={{ opacity: 0 }}
              />
            ))}
          </g>
          <g className="circuit-field-glow" fill="var(--primary)">
            {packetSlotIds.map((key) => (
              <rect
                className="circuit-field-packet"
                height={6}
                key={key}
                ref={packetRefCallback(key)}
                style={{ opacity: 0 }}
                width={6}
                x={-3}
                y={-3}
              />
            ))}
          </g>
        </g>
      </svg>
      <CircuitDebugOverlay gridPhase={gridPhase} occluders={occluders} />
    </>
  );
}
