// Console-only debug toggle for CircuitField's hard-barrier geometry — never
// a UI control, on purpose, so it can't accidentally ship visible in a
// production screenshot. Enable from a browser console with
// `window.__circuitField.debug(true)`; see `installCircuitDebugConsoleApi`.

export type CircuitDebugState = { readonly enabled: boolean; readonly cells: boolean };

export type CircuitDebugOptions = { cells?: boolean };

let state: CircuitDebugState = Object.freeze({ enabled: false, cells: false });
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => { listener(); });
}

/**
 * Returns the frozen current snapshot — the same object identity until
 * `setCircuitDebug` actually changes something, which is what
 * `React.useSyncExternalStore` in the overlay requires (a fresh object per
 * call would re-render forever). Frozen so a console caller poking at the
 * returned object can't desync the store: a silent mutation here would make
 * later `setCircuitDebug` calls short-circuit on the equality check below
 * while the overlay still renders the old state.
 */
export function getCircuitDebugState(): CircuitDebugState {
  return state;
}

export function isCircuitDebugEnabled(): boolean {
  return state.enabled;
}

export function setCircuitDebug(on: boolean, options?: CircuitDebugOptions): void {
  const next: CircuitDebugState = Object.freeze({
    enabled: on,
    cells: on ? (options?.cells ?? state.cells) : false,
  });
  if (next.enabled === state.enabled && next.cells === state.cells) return;
  state = next;
  notify();
}

/** For `React.useSyncExternalStore` in the debug overlay. */
export function subscribeCircuitDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type CircuitDebugConsoleApi = {
  debug: (on?: unknown, options?: unknown) => CircuitDebugState;
  state: () => CircuitDebugState;
};

declare global {
  interface Window {
    __circuitField?: CircuitDebugConsoleApi;
  }
}

/**
 * A browser console hands this untyped JavaScript — `debug("yes")`,
 * `debug(1, "cells")`, `debug(true, null)` are all things a human actually
 * types. Coerced rather than rejected: this is a console affordance, and the
 * useful reading of every one of those is obvious. Hand-rolled instead of
 * Zod-schema'd on purpose — `packages/ui` has no `zod` dependency, and
 * pulling a runtime validator into the shared UI package for a debug-only
 * console toggle costs every consuming app bundle size for one two-field
 * boundary.
 */
function parseDebugArgs(on: unknown, options: unknown): { on: boolean; options: CircuitDebugOptions } {
  const cells =
    typeof options === "object" && options !== null && "cells" in options
      ? Boolean((options as { cells?: unknown }).cells)
      : undefined;

  return { on: on === undefined ? true : Boolean(on), options: cells === undefined ? {} : { cells } };
}

/**
 * Installs `window.__circuitField.debug(...)`/`.state()` — the only way to
 * toggle the barrier-geometry overlay, deliberately never exposed as a UI
 * control. Idempotent (safe to call from every `CircuitField` mount) and a
 * no-op outside a browser (`typeof window === "undefined"`, e.g. during
 * `packages/ui`'s own `tsc` build or a Node-based test). Not gated on
 * `import.meta.env.DEV`: `packages/ui` doesn't read Vite env anywhere else
 * and is consumed by three separately-configured apps plus a plain `tsc`
 * build for the auth app's tests — installing an inert function object
 * costs nothing, and nothing renders until a real console call flips it on.
 */
export function installCircuitDebugConsoleApi(): void {
  if (typeof window === "undefined") return;
  if (window.__circuitField) return;

  window.__circuitField = {
    debug: (on, options) => {
      const parsed = parseDebugArgs(on, options);
      setCircuitDebug(parsed.on, parsed.options);
      return state;
    },
    state: () => state,
  };
}
