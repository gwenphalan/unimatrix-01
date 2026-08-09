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
 * missing chunk actually produces, probes the failing chunk's own URL to
 * confirm it is actually gone, and reloads the page once so the tab picks up
 * the current document instead of staying on the one whose imports are gone.
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

// Only these two of the three matched messages carry the failing module's own
// URL (`<prefix>: <url>`). Safari's "Importing a module script failed" carries
// none, so there is nothing to probe for that one — see the no-URL branch in
// `handlePreloadError` below.
const URL_CARRYING_MESSAGE_PREFIXES = [
  "Failed to fetch dynamically imported module",
  "error loading dynamically imported module",
];

function extractFailingModuleUrl(message: string): string | null {
  for (const prefix of URL_CARRYING_MESSAGE_PREFIXES) {
    if (!message.startsWith(prefix)) {
      continue;
    }
    const url = message.slice(prefix.length).replace(/^:\s*/, "").trim();
    return url.length > 0 ? url : null;
  }
  return null;
}

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

function defaultProbe(url: string): Promise<Response> {
  return fetch(url, { method: "HEAD", signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS) });
}

/**
 * Decides whether a failing chunk is actually gone from the origin, as
 * opposed to `vite:preloadError` firing for a transient network failure
 * (Chrome throws the same "Failed to fetch dynamically imported module" for
 * a wifi drop as for a real 404). A `false` here means "leave the tab alone":
 * destroying `apps/cflop/AGENTS.md`'s module-scope drill bag on a network
 * blip is worse than leaving a stale-but-still-broken tab for the user to
 * retry.
 *
 * - 404 is unambiguous: the chunk is gone.
 * - A 200 with an HTML content type is treated as gone too. cflop's own
 *   nginx 404s a missing chunk correctly, but `apps/web`, `apps/auth` and
 *   `apps/admin` serve `index.html` as an SPA fallback for any unmatched
 *   path, so on those a missing chunk would answer 200 with `text/html`
 *   instead of a real JS response — the same "gone" signal wearing a
 *   different status code. This module is unused by those apps today; the
 *   branch exists so a future shared version does not have to relearn it.
 * - Anything else (other 4xx/5xx, a 2xx that is not HTML, a network error, a
 *   timeout) is treated as "not confirmed gone" and does not reload. An
 *   ambiguous signal from a flaky origin should not spend the tab's one
 *   reload.
 */
async function isChunkConfirmedGone(
  url: string,
  probe: (url: string) => Promise<Response>,
): Promise<boolean> {
  let response: Response;
  try {
    response = await probe(url);
  } catch {
    // Covers a network failure and the timeout above (`AbortSignal.timeout`
    // rejects the fetch it aborts) alike — neither tells us the chunk is
    // gone, only that this probe didn't complete.
    return false;
  }

  if (response.status === 404) {
    return true;
  }

  const contentType = response.headers.get("content-type") ?? "";
  return response.ok && contentType.includes("text/html");
}

export interface InstallStaleChunkRecoveryOptions {
  /**
   * Defaults to reloading the page. Overridable because jsdom forbids
   * navigation, which is what makes this module unit-testable at all.
   */
  reload?: () => void;
  /**
   * Defaults to a `HEAD` request against the failing chunk's own URL, with a
   * timeout. Overridable so the probe is testable without a real network
   * call.
   */
  probe?: (url: string) => Promise<Response>;
}

/**
 * Installs the `vite:preloadError` listener and returns a disposer that
 * removes it.
 *
 * The guard is keyed in `sessionStorage` on `import.meta.url` — this
 * module's own content-hashed chunk URL, which Vite resolves at build time.
 * That gives the key exactly the properties this needs:
 * - A genuinely new document (new build, new hash) gets a fresh key, so it
 *   gets its one reload.
 * - The *same* stale document keeps the same key on every failure, so a
 *   reload that did not fix anything cannot loop.
 * - No expiry to tune and nothing to clear. A time window re-opens the loop
 *   a stale document is already in: a permanently broken deploy would reload
 *   every N minutes forever rather than settling on the one attempt.
 *
 * One consequence follows directly from keying on the build rather than the
 * failing module: several different chunks failing within the same stale
 * document now share that one reload, rather than each getting its own. That
 * is deliberate — one reload either fixes all of them (the tab picks up the
 * new document) or none of them (the deploy itself is broken), so a second
 * or third attempt is never more likely to help than the first.
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
  const probe = options.probe ?? defaultProbe;

  const guardKey = `cflop:stale-chunk-reload:${import.meta.url}`;

  // Writes the guard and reloads. Called only once a reload has actually
  // been decided on — never before a probe that might still decline, or a
  // declined probe would burn the one reload for this build on nothing.
  function reloadOnce() {
    try {
      if (window.sessionStorage.getItem(guardKey) !== null) {
        return;
      }
      window.sessionStorage.setItem(guardKey, "1");
    } catch {
      // An unreachable sessionStorage (blocked cookies, an enterprise
      // storage policy, a sandboxed iframe) has to leave the broken page on
      // screen rather than guess — see the module-level doc comment above
      // for what guessing here has actually done.
      return;
    }

    reload();
  }

  function handlePreloadError(event: VitePreloadErrorEvent) {
    if (!isStaleChunkError(event.payload)) {
      return;
    }

    const failingModuleUrl = extractFailingModuleUrl(event.payload.message);

    if (failingModuleUrl === null) {
      // Safari's message carries no URL to probe, so there's nothing to
      // confirm against — keep the pre-probe behavior and reload.
      reloadOnce();
      return;
    }

    // The probe is async; this handler is not, and stays that way — reload
    // from the probe's resolution instead.
    void isChunkConfirmedGone(failingModuleUrl, probe).then((gone) => {
      if (gone) {
        reloadOnce();
      }
    });
  }

  window.addEventListener("vite:preloadError", handlePreloadError);
  return () => {
    window.removeEventListener("vite:preloadError", handlePreloadError);
  };
}
