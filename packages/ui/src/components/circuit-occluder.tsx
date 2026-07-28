import * as React from "react";

import { GRID } from "./grid-math.js";
import {
  CIRCUIT_FIELD_MARKER,
  CIRCUIT_OVERLAY_MARKER,
  type DiscoveredSurface,
  scanOccluders,
} from "./occluder-scan.js";
import { type Occluder, type Rect, clampRectToViewport } from "./occlusion.js";

export type RegistrantOptions = {
  /**
   * Caps how much of the registrant's real height counts as occluder. Most
   * registrants (cards, panels, headers, footers) are already self-bounded
   * to their own real height and never need this. It exists for a content
   * panel taller than a viewport (e.g. a long markdown article) — an
   * uncapped rect like that would barricade the entire viewport for most of
   * the scroll range as one hard barrier regardless of depth, leaving
   * nothing but the panel's own edges for scroll-driven retargeting to
   * react to. Capping the registered height
   * keeps the occluder's top edge tracking the real DOM (still moves with
   * scroll) while letting its bottom edge open up once you've scrolled past
   * the cap — a deliberate, documented departure from "occluder rect ==
   * literal DOM bounds" for tall panels.
   */
  maxHeightPx?: number;
};

type Registrant = {
  ref: React.RefObject<Element | null>;
  options: RegistrantOptions;
};

/**
 * Manual registrants are keyed by a per-hook-instance `symbol`; automatically
 * discovered surfaces by a string derived from their walk position. One map
 * holds both, so `measurementsEqual`/`diffMeasurements` need no per-source
 * branch.
 */
type OccluderId = symbol | string;

type OccluderRegistry = {
  register: (id: symbol, ref: React.RefObject<Element | null>, options?: RegistrantOptions) => void;
  unregister: (id: symbol) => void;
};

type DeltaListener = (dirtyRects: Rect[], liveOccluders: Occluder[]) => void;
type DeltaSubscribe = (listener: DeltaListener) => () => void;

// A registrant only counts as "changed" for the scroll-delta path once an
// edge has moved more than one grid cell since it was last known — ties the
// threshold to the same lattice resolution traces snap to, so sub-cell
// measurement drift can't possibly move any lattice point across a
// materially different occlusion-weight zone.
const OCCLUDER_SCROLL_DELTA_PX = GRID;

// How long scrolling must be quiet before the provider forces a structural
// `RectsContext` commit of the settled rects. The scroll path's own
// `handleOccluderDelta`/`retargetTip` nudge mechanism is bounded (a fixed
// attempt count, a small search radius) and exists only to keep a crawling
// trace visually escaping a moving occluder mid-scroll — it is not
// guaranteed to fully clear every tip, and a fast or large scroll gesture
// can outrun it, leaving a trace stranded inside an occluder's final
// settled bounds (confirmed live on a tall article panel: scrolling to the
// bottom and back left 11 path points inside the panel). A settle-triggered
// structural commit is the correctness backstop: once scrolling actually
// stops, `barriers`/`generateTraces` recompute against the real final
// geometry, guaranteeing zero occluder violations regardless of how the
// scroll gesture itself was handled.
const SCROLL_SETTLE_MS = 200;

// Suggested `maxHeightPx` for a content panel taller than a viewport (e.g. a
// long markdown article) — generous vs typical viewport heights; needs a
// real-browser visual pass to tune further.
export const TALL_OCCLUDER_MAX_HEIGHT_PX = 900;

// A registrant narrower or shorter than this on either side never registers
// as a hard-barrier occluder. Hard barriers snap outward to whole lattice
// cells (see `occlusion.ts`'s `buildBarrierField`), so even a small
// registrant blocks a multi-cell span — a stray badge/button-sized element
// would otherwise carve a hole in the trace field several times its own
// size. One grid cell, not two: a real full-width header/footer bar is
// routinely 60-80px tall (well under two cells) while still being exactly
// the kind of surface that should occlude — confirmed live, where an
// earlier two-cell floor silently dropped both this site's header (76px)
// and footer (66px) from registering at all. A single grid cell still
// excludes badges/buttons/titles (routinely under 40px on their short
// side) while clearing genuine bars/cards/panels.
const MIN_OCCLUDER_SIDE_PX = GRID;

