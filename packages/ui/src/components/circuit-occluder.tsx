import * as React from "react";

import { GRID } from "./grid-math.js";
import type { Occluder, Rect } from "./occlusion.js";

export type RegistrantOptions = {
  /**
   * Caps how much of the registrant's real height counts as occluder. A
   * scroll-tall container (e.g. an in-flow `<main>` on a window-scrolling
   * page) has a `getBoundingClientRect()` height equal to its full content,
   * which for most pages exceeds one viewport — even freshly re-measured on
   * every scroll frame, an uncapped rect like that blankets the entire
   * viewport for most of the scroll range (`occlusionWeightAt`'s min-combine
   * treats "anywhere inside a rect" as one flat floor regardless of depth),
   * leaving nothing for scroll-driven retargeting to react to. Capping the
   * registered height keeps the occluder's top edge tracking the real DOM
   * (still moves with scroll) while letting its bottom edge open up once
   * you've scrolled past the cap — a deliberate, documented departure from
   * "occluder rect == literal DOM bounds" for tall scrolling containers.
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

// Suggested `maxHeightPx` for a scroll-tall in-flow container (e.g. an
// app-shell's `<main>` on a window-scrolling page) — generous vs typical
// viewport heights; needs a real-browser visual pass to tune further.
export const MAIN_OCCLUDER_MAX_HEIGHT_PX = 900;

const RegistryContext = React.createContext<OccluderRegistry | null>(null);
const RectsContext = React.createContext<Occluder[]>([]);
const DeltaContext = React.createContext<DeltaSubscribe>(() => () => {});

function measureRegistrants(targets: Map<symbol, Registrant>): Map<symbol, Occluder> {
  const measured = new Map<symbol, Occluder>();

  targets.forEach(({ ref, options }, id) => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const y1 = options.maxHeightPx !== undefined ? Math.min(rect.bottom, rect.top + options.maxHeightPx) : rect.bottom;

    measured.set(id, { x0: rect.left, y0: rect.top, x1: rect.right, y1 });
  });

  return measured;
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
 * (rects go stale the instant the page scrolls otherwise) but never commits
 * `RectsContext` on its own — it only notifies `DeltaContext` subscribers
 * with whatever rects actually moved, so a full re-render/regeneration can
 * never be triggered by scrolling alone.
 */
export function CircuitOccluderProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const targetsRef = React.useRef(new Map<symbol, Registrant>());
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const structuralPendingRef = React.useRef(true); // first measurement pass is always a commit
  const measuredRef = React.useRef(new Map<symbol, Occluder>());
  const deltaListenersRef = React.useRef(new Set<DeltaListener>());
  const [rects, setRects] = React.useState<Occluder[]>([]);

  const flush = React.useCallback(() => {
    const next = measureRegistrants(targetsRef.current);

    if (structuralPendingRef.current) {
      structuralPendingRef.current = false;
      measuredRef.current = next;
      setRects(Array.from(next.values()));
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
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });

    return () => {
      observer.disconnect();
      observerRef.current = null;
      window.removeEventListener("scroll", onScroll, { capture: true });
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
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
        measuredRef.current.delete(id);
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
 * Registers `ref`'s element as a soft occluder for any `CircuitField`
 * beneath the nearest `CircuitOccluderProvider`. Takes an existing ref
 * rather than owning one, so a consumer that already has a ref for other
 * purposes (e.g. web's `headerRef`, used for scroll-condense detection)
 * reuses it instead of duplicating it.
 *
 * Occlusion is a soft visual enhancement, not a correctness requirement —
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
      console.warn("[CircuitField] useCircuitOccluder called outside a CircuitOccluderProvider — ignoring.");
      return;
    }

    const id = idRef.current;
    registry.register(id, ref, maxHeightPx !== undefined ? { maxHeightPx } : undefined);
    return () => {
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
export function useCircuitOccluderDelta(onDelta: (dirtyRects: Rect[], liveOccluders: Occluder[]) => void): void {
  const subscribe = React.useContext(DeltaContext);
  const onDeltaRef = React.useRef(onDelta);
  onDeltaRef.current = onDelta;

  React.useEffect(() => {
    return subscribe((dirtyRects, liveOccluders) => {
      onDeltaRef.current(dirtyRects, liveOccluders);
    });
  }, [subscribe]);
}
