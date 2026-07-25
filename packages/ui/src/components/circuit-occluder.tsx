import * as React from "react";

import type { Occluder } from "./occlusion.js";

type OccluderRegistry = {
  register: (id: symbol, ref: React.RefObject<Element | null>) => void;
  unregister: (id: symbol) => void;
};

const RegistryContext = React.createContext<OccluderRegistry | null>(null);
const RectsContext = React.createContext<Occluder[]>([]);

function measureRegistrants(targets: Map<symbol, React.RefObject<Element | null>>): Occluder[] {
  const rects: Occluder[] = [];

  targets.forEach((ref) => {
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    rects.push({ x0: rect.left, y0: rect.top, x1: rect.right, y1: rect.bottom });
  });

  return rects;
}

/**
 * Establishes the shared occluder registry for every `useCircuitOccluder`
 * call and `CircuitField` instance beneath it. Renders no DOM element of its
 * own, so wrapping an app-shell's existing return value in this never adds
 * a wrapper div or disturbs flex/grid layout — `CircuitField` is a sibling
 * of the registering elements (a header, a main content area) in every
 * consuming app-shell's JSX, not their ancestor, so the provider has to live
 * at a common ancestor of both, i.e. the app-shell's own root.
 */
export function CircuitOccluderProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const targetsRef = React.useRef(new Map<symbol, React.RefObject<Element | null>>());
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [rects, setRects] = React.useState<Occluder[]>([]);

  const scheduleMeasure = React.useCallback(() => {
    if (rafRef.current !== null) return;

    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setRects(measureRegistrants(targetsRef.current));
    });
  }, []);

  React.useEffect(() => {
    // One shared ResizeObserver for every registrant, batched through a
    // single rAF so multiple entries from the same layout pass collapse
    // into one measurement pass instead of one per registrant.
    observerRef.current = new ResizeObserver(() => {
      scheduleMeasure();
    });

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [scheduleMeasure]);

  const registry = React.useMemo<OccluderRegistry>(
    () => ({
      register: (id, ref) => {
        targetsRef.current.set(id, ref);
        if (ref.current) observerRef.current?.observe(ref.current);
        scheduleMeasure();
      },
      unregister: (id) => {
        const ref = targetsRef.current.get(id);
        if (ref?.current) observerRef.current?.unobserve(ref.current);
        targetsRef.current.delete(id);
        scheduleMeasure();
      },
    }),
    [scheduleMeasure],
  );

  return (
    <RegistryContext.Provider value={registry}>
      <RectsContext.Provider value={rects}>{children}</RectsContext.Provider>
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
export function useCircuitOccluder(ref: React.RefObject<Element | null>, options?: { enabled?: boolean }): void {
  const registry = React.useContext(RegistryContext);
  const enabled = options?.enabled ?? true;
  const idRef = React.useRef<symbol>(undefined as unknown as symbol);
  if (idRef.current === undefined) idRef.current = Symbol("circuit-occluder");

  React.useEffect(() => {
    if (!enabled) return;

    if (!registry) {
      console.warn("[CircuitField] useCircuitOccluder called outside a CircuitOccluderProvider — ignoring.");
      return;
    }

    const id = idRef.current;
    registry.register(id, ref);
    return () => {
      registry.unregister(id);
    };
  }, [registry, ref, enabled]);
}

/** Package-internal — `CircuitField`'s own consumption of the registered
 * rects. Not part of `@unimatrix/ui/public`'s exported surface. */
export function useCircuitOccluderRects(): Occluder[] {
  return React.useContext(RectsContext);
}
