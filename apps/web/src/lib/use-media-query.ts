import { useSyncExternalStore } from "react";

/**
 * Matches the Tailwind `sm` breakpoint (640px) that the app shell's header
 * uses to switch between its stacked mobile layout and its single-row
 * desktop layout — keep the two in sync so "mobile format" means one width
 * everywhere.
 */
const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

function getMediaQueryList(query: string): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return null;
  }

  return window.matchMedia(query);
}

function subscribe(query: string, onStoreChange: () => void): () => void {
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
 * snapshot) rather than correcting from `false` inside an effect — an
 * effect-corrected value renders the wide-viewport branch for one frame on a
 * narrow viewport, which is a visible flash for anything gated on it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => subscribe(query, onStoreChange),
    () => getMediaQueryList(query)?.matches ?? false,
    () => false,
  );
}

export function useIsNarrowViewport(): boolean {
  return useMediaQuery(NARROW_VIEWPORT_QUERY);
}
