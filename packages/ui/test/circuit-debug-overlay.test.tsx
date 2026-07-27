import * as React from "react";

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CircuitDebugOverlay } from "../src/components/circuit-debug-overlay.js";
import { setCircuitDebug } from "../src/components/circuit-debug.js";
import { GRID } from "../src/components/grid-math.js";
import type { Occluder } from "../src/components/occlusion.js";

// No `CircuitOccluderProvider` needed: `useCircuitOccluderDelta` no-ops
// (its context default is an inert subscribe function) outside one, exactly
// like calling it from a `CircuitField` mounted without a provider — no
// ResizeObserver/scroll wiring required for this component's own contract.
afterEach(() => {
  // No manual DOM cleanup here — @testing-library/react's own afterEach
  // (registered globally) unmounts the render tree, which tears down the
  // portal itself; removing the node here too would race it.
  //
  // Wrapped in `act` because this file's hook runs *before* that global one
  // (vitest runs `afterEach` hooks in reverse registration order, and the
  // setup file registers first): the overlay is therefore still mounted and
  // subscribed here, so flipping the store updates a live component.
  act(() => {
    setCircuitDebug(false);
  });
});

function renderOverlay(
  occluders: Occluder[],
  gridPhase: { x: number; y: number } = { x: 0, y: 0 },
) {
  return render(<CircuitDebugOverlay gridPhase={gridPhase} occluders={occluders} />);
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

    const rawRects = svg?.querySelectorAll("rect[stroke-dasharray]");
    expect(rawRects?.length).toBe(2);
  });

  /**
   * `CircuitField` builds barriers from `-gridPhase`-shifted rects and renders
   * its content `<g>` translated by `+gridPhase`. The overlay has to do that
   * same round trip or its blocked cells land a phase offset away from the
   * lattice actually on screen — which read live as the whole barrier field
   * being nudged down and to the right of the surface it belongs to.
   */
  it("draws blocked cells at the phase-shifted lattice the field actually renders", () => {
    act(() => {
      setCircuitDebug(true, { cells: true });
    });
    const occluders: Occluder[] = [{ x0: 200, y0: 200, x1: 400, y1: 400 }];
    const phase = { x: 34, y: 12 };

    const cells = () =>
      Array.from(document.body.querySelectorAll("svg rect:not([stroke])")).map((el) => ({
        x: Number(el.getAttribute("x")),
        y: Number(el.getAttribute("y")),
      }));

    renderOverlay(occluders, phase);
    const drawn = cells();
    expect(drawn.length).toBeGreaterThan(0);

    // Every cell is centered on a real rendered lattice point: `cx * GRID +
    // gridPhase`. Drawing them on the unshifted lattice (the bug) leaves
    // every centre off by the phase instead.
    for (const cell of drawn) {
      expect((cell.x + GRID / 2 - phase.x) % GRID).toBe(0);
      expect((cell.y + GRID / 2 - phase.y) % GRID).toBe(0);
    }

    // ...and they still sit over the surface they belong to, rather than
    // being flung a phase away from it. Only within one cell: a blocked cell
    // is a lattice *point*, and the last point inside the buffered rect can
    // be up to a full cell in from its edge.
    const rect = occluders[0] as Occluder;
    const xs = drawn.map((c) => c.x);
    const ys = drawn.map((c) => c.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(rect.x0 + GRID);
    expect(Math.max(...xs) + GRID).toBeGreaterThanOrEqual(rect.x1 - GRID);
    expect(Math.min(...ys)).toBeLessThanOrEqual(rect.y0 + GRID);
    expect(Math.max(...ys) + GRID).toBeGreaterThanOrEqual(rect.y1 - GRID);
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
