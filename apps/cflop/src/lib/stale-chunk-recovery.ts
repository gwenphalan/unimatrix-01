/**
 * Recovers a tab that is still open when a deploy replaces every hashed
 * chunk. Its route document's `import()` calls target chunk hashes the new
 * build no longer ships, so switching between `/learn` and `/drill` throws
 * instead of navigating.
 *
 * Vite's `__vitePreload` helper wraps every lazy import as
 * `baseModule().catch(handlePreloadError)`, which dispatches a cancelable
 * `vite:preloadError` event on `window` carrying the failure as `.payload`,
 * then rethrows unless a listener called `preventDefault()`. This module
 * listens for that event, recognizes the three browser error messages a
 * missing chunk actually produces, and reloads the page once so the tab picks
 * up the current document instead of staying on the one whose imports are
 * gone.
 */

const STALE_CHUNK_MESSAGE_PREFIXES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "Importing a module script failed",
];

/**
 * Re-implemented rather than imported: this is the same set and order
 * `@tanstack/router-core` matches a stale chunk against, but that package is
 * not resolvable from this app (only `react-router` and `router-plugin` are
 * vendored under `@tanstack/`, and `@tanstack/react-router` does not
 * re-export it).
 */
export function isStaleChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return STALE_CHUNK_MESSAGE_PREFIXES.some((prefix) => error.message.startsWith(prefix));
}

export interface InstallStaleChunkRecoveryOptions {
  /**
   * Defaults to reloading the page. Overridable because jsdom forbids
   * navigation, which is what makes this module unit-testable at all.
   */
  reload?: () => void;
}

/**
 * Installs the `vite:preloadError` listener and returns a disposer that
 * removes it.
 *
 * The guard is keyed in `sessionStorage` per failing module URL (carried in
 * the error message), with no expiry, and never reloads when `sessionStorage`
 * itself is unreachable. An earlier design used a time-windowed timestamp
 * plus a module-scope boolean "already reloaded" backstop; measured with
 * `sessionStorage` made to throw, that produced 293 requests for `/learn` in
 * 8 seconds, because the module-scope boolean is per-document and gets
 * re-initialised by the very reload it was meant to guard. A mistake here
 * fails as an unbounded reload loop rather than a visible error, so an
 * unreachable `sessionStorage` (blocked cookies, an enterprise storage
 * policy, a sandboxed iframe) has to leave the broken page on screen instead
 * of guessing.
 *
 * Never calls `event.preventDefault()`: `__vitePreload` resolves `undefined`
 * when the rethrow is suppressed, and the failure resurfaces a few frames
 * later as an unclassifiable `TypeError` from
 * `@tanstack/router-core/dist/esm/load-matches.js` destructuring
 * `lazyRoute.options` — with the self-describing message gone by then.
 */
export function installStaleChunkRecovery(
  options: InstallStaleChunkRecoveryOptions = {},
): () => void {
  const reload =
    options.reload ??
    (() => {
      window.location.reload();
    });

  function handlePreloadError(event: VitePreloadErrorEvent) {
    if (!isStaleChunkError(event.payload)) {
      return;
    }

    const key = `cflop:stale-chunk-reload:${event.payload.message}`;

    try {
      if (window.sessionStorage.getItem(key) !== null) {
        return;
      }
      window.sessionStorage.setItem(key, "1");
    } catch {
      return;
    }

    reload();
  }

  window.addEventListener("vite:preloadError", handlePreloadError);
  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
  };
}
