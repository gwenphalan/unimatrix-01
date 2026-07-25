import * as React from "react";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircuitOccluderProvider,
  useCircuitOccluder,
  useCircuitOccluderDelta,
  useCircuitOccluderRects,
} from "../src/components/circuit-occluder.js";
import type { Rect } from "../src/components/occlusion.js";

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

function Registrant({ rect, onElement }: { rect: MutableRect; onElement?: (el: HTMLDivElement) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useCircuitOccluder(ref);

  React.useLayoutEffect(() => {
    if (ref.current) {
      ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
      onElement?.(ref.current);
    }
  }, [rect, onElement]);

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

function DeltaProbe({ onDelta }: { onDelta: (dirtyRects: Rect[]) => void }) {
  useCircuitOccluderDelta(onDelta);
  return null;
}

async function flushRaf(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

function scroll(): void {
  window.dispatchEvent(new Event("scroll"));
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
    let registrantEl: HTMLDivElement | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} onElement={(el) => (registrantEl = el)} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 50, y1: 50 }]);

    rect.left = 0;
    rect.right = 200;

    // The registrant's element must actually be under observation — without
    // this, `MockResizeObserver.trigger()` below invokes the callback
    // regardless of what was observed and would mask a missing `observe()`.
    expect(registrantEl).toBeDefined();
    expect(MockResizeObserver.instances[0]?.observed.has(registrantEl as HTMLDivElement)).toBe(true);

    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 200, y1: 50 }]);
  });

  it("clamps a registrant's measured height to maxHeightPx", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 100, right: 100, bottom: 3000 });

    function CappedRegistrant() {
      const ref = React.useRef<HTMLDivElement>(null);
      useCircuitOccluder(ref, { maxHeightPx: 900 });

      React.useLayoutEffect(() => {
        if (ref.current) ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
      }, []);

      return <div ref={ref} />;
    }

    render(
      <CircuitOccluderProvider>
        <CappedRegistrant />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 100, x1: 100, y1: 1000 }]);
  });

  it("a scroll event beyond the delta threshold notifies useCircuitOccluderDelta with the moved rect", async () => {
    let latestDelta: Rect[] | undefined;
    let registrantEl: HTMLDivElement | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} onElement={(el) => (registrantEl = el)} />
        <DeltaProbe onDelta={(d) => (latestDelta = d)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(registrantEl).toBeDefined();

    rect.top = 200;
    rect.bottom = 250;

    await act(async () => {
      scroll();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestDelta).toEqual([
      { x0: 0, y0: 0, x1: 50, y1: 50 },
      { x0: 0, y0: 200, x1: 50, y1: 250 },
    ]);
  });

  it("a sub-threshold scroll move does not notify useCircuitOccluderDelta", async () => {
    let latestDelta: Rect[] | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <DeltaProbe onDelta={(d) => (latestDelta = d)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    rect.top = 5;
    rect.bottom = 55;

    await act(async () => {
      scroll();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestDelta).toBeUndefined();
  });

  it("a scroll-triggered measurement never changes useCircuitOccluderRects()'s value", async () => {
    const rectsSeen: (readonly { x0: number; y0: number; x1: number; y1: number }[])[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => rectsSeen.push(r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    const countBeforeScroll = rectsSeen.length;

    rect.top = 400;
    rect.bottom = 450;

    await act(async () => {
      scroll();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(rectsSeen.length).toBe(countBeforeScroll);
    expect(rectsSeen[rectsSeen.length - 1]).toEqual([{ x0: 0, y0: 0, x1: 50, y1: 50 }]);
  });

  it("a structural ResizeObserver change does not also notify useCircuitOccluderDelta", async () => {
    let latestDelta: Rect[] | undefined;
    let registrantEl: HTMLDivElement | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 50, bottom: 50 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} onElement={(el) => (registrantEl = el)} />
        <DeltaProbe onDelta={(d) => (latestDelta = d)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(registrantEl).toBeDefined();

    rect.right = 300;

    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestDelta).toBeUndefined();
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
