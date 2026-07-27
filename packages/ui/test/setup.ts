import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

// jsdom ships no `ResizeObserver`, so components that construct one
// unconditionally (`CircuitField`'s grid-phase effect, the occluder provider)
// throw on mount in every suite. This inert default just lets them mount;
// suites that actually assert on observer behaviour still `vi.stubGlobal` a
// controllable mock over it (see `circuit-occluder.test.tsx`), and the
// `if` guard keeps this from clobbering such a stub on re-entry.
if (!("ResizeObserver" in globalThis)) {
  class NoopResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }

  (globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver })
    .ResizeObserver = NoopResizeObserver;
}

afterEach(() => {
  cleanup();
});
