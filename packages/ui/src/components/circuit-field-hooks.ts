import * as React from "react";

export const RESIZE_SETTLE_MS = 200;
// A mobile URL bar collapsing/expanding mid-scroll changes `innerHeight` by
// up to roughly this much without any real layout change — generous vs.
// typical iOS Safari/Chrome Android chrome height, needs real-device
// confirmation. A width-unchanged height delta under this threshold is
// treated as chrome jitter, not a real resize.
export const HEIGHT_JITTER_IGNORE_PX = 120;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReduced(media.matches);
    };

    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, []);

  return reduced;
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
