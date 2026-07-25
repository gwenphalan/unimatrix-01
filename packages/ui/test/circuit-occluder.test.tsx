import * as React from "react";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CircuitOccluderProvider, useCircuitOccluder, useCircuitOccluderRects } from "../src/components/circuit-occluder.js";

type ObserveCallback = ResizeObserverCallback;

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = [];
  observed = new Set<Element>();

  constructor(private callback: ObserveCallback) {
    MockResizeObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }

  trigger(): void {
    this.callback([], this);
  }
}

// A mutable stand-in for DOMRect (whose own properties are readonly) — the
// tests mutate this in place to simulate a registrant resizing, then read it
// back through a `getBoundingClientRect` stub cast to `DOMRect` at the point
// of use.
type MutableRect = { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number };

function Registrant({ rect }: { rect: MutableRect }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useCircuitOccluder(ref);

  React.useLayoutEffect(() => {
    if (ref.current) ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
  }, [rect]);

  return <div ref={ref} />;
}

function makeRect(overrides: Partial<MutableRect>): MutableRect {
  return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, ...overrides };
}

function RectsProbe({ onRects }: { onRects: (rects: readonly { x0: number; y0: number; x1: number; y1: number }[]) => void }) {
  const rects = useCircuitOccluderRects();
  onRects(rects);
  return null;
}

describe("CircuitOccluderProvider / useCircuitOccluder", () => {
  beforeEach(() => {
    MockResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers a ref's element and reports its measured rect", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 10, top: 20, right: 110, bottom: 220 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    // The registry's rAF-batched measurement runs on the next animation
    // frame after registration — flush it explicitly rather than relying
    // on the initial render's synchronous pass.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 10, y0: 20, x1: 110, y1: 220 }]);
  });

  it("re-measures when the shared ResizeObserver fires", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 50, y1: 50 }]);

    rect.left = 0;
    rect.right = 200;

    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 200, y1: 50 }]);
  });

  it("useCircuitOccluder outside a Provider warns instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Orphan() {
      const ref = React.useRef<HTMLDivElement>(null);
      useCircuitOccluder(ref);
      return <div ref={ref} />;
    }

    expect(() => render(<Orphan />)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("useCircuitOccluder called outside a CircuitOccluderProvider"));

    warn.mockRestore();
  });
});
