import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GraphBackground } from "../src/components/graph-background.js";

const GRID = 40;
const BOLD_GRID = 240;

/**
 * Sets the viewport `documentElement` reports. The component measures
 * `clientWidth`/`clientHeight` rather than `window.innerWidth`, and jsdom
 * leaves both at 0, so every case has to declare its own extent.
 */
function setViewport(width: number, height: number): void {
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(height);
}

function phase(property: string): number {
  return Number.parseFloat(document.documentElement.style.getPropertyValue(property));
}

afterEach(() => {
  // `restoreAllMocks` does not undo `stubGlobal`, and `unstubGlobals` is not set
  // in the shared vitest config — so without this, a case that fails *before* its
  // own cleanup line leaves its fake `ResizeObserver` installed for every case
  // after it. Reproduced before adding it.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("style");
});

describe("GraphBackground", () => {
  it("renders nothing", () => {
    setViewport(1440, 900);

    const { container } = render(<GraphBackground />);

    expect(container).toBeEmptyDOMElement();
  });

  it("puts a fine line exactly on the viewport centerline", () => {
    // 1000/2 = 500; 500 % 40 = 20. Lines land at 20 + n*40, and 500 is one of
    // them (20 + 12*40), which is the property the phase exists to guarantee.
    setViewport(1000, 700);

    render(<GraphBackground />);

    const x = phase("--grid-phase-x");
    expect(x).toBe(20);
    expect((1000 / 2 - x) % GRID).toBe(0);

    const y = phase("--grid-phase-y");
    expect((700 / 2 - y) % GRID).toBe(0);
  });

  it("puts the centerline mid bold cell, not on a bold line", () => {
    setViewport(1000, 700);

    render(<GraphBackground />);

    const boldX = phase("--grid-bold-phase-x");
    // Distance from the centerline to the nearest bold line must be half a
    // bold tile — the whole point of the half-tile offset. If the bold phase
    // were left equal to `latticePhase`, this would be 0 and centered content
    // would be split down the seam.
    const offset = (((1000 / 2 - boldX) % BOLD_GRID) + BOLD_GRID) % BOLD_GRID;
    expect(offset).toBe(BOLD_GRID / 2);
  });

  it("keeps every bold line sitting on a fine line", () => {
    setViewport(1337, 911);

    render(<GraphBackground />);

    // 240 and the 120px half-tile offset are both whole multiples of 40, so
    // the two tiers stay seam-locked at any viewport. Asserted on a
    // deliberately non-round one.
    expect((phase("--grid-bold-phase-x") - phase("--grid-phase-x")) % GRID).toBe(0);
    expect((phase("--grid-bold-phase-y") - phase("--grid-phase-y")) % GRID).toBe(0);
  });

  it("recomputes when documentElement resizes", () => {
    let notify: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
    setViewport(1000, 700);

    render(<GraphBackground />);
    expect(phase("--grid-phase-x")).toBe(20);

    // A vertical scrollbar appearing changes `clientWidth` with no matching
    // `innerWidth` change — the exact case a `useViewportSize` dependency
    // misses and this observer exists to catch.
    setViewport(985, 700);
    notify?.();

    expect(phase("--grid-phase-x")).toBe((((985 / 2) % GRID) + GRID) % GRID);
  });

  it("disconnects its observer on unmount", () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect = disconnect;
      },
    );
    setViewport(1000, 700);

    render(<GraphBackground />).unmount();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
