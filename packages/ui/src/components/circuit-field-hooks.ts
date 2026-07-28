import * as React from "react";

import {
  type CapabilitySignals,
  type MotionMode,
  canShowIdleGlow,
  decideMotionMode,
  mostRestrictive,
  readCapabilitySignals,
} from "./capability.js";

export const RESIZE_SETTLE_MS = 200;
// A mobile URL bar collapsing/expanding mid-scroll changes `innerHeight` by
// up to roughly this much without any real layout change — generous vs.
// typical iOS Safari/Chrome Android chrome height, needs real-device
// confirmation. A width-unchanged height delta under this threshold is
// treated as chrome jitter, not a real resize.
export const HEIGHT_JITTER_IGNORE_PX = 120;

const MOTION_MEDIA_QUERIES = [
  "(prefers-reduced-motion: reduce)",
  "(prefers-reduced-data: reduce)",
  "(pointer: coarse)",
  "(update: slow)",
] as const;

/**
 * The width below which `CircuitField` renders nothing at all. 640px is this
 * repo's one "mobile format" line — the Tailwind `sm` breakpoint every app
 * shell already reshapes its layout at — so the field disappears exactly
 * where the surrounding page switches to its stacked narrow layout.
 *
 * Deliberately a *layout width*, not a device-class signal. Touch devices are
 * already handled a tier down by `decideMotionMode` (see `capability.ts`),
 * which drops any coarse pointer to `static`: one frozen frame, no animation
 * loop. This gate is about a viewport too narrow for the traces to read as
 * background rather than clutter, which a wide touchscreen is not.
 *
 * Not to be confused with `hooks/use-mobile.ts` (768px, effect-based). That
 * one exists for the shadcn sidebar's off-canvas switch and is scoped to it;
 * its effect-corrected value is fine there and wrong here (see below).
 */
const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  return window.matchMedia(query);
}

function subscribeToMediaQuery(query: string, onStoreChange: () => void): () => void {
  const mql = getMediaQueryList(query);

  if (!mql) {
    return () => {};
  }

  mql.addEventListener("change", onStoreChange);

  return () => {
    mql.removeEventListener("change", onStoreChange);
  };
}

/**
 * Reads the match synchronously on first render (via `useSyncExternalStore`'s
 * snapshot) rather than correcting from `false` inside an effect. The
 * distinction is load-bearing for what this gates: an effect-corrected value
 * mounts the whole field for one frame on a narrow viewport, which generates
 * traces and starts the animation loop before unmounting them again — the
 * exact work the gate exists to avoid.
 */
function useMediaQuery(query: string): boolean {
  return React.useSyncExternalStore(
    (onStoreChange) => subscribeToMediaQuery(query, onStoreChange),
    () => getMediaQueryList(query)?.matches ?? false,
    () => false,
  );
}

export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}

/**
 * CircuitField's overall motion mode, folding capability signals (see
 * `capability.ts`) together with a one-way runtime demotion. Initialized
 * synchronously (not via an effect, unlike `useReducedMotion` above) so a
 * `static`-mode device never mounts a frame of `full`-mode content before
 * demoting — these are client-only SPAs with no SSR, so a lazy `useState`
 * initializer can read `matchMedia`/`navigator` directly on first render.
 *
 * `demoteToStatic()` is the one-way ratchet: an OS-level preference (e.g.
 * reduced-motion) can flip back and forth freely and `mode` follows it, but
 * once something demotes at runtime (the frame-budget watchdog), `mode` can
 * never rise above `static` again for the rest of the mount, per this
 * session's "downgrade must be one-way" requirement.
 */
export function useMotionMode(): {
  mode: MotionMode;
  demoteToStatic: () => void;
  idleGlowEligible: boolean;
} {
  const [signals, setSignals] = React.useState<CapabilitySignals>(() => readCapabilitySignals());
  const preferenceMode = React.useMemo(() => decideMotionMode(signals), [signals]);
  const runtimeFloorRef = React.useRef<MotionMode>("full");
  const [, forceRerender] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const medias = MOTION_MEDIA_QUERIES.map((query) => window.matchMedia(query));
    const update = () => {
      setSignals(readCapabilitySignals());
    };

    medias.forEach((media) => {
      media.addEventListener("change", update);
    });
    return () => {
      medias.forEach((media) => {
        media.removeEventListener("change", update);
      });
    };
  }, []);

  const demoteToStatic = React.useCallback(() => {
    if (runtimeFloorRef.current === "static") return;
    runtimeFloorRef.current = "static";
    forceRerender((n) => n + 1);
  }, []);

  const mode = mostRestrictive(preferenceMode, runtimeFloorRef.current);
  // The frame-budget watchdog's runtime demotion is always performance-
  // motivated, regardless of what the live preference signals say — a
  // device it demoted must never get the idle glow.
  const idleGlowEligible =
    mode === "static" && runtimeFloorRef.current !== "static" && canShowIdleGlow(signals);

  return { mode, demoteToStatic, idleGlowEligible };
}

export function useViewportSize(): { width: number; height: number } | null {
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);

  React.useEffect(() => {
    const update = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };

    update();

    let frame: number | null = null;
    const onResize = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return size;
}

/**
 * Settles on a new size only after `delay` ms of no further changes, so a
 * window being actively dragged doesn't trigger constant trace retargeting.
 * The first size is applied immediately (no delay) so initial boot isn't
 * held up.
 *
 * `heightJitterIgnorePx`, when set, ignores a width-unchanged height delta
 * under that threshold entirely (no timer touched at all) — a mobile URL
 * bar collapsing/expanding mid-scroll changes `window.innerHeight` without
 * any real layout change, and without this a brief lull in that
 * fluctuation is enough for `delay` to elapse and commit a full
 * retarget/regeneration mid-scroll. Compared against `lastTargetRef` (the
 * most recently *accepted* size, pending-or-committed) rather than the
 * stale committed `debounced` value, so a jitter sample arriving mid-way
 * through a real pending resize can't cancel that resize's own timer.
 */
export function useDebouncedSize(
  size: { width: number; height: number } | null,
  delay: number,
  options?: { heightJitterIgnorePx?: number },
): { width: number; height: number } | null {
  const [debounced, setDebounced] = React.useState<{ width: number; height: number } | null>(null);
  const hasValueRef = React.useRef(false);
  const timeoutRef = React.useRef<number | undefined>(undefined);
  const lastTargetRef = React.useRef<{ width: number; height: number } | null>(null);
  const jitterThreshold = options?.heightJitterIgnorePx;

  React.useEffect(() => {
    if (!size) return;

    if (!hasValueRef.current) {
      hasValueRef.current = true;
      lastTargetRef.current = size;
      setDebounced(size);
      return;
    }

    const lastTarget = lastTargetRef.current;
    if (
      jitterThreshold !== undefined &&
      lastTarget &&
      size.width === lastTarget.width &&
      Math.abs(size.height - lastTarget.height) <= jitterThreshold
    ) {
      return;
    }

    lastTargetRef.current = size;

    // Deliberately no cleanup return here: React runs the *previous*
    // effect's cleanup on every dependency change, before this effect body
    // even runs — if this scheduled a per-render cleanup, a later
    // jitter-classified render (which returns above without touching
    // anything) would still trigger the prior render's cleanup and cancel
    // this pending commit out from under it. Clearing only happens inline,
    // right before rescheduling (above), plus on true unmount (separate
    // effect below).
    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setDebounced(size);
    }, delay);
  }, [size?.width, size?.height, delay, jitterThreshold]);

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    },
    [],
  );

  return debounced;
}
