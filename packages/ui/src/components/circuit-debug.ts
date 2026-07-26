// Console-only debug toggle for CircuitField's hard-barrier geometry — never
// a UI control, on purpose, so it can't accidentally ship visible in a
// production screenshot. Enable from a browser console with
// `window.__circuitField.debug(true)`; see `installCircuitDebugConsoleApi`.

export type CircuitDebugState = { enabled: boolean; cells: boolean };

let state: CircuitDebugState = { enabled: false, cells: false };
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => { listener(); });
}

export function getCircuitDebugState(): CircuitDebugState {
  return state;
}

export function isCircuitDebugEnabled(): boolean {
  return state.enabled;
}

export function setCircuitDebug(on: boolean, options?: { cells?: boolean }): void {
  const next: CircuitDebugState = { enabled: on, cells: on ? (options?.cells ?? state.cells) : false };
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

declare global {
  interface Window {
    __circuitField?: {
      debug: (on?: boolean, options?: { cells?: boolean }) => CircuitDebugState;
      state: () => CircuitDebugState;
    };
  }
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
    debug: (on = true, options) => {
      setCircuitDebug(on, options);
      return state;
    },
    state: () => state,
  };
}
