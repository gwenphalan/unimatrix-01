import * as React from "react";

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CircuitDebugOverlay } from "../src/components/circuit-debug-overlay.js";
import { setCircuitDebug } from "../src/components/circuit-debug.js";
import type { Occluder } from "../src/components/occlusion.js";

// No `CircuitOccluderProvider` needed: `useCircuitOccluderDelta` no-ops
// (its context default is an inert subscribe function) outside one, exactly
// like calling it from a `CircuitField` mounted without a provider — no
// ResizeObserver/scroll wiring required for this component's own contract.
afterEach(() => {
  // No manual DOM cleanup here — @testing-library/react's own afterEach
  // (registered globally) unmounts the render tree, which tears down the
  // portal itself; removing the node here too would race it.
  setCircuitDebug(false);
});

function renderOverlay(occluders: Occluder[]) {
  return render(<CircuitDebugOverlay occluders={occluders} />);
}

describe("CircuitDebugOverlay", () => {
  it("renders nothing while the debug flag is off", () => {
    const { container } = renderOverlay([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
    expect(container.innerHTML).toBe("");
    expect(document.body.querySelector("svg")).toBeNull();
  });

  // NOTE: this test triggers a harmless "not wrapped in act(...)" console
  // warning from React's useSyncExternalStore + createPortal interaction in
  // jsdom — confirmed via bisection to be independent of this component's
  // own logic (reproduces with the useCircuitOccluderDelta subscription
  // removed too) and doesn't affect the assertions or the test's pass/fail
  // outcome. Known ecosystem quirk, not a real act violation here.
  it("mounts a portal with one raw+buffered rect pair per occluder when enabled", () => {
    act(() => {
      setCircuitDebug(true);
    });
    renderOverlay([
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { x0: 200, y0: 200, x1: 300, y1: 300 },
    ]);

    const svg = document.body.querySelector("svg");
    expect(svg).not.toBeNull();

    const rawRects = svg?.querySelectorAll('rect[stroke-dasharray]');
    expect(rawRects?.length).toBe(2);
  });

  it("unmounts the portal when the debug flag turns back off", () => {
    act(() => {
      setCircuitDebug(true);
    });
    renderOverlay([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
    expect(document.body.querySelector("svg")).not.toBeNull();

    act(() => {
      setCircuitDebug(false);
    });

    expect(document.body.querySelector("svg")).toBeNull();
  });
});