// Registration is no longer the primary path: `scanOccluders` discovers every
// painting surface automatically, and `useCircuitOccluder` is now an override
// for what a classifier cannot infer (forcing a surface that paints nothing to
// occlude anyway). This dev-only warn survives for the case where someone
// force-registers an interactive element instead of the surface around it.
//
// The scanner deliberately does *not* share this exclusion. Classification is
// about paint, not interactivity, and this codebase's own `CasePreviewCard` is a
// `<button class="site-panel">` — both fully interactive and one of the most
// visually solid surfaces on the page.
const INTERACTIVE_OCCLUDER_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"]';

// How long DOM mutations must be quiet before a rescan. Long enough to coalesce
// a route change's burst of insertions into one scan, short enough that content
// appearing asynchronously (a Clerk widget mounting, a lazy route resolving)
// occludes before the eye settles on it.
export const MUTATION_SETTLE_MS = 120;

// Backpressure on the rescan path. `scanOccluders` reads computed style, so a
// pathological mutation source could otherwise pin a core. Above this rate the
// debounce stretches to `MUTATION_BACKOFF_MS`, bounding the worst case
// regardless of what the page is doing.
export const MAX_SCANS_PER_SECOND = 4;
export const MUTATION_BACKOFF_MS = 500;

// Attribute mutations worth rescanning for. An unfiltered `attributes: true`
// would fire on every inline-style write on the page — including
// `CircuitField`'s own per-frame `el.style.opacity` writes on its SVG children,
// which is a rescan every animation frame.
const WATCHED_ATTRIBUTES = ["class", "style", "hidden", "inert"];

/**
 * Whether a mutation originated inside one of our own SVG layers.
 *
 * This is what makes observing `style` attributes affordable at all:
 * `CircuitField`'s animation loop writes `el.style.opacity` on its SVG children
 * every single frame, so without this filter every rendered frame would queue a
 * rescan and the debounce would never drain.
 */
function isIgnorableMutation(record: MutationRecord): boolean {
  const target = record.target;
  const el = target.nodeType === 1 ? (target as Element) : target.parentElement;

  // An unresolvable target counts as *not* ignorable: erring toward one extra
  // scan is cheap, while erring the other way silently drops a real change.
  if (!el) return false;

  return el.closest(`[${CIRCUIT_FIELD_MARKER}],[${CIRCUIT_OVERLAY_MARKER}]`) !== null;
}

const RegistryContext = React.createContext<OccluderRegistry | null>(null);
const RectsContext = React.createContext<Occluder[]>([]);
const DeltaContext = React.createContext<DeltaSubscribe>(() => () => {});

// Warn-once bookkeeping for the size floor below, which is now re-evaluated
// on every measurement pass — a `WeakSet` so an unmounted registrant's
// element doesn't stay reachable from module scope.
const undersizedWarned = new WeakSet<Element>();

/**
 * The `MIN_OCCLUDER_SIDE_PX` floor is enforced here, per measurement pass,
 * rather than once at registration time. A surface can legitimately measure
 * 0-sized on the first passive effect after mount (a font or image still
 * loading, a collapsed accordion, an animated-in panel, anything behind a
 * suspense boundary that just resolved); rejecting at registration would drop
 * it permanently, since the `ResizeObserver` only ever watches elements that
 * did register and could therefore never notice it reaching its real size.
 * Re-checking here keeps the same rejection semantics but self-corrects.
 */
function measureRegistrants(
  targets: Map<symbol, Registrant>,
  viewport: { width: number; height: number },
): Map<OccluderId, Occluder> {
  const measured = new Map<OccluderId, Occluder>();

  targets.forEach(({ ref, options }, id) => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    // `right - left` / `bottom - top`, not `.width`/`.height` — matches how
    // the bounds below are derived from the same rect, and is robust to a
    // `getBoundingClientRect` stub (e.g. in tests) that sets the edges but
    // not the derived size.
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (width < MIN_OCCLUDER_SIDE_PX || height < MIN_OCCLUDER_SIDE_PX) {
      // A fully-collapsed rect is the "not laid out yet" case this pass
      // exists to keep recoverable, not a mis-registered element — stay
      // quiet about it and only warn once a real, genuinely-too-small
      // measurement lands.
      if (width > 0 && height > 0 && !undersizedWarned.has(el)) {
        undersizedWarned.add(el);
        console.warn(
          "[CircuitField] useCircuitOccluder skipped a registrant smaller than MIN_OCCLUDER_SIDE_PX on one side — register the surrounding surface instead.",
          { width, height },
        );
      }
      return;
    }

    const y1 =
      options.maxHeightPx !== undefined
        ? Math.min(rect.bottom, rect.top + options.maxHeightPx)
        : rect.bottom;

    // No explicit `kind`: absent means hard (see `Occluder`), and a manual
    // registration is always a hard surface — that is what the override is for.
    // Keeping it absent also means `measurementsEqual` never sees a spurious
    // `undefined` vs `"hard"` difference between passes.
    const clamped = clampRectToViewport(
      { x0: rect.left, y0: rect.top, x1: rect.right, y1 },
      viewport.width,
      viewport.height,
    );
    if (clamped) measured.set(id, clamped);
  });

  return measured;
}

