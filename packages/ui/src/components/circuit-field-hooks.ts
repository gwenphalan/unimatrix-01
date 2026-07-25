import * as React from "react";

export const RESIZE_SETTLE_MS = 200;

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
 */
export function useDebouncedSize(
  size: { width: number; height: number } | null,
  delay: number,
): { width: number; height: number } | null {
  const [debounced, setDebounced] = React.useState<{ width: number; height: number } | null>(null);
  const hasValueRef = React.useRef(false);
  const timeoutRef = React.useRef<number | undefined>(undefined);

  React.useEffect(() => {
    if (!size) return;

    if (!hasValueRef.current) {
      hasValueRef.current = true;
      setDebounced(size);
      return;
    }

    if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      setDebounced(size);
    }, delay);

    return () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current);
    };
  }, [size?.width, size?.height, delay]);

  return debounced;
}
