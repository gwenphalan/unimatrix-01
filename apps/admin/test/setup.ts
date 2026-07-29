import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships no `ResizeObserver`, and `ToolShell` mounts a
// `CircuitOccluderProvider` that constructs one unconditionally — any suite
// rendering the shell throws without this inert default. Same shim as
// `packages/chrome/test/setup.ts` and `packages/ui/test/setup.ts`.
if (!("ResizeObserver" in globalThis)) {
  class NoopResizeObserver implements ResizeObserver {
    readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  (globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver;
}

afterEach(() => {
  cleanup();
});