/**
 * Measures every automatically discovered surface, translating its cached
 * element-local rects by one fresh `getBoundingClientRect`.
 *
 * This is the whole point of storing local rects: no `getComputedStyle` and no
 * `Range` work happens here, so the scroll path — which runs this on every tick —
 * costs one layout read per surface and nothing else.
 *
 * Unlike a manual registrant, an undersized discovered surface is never warned
 * about. The scanner finds them by the hundred on a normal page; a warning would
 * be noise, not a signal.
 */
function measureDiscovered(
  discovered: readonly DiscoveredSurface[],
  viewport: { width: number; height: number },
): Map<OccluderId, Occluder> {
  const measured = new Map<OccluderId, Occluder>();

  discovered.forEach((surface, index) => {
    const box = surface.el.getBoundingClientRect();

    surface.localRects.forEach((local, rectIndex) => {
      const base: Occluder = {
        x0: box.left + local.x0,
        y0: box.top + local.y0,
        x1: box.left + local.x1,
        y1: box.top + local.y1,
      };
      // `kind` marks ink only. Hard is the absent-tag default, so setting it
      // explicitly here would just make every hard rect compare unequal to the
      // plain-literal form the manual path and every existing test produce.
      const clamped = clampRectToViewport(
        surface.kind === "soft" ? { ...base, kind: "soft" as const } : base,
        viewport.width,
        viewport.height,
      );

      if (clamped) measured.set(`d${index}#${rectIndex}`, clamped);
    });
  });

  return measured;
}

/**
 * `documentElement.clientWidth`/`clientHeight` first — a scrollbar appearing or
 * disappearing changes those without changing `window.inner*`, and they describe
 * the box rects are actually clamped against.
 *
 * `window.inner*` is the fallback rather than the primary because it includes
 * the scrollbar gutter. Either can read 0 in a non-layout environment (jsdom
 * reports 0 for `clientWidth` and 1024 for `innerWidth`), and
 * `clampRectToViewport` treats 0 as "unbounded on that axis" rather than
 * clamping everything away.
 */
function readViewport(): { width: number; height: number } {
  const root = document.documentElement;

  return {
    width: root.clientWidth || window.innerWidth,
    height: root.clientHeight || window.innerHeight,
  };
}

function measurementsEqual(a: Map<OccluderId, Occluder>, b: Map<OccluderId, Occluder>): boolean {
  if (a.size !== b.size) return false;

  for (const [id, rect] of a) {
    const other = b.get(id);
    if (!other) return false;
    if (
      rect.x0 !== other.x0 ||
      rect.y0 !== other.y0 ||
      rect.x1 !== other.x1 ||
      rect.y1 !== other.y1 ||
      // `kind` too: an element reclassified hard<->soft at identical geometry is
      // a real change to the barrier field and must recommit. Deliberately *not*
      // added to `rectChanged` below — a kind flip can only come from a
      // structural rescan, which commits directly rather than going through the
      // scroll delta path.
      rect.kind !== other.kind
    )
      return false;
  }

  return true;
}

function rectChanged(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.x0 - b.x0) > OCCLUDER_SCROLL_DELTA_PX ||
    Math.abs(a.y0 - b.y0) > OCCLUDER_SCROLL_DELTA_PX ||
    Math.abs(a.x1 - b.x1) > OCCLUDER_SCROLL_DELTA_PX ||
    Math.abs(a.y1 - b.y1) > OCCLUDER_SCROLL_DELTA_PX
  );
}

