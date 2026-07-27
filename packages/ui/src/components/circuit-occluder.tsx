import * as React from "react";

import { GRID } from "./grid-math.js";
import type { Occluder, Rect } from "./occlusion.js";

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

// Registration stays explicit opt-in (no DOM-scanning heuristic) — this is
// a dev-only warn, not a rejection, for the common mistake of registering
// an interactive element (a link/button) instead of the non-interactive
// surface around it. Occluders are meant for panels/cards/footers, never
// for titles, badges, buttons, or other interactive/decorative elements.
const INTERACTIVE_OCCLUDER_SELECTOR =
  'button, a[href], input, select, textarea, [role="button"], [role="link"]';

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
function measureRegistrants(targets: Map<symbol, Registrant>): Map<symbol, Occluder> {
  const measured = new Map<symbol, Occluder>();

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

    measured.set(id, { x0: rect.left, y0: rect.top, x1: rect.right, y1 });
  });

  return measured;
}

function measurementsEqual(a: Map<symbol, Occluder>, b: Map<symbol, Occluder>): boolean {
  if (a.size !== b.size) return false;

  for (const [id, rect] of a) {
    const other = b.get(id);
    if (!other) return false;
    if (
      rect.x0 !== other.x0 ||
      rect.y0 !== other.y0 ||
      rect.x1 !== other.x1 ||
      rect.y1 !== other.y1
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
function diffMeasurements(previous: Map<symbol, Occluder>, next: Map<symbol, Occluder>): Rect[] {
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
  const measuredRef = React.useRef(new Map<symbol, Occluder>());
  const committedRef = React.useRef(new Map<symbol, Occluder>());
  const deltaListenersRef = React.useRef(new Set<DeltaListener>());
  const [rects, setRects] = React.useState<Occluder[]>([]);

  const flush = React.useCallback(() => {
    const next = measureRegistrants(targetsRef.current);

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
      if (trigger === "structural") structuralPendingRef.current = true;
      if (rafRef.current !== null) return;

      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    },
    [flush],
  );

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

    observerRef.current = observer;
    scheduleMeasure("structural");

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
      observerRef.current = null;
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
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
  }, [scheduleMeasure]);

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
