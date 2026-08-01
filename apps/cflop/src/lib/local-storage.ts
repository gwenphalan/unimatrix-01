/**
 * The one place this app decides what its `localStorage` keys look like.
 *
 * Four separate key families live behind it (`progress:<setId>`,
 * `pool:<setId>`, `preview-mode:<scope>`, `algorithm-set`). Routing all four
 * through here is what keeps the legacy-prefix fallback below a single
 * implementation rather than four that can drift.
 */

/** Namespace for every key this app owns. */
const KEY_PREFIX = "cflop";

/**
 * The namespace used before the CFLOP rebrand.
 *
 * Reads fall through to it when the current key is absent, because the rename
 * would otherwise wipe every existing user's learned-case progress and training
 * pool — silently, with no error and nothing in the UI to suggest the data ever
 * existed. Writes only ever target {@link KEY_PREFIX}, so a user's first write
 * after the rename carries their data forward (each writer merges over a read)
 * and subsequent reads stop consulting the legacy key.
 *
 * Reading deliberately does not copy the value forward: reads happen in render
 * paths, and a read that writes is a worse trade than leaving a stale duplicate
 * key behind. A user who never writes again keeps reading correctly from the
 * legacy key forever, which is the outcome we want.
 */
const LEGACY_KEY_PREFIX = "cube-trainer";

function getItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage can be unavailable (private browsing, quota).
    return null;
  }
}

/**
 * Reads the value for `suffix`, falling back to the pre-rebrand key when the
 * current one has never been written.
 */
export function readStoredValue(suffix: string): string | null {
  return getItem(`${KEY_PREFIX}:${suffix}`) ?? getItem(`${LEGACY_KEY_PREFIX}:${suffix}`);
}

/** Writes `value` for `suffix`, always under the current key prefix. */
export function writeStoredValue(suffix: string, value: string): void {
  try {
    window.localStorage.setItem(`${KEY_PREFIX}:${suffix}`, value);
  } catch {
    // Storage can be unavailable (private browsing, quota). Every caller treats
    // its state as best-effort and safe to drop silently in that case.
  }
}