/**
 * Diffs a fresh measurement pass against the last known rect per registrant
 * — the union of old+new rect for every registrant whose measurement moved
 * beyond `OCCLUDER_SCROLL_DELTA_PX`, plus the old rect of any registrant
 * that disappeared. Used only by the scroll-delta path; the structural path
 * doesn't need a diff, it just commits the fresh measurement outright.
 */
function diffMeasurements(
  previous: Map<OccluderId, Occluder>,
  next: Map<OccluderId, Occluder>,
): Rect[] {
  const dirty: Rect[] = [];

  previous.forEach((oldRect, id) => {
    const newRect = next.get(id);
    if (!newRect) {
      dirty.push(oldRect);
      return;
    }
    if (rectChanged(oldRect, newRect)) {
      dirty.push(oldRect, newRect);
    }
  });

  next.forEach((newRect, id) => {
    if (!previous.has(id)) dirty.push(newRect);
  });

  return dirty;
}

/**
 * Establishes the shared occluder registry for every `useCircuitOccluder`
 * call and `CircuitField` instance beneath it. Renders no DOM element of its
 * own, so wrapping an app-shell's existing return value in this never adds
 * a wrapper div or disturbs flex/grid layout — `CircuitField` is a sibling
 * of the registering elements (a header, a main content area) in every
 * consuming app-shell's JSX, not their ancestor, so the provider has to live
 * at a common ancestor of both, i.e. the app-shell's own root.
 *
 * Two independent measurement triggers feed two independent consumers:
 * register/unregister/`ResizeObserver` firing is a *structural* change and
 * commits a fresh `Occluder[]` via `RectsContext` (feeds `CircuitField`'s
 * `targetTraces`/`traceCount` — a real spanning-tree rebuild, so this stays
 * exactly as expensive/rare as before). A `scroll` event is measured too
 * (rects go stale the instant the page scrolls otherwise) and, while
 * actively scrolling, only notifies `DeltaContext` subscribers with
 * whatever rects actually moved — it does not commit `RectsContext` on
 * every tick, so a full re-render/regeneration is never triggered mid-
 * gesture. But `SCROLL_SETTLE_MS` after the last scroll event, the provider
 * forces one structural commit of the settled rects — the bounded per-tip
 * scroll-delta nudge (`handleOccluderDelta`/`retargetTip`) is best-effort
 * and can leave a trace stranded inside an occluder's final position after
 * a fast/large scroll, so the settled geometry always gets one authoritative
 * `barriers`/`generateTraces` recompute to guarantee zero occluder
 * violations once scrolling actually stops.
 */
export function CircuitOccluderProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const targetsRef = React.useRef(new Map<symbol, Registrant>());
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const scrollSettleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeSettleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const structuralPendingRef = React.useRef(true); // first measurement pass is always a commit
  const measuredRef = React.useRef(new Map<OccluderId, Occluder>());
  const committedRef = React.useRef(new Map<OccluderId, Occluder>());
  const deltaListenersRef = React.useRef(new Set<DeltaListener>());
  const discoveredRef = React.useRef<DiscoveredSurface[]>([]);
  const scanPendingRef = React.useRef(true); // first pass always discovers
  const mutationTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanTimestampsRef = React.useRef<number[]>([]);
  const [rects, setRects] = React.useState<Occluder[]>([]);

  const flush = React.useCallback(() => {
    const viewport = readViewport();

    // Discovery runs on the structural path only. It is the expensive half —
    // a DOM walk reading computed style — while the scroll path below needs
    // nothing but a fresh `getBoundingClientRect` per already-known surface.
    if (scanPendingRef.current) {
      scanPendingRef.current = false;
      scanTimestampsRef.current = [...scanTimestampsRef.current, Date.now()].slice(
        -MAX_SCANS_PER_SECOND,
      );
      discoveredRef.current = scanOccluders(document.body, viewport);
    }

    const next = measureRegistrants(targetsRef.current, viewport);
    measureDiscovered(discoveredRef.current, viewport).forEach((rect, id) => {
      next.set(id, rect);
    });

    if (structuralPendingRef.current) {
      structuralPendingRef.current = false;
      // Skip the commit when this structural pass measured to the same
      // rects as what's currently *committed* — e.g. a card-dense route
      // with several independently-async registrants (a per-card
      // live-status badge resolving at its own time) each trigger their own
      // structural flush, but most of those passes measure identically to
      // what's already committed. Suppressing the no-op commit avoids a
      // needless `targetTraces` recompute (a real spanning-tree rebuild)
      // per registrant instead of per actual layout change.
      //
      // Deliberately compared against `committedRef`, not `measuredRef` —
      // the scroll path below overwrites `measuredRef` on every scroll
      // flush (it needs the freshest snapshot for its own delta diff), so
      // comparing a settle-triggered structural pass against `measuredRef`
      // would always read "unchanged" (scroll already measured the same
      // settled rects seconds earlier) and silently swallow the commit this
      // whole settle mechanism exists to force.
      const unchanged = measurementsEqual(committedRef.current, next);
      measuredRef.current = next;
      if (!unchanged) {
        committedRef.current = next;
        setRects(Array.from(next.values()));
      }
      return;
    }

    const dirty = diffMeasurements(measuredRef.current, next);
    measuredRef.current = next;
    if (dirty.length > 0) {
      // The freshly measured full set, not the stale `rects` state — the
      // scroll path deliberately never commits `RectsContext` (see the
      // provider doc comment above), so a delta listener that scores
      // candidates against occluder geometry needs this snapshot instead of
      // `useCircuitOccluderRects()`, which would still be pre-scroll.
      const liveOccluders = Array.from(next.values());
      deltaListenersRef.current.forEach((listener) => {
        listener(dirty, liveOccluders);
      });
    }
  }, []);

  const scheduleMeasure = React.useCallback(
    (trigger: "structural" | "scroll") => {
      if (trigger === "structural") {
        structuralPendingRef.current = true;
        // Every structural trigger is also a rediscovery trigger. Both flags
        // ride the same rAF single-flight below, so N triggers in one layout
        // pass still produce exactly one scan and one measurement.
        scanPendingRef.current = true;
      }
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    },
    [flush],
  );

  /**
   * Debounced rescan for DOM changes, with a token bucket behind it.
   *
   * Trailing rather than leading: a route change arrives as a burst of
   * insertions, and only the settled tree is worth measuring.
   */
  const scheduleScan = React.useCallback(() => {
    const now = Date.now();
    const recent = scanTimestampsRef.current.filter((at) => now - at < 1000);
    const delay = recent.length >= MAX_SCANS_PER_SECOND ? MUTATION_BACKOFF_MS : MUTATION_SETTLE_MS;

    if (mutationTimerRef.current !== null) clearTimeout(mutationTimerRef.current);
    mutationTimerRef.current = setTimeout(() => {
      mutationTimerRef.current = null;
      scheduleMeasure("structural");
    }, delay);
  }, [scheduleMeasure]);

  React.useEffect(() => {
    // One shared ResizeObserver for every registrant, batched through a
    // single rAF so multiple entries from the same layout pass collapse
    // into one measurement pass instead of one per registrant.
    const observer = new ResizeObserver(() => {
      scheduleMeasure("structural");
    });

    // Child `useCircuitOccluder` effects run before this parent effect, so
    // by the time we get here `targetsRef.current` may already hold refs
    // that `register` couldn't hand to an observer that didn't exist yet.
    // Catch them up now.
    targetsRef.current.forEach(({ ref }) => {
      if (ref.current) observer.observe(ref.current);
    });

    // `document.body` as well as the registrants: automatically discovered
    // surfaces have no per-element observer, so this is what notices the
    // document reflowing (a route change, lazy content resolving, an accordion
    // opening) and changing every discovered rect at once.
    observer.observe(document.body);

    observerRef.current = observer;
    scheduleMeasure("structural");

    // Structural changes that no `ResizeObserver` reports: content appearing or
    // being replaced without the body's own box changing.
    const mutationObserver = new MutationObserver((records) => {
      if (records.every(isIgnorableMutation)) return;
      scheduleScan();
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: WATCHED_ATTRIBUTES,
    });

    // A CSS transition mutates no attribute when it *finishes*, so neither
    // observer above sees a settle. `apps/web`'s condensed header is the live
    // case: its wrapper transitions opacity over 300ms, the `class` mutation
    // fires at transition *start*, and the debounced scan 120ms later reads a
    // mid-transition opacity around 0.4 — registering a surface that then fades
    // to zero with nothing left to trigger a correction. Scroll settle
    // (`SCROLL_SETTLE_MS`) does not cover it either, since the transition is
    // still running at that point.
    const onTransitionEnd = () => {
      scheduleScan();
    };
    window.addEventListener("transitionend", onTransitionEnd, { passive: true, capture: true });
    window.addEventListener("animationend", onTransitionEnd, { passive: true, capture: true });

    const onScroll = () => {
      scheduleMeasure("scroll");

      if (scrollSettleTimerRef.current !== null) clearTimeout(scrollSettleTimerRef.current);
      scrollSettleTimerRef.current = setTimeout(() => {
        scrollSettleTimerRef.current = null;
        // Settled: force the structural commit the lightweight scroll path
        // deliberately skips (see the provider doc comment above) so
        // `barriers`/`generateTraces` land on the real final geometry.
        scheduleMeasure("structural");
      }, SCROLL_SETTLE_MS);
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    // A viewport resize routinely *moves* a registrant without changing its
    // own box — a `max-w-*` panel keeps the same width and height while the
    // centering margins around it shift — and `ResizeObserver` never fires on
    // a position-only change. Without this the committed rects stay pinned to
    // pre-resize geometry, and since `CircuitField` regenerates on its own
    // resize handler, it rebuilds against those stale barriers and lays
    // traces straight across the surface. Same immediate-plus-settle shape as
    // the scroll path: resize arrives as a burst, and the last event is the
    // one whose geometry has to be committed.
    const onResize = () => {
      scheduleMeasure("structural");

      if (resizeSettleTimerRef.current !== null) clearTimeout(resizeSettleTimerRef.current);
      resizeSettleTimerRef.current = setTimeout(() => {
        resizeSettleTimerRef.current = null;
        scheduleMeasure("structural");
      }, SCROLL_SETTLE_MS);
    };
    window.addEventListener("resize", onResize, { passive: true });

    return () => {
      observer.disconnect();
      mutationObserver.disconnect();
      observerRef.current = null;
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      window.removeEventListener("transitionend", onTransitionEnd, { capture: true });
      window.removeEventListener("animationend", onTransitionEnd, { capture: true });
      // Same reset-to-null discipline as `rafRef` below, for the same reason: a
      // stale handle left in the ref reads as "already scheduled".
      if (mutationTimerRef.current !== null) {
        clearTimeout(mutationTimerRef.current);
        mutationTimerRef.current = null;
      }
      if (resizeSettleTimerRef.current !== null) {
        clearTimeout(resizeSettleTimerRef.current);
        resizeSettleTimerRef.current = null;
      }
      if (scrollSettleTimerRef.current !== null) {
        clearTimeout(scrollSettleTimerRef.current);
        scrollSettleTimerRef.current = null;
      }
      // Reset to `null` after cancelling, not just cancel — a dead
      // (already-cancelled) handle left sitting in `rafRef.current` reads as
      // "a frame is still pending" to every future `scheduleMeasure()` call
      // (`rafRef.current === null` is its only signal to schedule a new
      // one), permanently wedging this provider's measurement pipeline.
      // React 18/19 StrictMode's simulated mount->unmount->remount runs this
      // exact cleanup right after the first mount's own `scheduleMeasure`
      // call already scheduled a frame — without resetting the ref here,
      // that first frame is cancelled but never forgotten, so the remount's
      // own `scheduleMeasure` call sees a non-null `rafRef.current` and
      // silently no-ops forever: `flush()` never runs again, `rects` never
      // leaves its initial `[]`, and every consumer's occlusion is
      // permanently empty. Same hazard class, same fix, as
      // `circuit-field.tsx`'s own unmount-cleanup effect.
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [scheduleMeasure, scheduleScan]);

  const registry = React.useMemo<OccluderRegistry>(
    () => ({
      register: (id, ref, options = {}) => {
        targetsRef.current.set(id, { ref, options });
        if (ref.current) observerRef.current?.observe(ref.current);
        scheduleMeasure("structural");
      },
      unregister: (id) => {
        const entry = targetsRef.current.get(id);
        if (entry?.ref.current) observerRef.current?.unobserve(entry.ref.current);
        targetsRef.current.delete(id);
        scheduleMeasure("structural");
      },
    }),
    [scheduleMeasure],
  );

  const subscribeDelta = React.useMemo<DeltaSubscribe>(
    () => (listener) => {
      deltaListenersRef.current.add(listener);
      return () => {
        deltaListenersRef.current.delete(listener);
      };
    },
    [],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <DeltaContext.Provider value={subscribeDelta}>
        <RectsContext.Provider value={rects}>{children}</RectsContext.Provider>
      </DeltaContext.Provider>
    </RegistryContext.Provider>
  );
}

/**
 * Registers `ref`'s element as a hard-barrier occluder for any
 * `CircuitField` beneath the nearest `CircuitOccluderProvider` — traces and
 * packets are kept out of its (buffered) bounds entirely, not merely
 * steered around it. Takes an existing ref rather than owning one, so a
 * consumer that already has a ref for other purposes (e.g. web's
 * `headerRef`, used for scroll-condense detection) reuses it instead of
 * duplicating it.
 *
 * Intended only for genuine surfaces — panels, cards, footers, and other
 * solid rectangular containers — never for titles, badges, buttons, or
 * other interactive/decorative elements; register the surrounding
 * non-interactive surface instead of the interactive element itself.
 *
 * Occlusion is a visual enhancement, not a correctness requirement —
 * calling this outside a `CircuitOccluderProvider` no-ops (with a dev-mode
 * warning) rather than throwing, so a missing provider degrades to "no
 * occlusion" instead of crashing the app.
 */
export function useCircuitOccluder(
  ref: React.RefObject<Element | null>,
  options?: { enabled?: boolean } & RegistrantOptions,
): void {
  const registry = React.useContext(RegistryContext);
  const enabled = options?.enabled ?? true;
  const maxHeightPx = options?.maxHeightPx;
  const idRef = React.useRef<symbol>(undefined as unknown as symbol);
  if (idRef.current === undefined) idRef.current = Symbol("circuit-occluder");

  React.useEffect(() => {
    if (!enabled) return;

    if (!registry) {
      console.warn(
        "[CircuitField] useCircuitOccluder called outside a CircuitOccluderProvider — ignoring.",
      );
      return;
    }

    // Deliberately no size check here: `MIN_OCCLUDER_SIDE_PX` is enforced in
    // `measureRegistrants`, on every structural pass, so an element that
    // simply hasn't been laid out yet at this (first passive effect) moment
    // still gets observed and recovers once it reaches its real size.
    const el = ref.current;
    if (el) {
      if (el.matches(INTERACTIVE_OCCLUDER_SELECTOR)) {
        console.warn(
          "[CircuitField] useCircuitOccluder was called with an interactive element (button/link/input) as the ref — register the surrounding non-interactive surface instead.",
          el,
        );
      }

      el.setAttribute("data-circuit-occluder", "surface");
    }

    const id = idRef.current;
    registry.register(id, ref, maxHeightPx !== undefined ? { maxHeightPx } : undefined);
    return () => {
      // `el`, not `ref.current` — React nulls the ref during unmount's
      // mutation phase before this (passive-effect) cleanup runs, so
      // reading `ref.current` here would already be `null`.
      el?.removeAttribute("data-circuit-occluder");
      registry.unregister(id);
    };
  }, [registry, ref, enabled, maxHeightPx]);
}

/** Package-internal — `CircuitField`'s own consumption of the registered
 * rects. Not part of `@unimatrix/ui/public`'s exported surface. */
export function useCircuitOccluderRects(): Occluder[] {
  return React.useContext(RectsContext);
}

/**
 * Package-internal — notifies `onDelta` with whatever registrant rects
 * moved beyond `OCCLUDER_SCROLL_DELTA_PX` since they were last measured,
 * whenever a `scroll` event causes a re-measurement. Never fires for a
 * structural (register/unregister/`ResizeObserver`) change — those commit
 * `useCircuitOccluderRects()` directly instead, so a caller reacting to
 * both would double-process the same underlying rect change. Not part of
 * `@unimatrix/ui/public`'s exported surface; `CircuitField` is the only
 * intended consumer.
 */
export function useCircuitOccluderDelta(
  onDelta: (dirtyRects: Rect[], liveOccluders: Occluder[]) => void,
): void {
  const subscribe = React.useContext(DeltaContext);
  const onDeltaRef = React.useRef(onDelta);
  onDeltaRef.current = onDelta;

  React.useEffect(() => {
    return subscribe((dirtyRects, liveOccluders) => {
      onDeltaRef.current(dirtyRects, liveOccluders);
    });
  }, [subscribe]);
}
