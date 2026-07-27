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
type MutableRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
};

function Registrant({
  rect,
  onElement,
}: {
  rect: MutableRect;
  onElement?: (el: HTMLDivElement) => void;
}) {
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

function RectsProbe({
  onRects,
}: {
  onRects: (rects: readonly { x0: number; y0: number; x1: number; y1: number }[]) => void;
}) {
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
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} onElement={(el) => (registrantEl = el)} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);

    rect.left = 0;
    rect.right = 200;

    // The registrant's element must actually be under observation — without
    // this, `MockResizeObserver.trigger()` below invokes the callback
    // regardless of what was observed and would mask a missing `observe()`.
    expect(registrantEl).toBeDefined();
    expect(MockResizeObserver.instances[0]?.observed.has(registrantEl as HTMLDivElement)).toBe(
      true,
    );

    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 200, y1: 100 }]);
  });

  it("clamps a registrant's measured height to maxHeightPx", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 100, right: 100, bottom: 3000 });

    function CappedRegistrant() {
      const ref = React.useRef<HTMLDivElement>(null);
      useCircuitOccluder(ref, { maxHeightPx: 900 });

      React.useLayoutEffect(() => {
        if (ref.current)
          ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
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
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

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
      { x0: 0, y0: 0, x1: 100, y1: 100 },
      { x0: 0, y0: 200, x1: 100, y1: 250 },
    ]);
  });

  it("a sub-threshold scroll move does not notify useCircuitOccluderDelta", async () => {
    let latestDelta: Rect[] | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <DeltaProbe onDelta={(d) => (latestDelta = d)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    rect.top = 5;
    rect.bottom = 105;

    await act(async () => {
      scroll();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestDelta).toBeUndefined();
  });

  it("a scroll-triggered measurement does not immediately change useCircuitOccluderRects()'s value", async () => {
    const rectsSeen: (readonly { x0: number; y0: number; x1: number; y1: number }[])[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

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
    expect(rectsSeen[rectsSeen.length - 1]).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
  });

  it("commits the settled rect via useCircuitOccluderRects() once scrolling stops", async () => {
    const rectsSeen: (readonly { x0: number; y0: number; x1: number; y1: number }[])[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => rectsSeen.push(r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    rect.top = 400;
    rect.bottom = 450;

    await act(async () => {
      scroll();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    // Not yet committed — scroll only notifies the delta path immediately.
    expect(rectsSeen[rectsSeen.length - 1]).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);

    // Past SCROLL_SETTLE_MS: the settle timer should have forced a
    // structural commit of the settled rect.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await flushRaf();

    expect(rectsSeen[rectsSeen.length - 1]).toEqual([{ x0: 0, y0: 400, x1: 100, y1: 450 }]);
  }, 10000);

  it("a structural ResizeObserver change does not also notify useCircuitOccluderDelta", async () => {
    let latestDelta: Rect[] | undefined;
    let registrantEl: HTMLDivElement | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

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

  it("many registrants mounting together collapse into one measurement commit", async () => {
    const rectsSeen: (readonly { x0: number; y0: number; x1: number; y1: number }[])[] = [];
    const registrants = Array.from({ length: 12 }, (_, i) =>
      makeRect({ left: i * 200, top: 0, right: i * 200 + 100, bottom: 100 }),
    );

    render(
      <CircuitOccluderProvider>
        {registrants.map((rect, i) => (
          <Registrant key={i} rect={rect} />
        ))}
        <RectsProbe onRects={(r) => rectsSeen.push(r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    // Mount renders the initial (empty) context value once, then the single
    // batched flush commits the full set once — never one commit per
    // registrant, regardless of how many registered in the same pass.
    expect(rectsSeen.length).toBe(2);
    expect(rectsSeen[rectsSeen.length - 1]?.length).toBe(12);
  });

  it("a structural remeasurement that measures identically does not recommit useCircuitOccluderRects()", async () => {
    const rectsSeen: (readonly { x0: number; y0: number; x1: number; y1: number }[])[] = [];
    let registrantEl: HTMLDivElement | undefined;
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} onElement={(el) => (registrantEl = el)} />
        <RectsProbe onRects={(r) => rectsSeen.push(r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(registrantEl).toBeDefined();
    const countAfterMount = rectsSeen.length;
    const rectsAfterMount = rectsSeen[rectsSeen.length - 1];

    // Rect is unchanged — this simulates one registrant's structural flush
    // (e.g. an async status badge resolving) not actually moving anything.
    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(rectsSeen.length).toBe(countAfterMount);
    expect(rectsSeen[rectsSeen.length - 1]).toBe(rectsAfterMount);
  });

  it("skips registering an element narrower than MIN_OCCLUDER_SIDE_PX and warns", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rect = makeRect({ left: 0, top: 0, right: 30, bottom: 100 }); // 30px wide, under the one-grid-cell (40px) floor

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("skipped a registrant smaller than MIN_OCCLUDER_SIDE_PX"),
      expect.anything(),
    );

    warn.mockRestore();
  });

  /**
   * The size floor is enforced per measurement pass, not once at
   * registration: a surface that is still 0-sized on the first passive
   * effect (font/image loading, collapsed accordion, animated-in panel,
   * content behind a suspense boundary that just resolved) must still be
   * observed, so it recovers the moment it reaches its real size. Rejecting
   * at registration time made that unrecoverable — the ResizeObserver only
   * ever watches registered elements.
   */
  it("recovers a registrant that is 0-sized at mount and only later reaches its real size", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 0, bottom: 0 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(latestRects).toEqual([]);

    rect.right = 200;
    rect.bottom = 120;
    await act(async () => {
      MockResizeObserver.instances.forEach((instance) => {
        instance.trigger();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 200, y1: 120 }]);
  });

  it("registers an element at exactly MIN_OCCLUDER_SIDE_PX on both sides", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 40, bottom: 40 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 40, y1: 40 }]);
  });

  it("registers a full-width bar thinner than two grid cells but at least one (a real header/footer shape)", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    // Matches the live regression: a 1392x76 header and a 1392x66 footer
    // were both silently dropped under a two-grid-cell (80px) floor.
    const rect = makeRect({ left: 0, top: 0, right: 1392, bottom: 76 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 1392, y1: 76 }]);
  });

  /**
   * A viewport resize moves registrants without necessarily resizing them —
   * a `max-w-*` panel keeps its width and height while the centering margins
   * around it shift — and `ResizeObserver` fires on size changes only. Left
   * unhandled, the committed rects stay pinned to pre-resize geometry and
   * `CircuitField` (which regenerates on its own resize handler) rebuilds
   * against stale barriers, laying traces straight across the surface.
   */
  it("remeasures on a window resize that moves a registrant without resizing it", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 100, top: 200, right: 500, bottom: 400 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(latestRects).toEqual([{ x0: 100, y0: 200, x1: 500, y1: 400 }]);

    // Same 400x200 box, moved — exactly what ResizeObserver stays silent on.
    rect.left = 100;
    rect.right = 500;
    rect.top = 40;
    rect.bottom = 240;

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(latestRects).toEqual([{ x0: 100, y0: 40, x1: 500, y1: 240 }]);
  });

  it("stamps data-circuit-occluder on register and removes it on unregister", async () => {
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });
    let registrantEl: HTMLDivElement | undefined;

    const { unmount } = render(
      <CircuitOccluderProvider>
        <Registrant onElement={(el) => (registrantEl = el)} rect={rect} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();
    expect(registrantEl?.getAttribute("data-circuit-occluder")).toBe("surface");

    unmount();
    expect(registrantEl?.getAttribute("data-circuit-occluder")).toBeNull();
  });

  it("warns (but still registers) when the ref points at an interactive element", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    function LinkRegistrant() {
      const ref = React.useRef<HTMLAnchorElement>(null);
      useCircuitOccluder(ref);

      React.useLayoutEffect(() => {
        if (ref.current)
          ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
      }, []);

      return <a href="/somewhere" ref={ref} />;
    }

    render(
      <CircuitOccluderProvider>
        <LinkRegistrant />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("interactive element (button/link/input)"),
      expect.anything(),
    );

    warn.mockRestore();
  });

  it("useCircuitOccluder outside a Provider warns instead of throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Orphan() {
      const ref = React.useRef<HTMLDivElement>(null);
      useCircuitOccluder(ref);
      return <div ref={ref} />;
    }

    expect(() => render(<Orphan />)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("useCircuitOccluder called outside a CircuitOccluderProvider"),
    );

    warn.mockRestore();
  });

  /**
   * Regression guard for a real live bug: under React.StrictMode, the
   * measurement-scheduling effect mounts, is immediately cleaned up
   * (StrictMode's simulated unmount), then remounts. The cleanup used to
   * cancel the pending rAF without resetting `rafRef.current` back to
   * `null` — the remount's own `scheduleMeasure()` call then saw a
   * non-null (but already-cancelled) handle and silently never scheduled
   * a replacement, so `flush()` never ran again and `useCircuitOccluderRects()`
   * stayed `[]` forever, i.e. every occluder in the app was permanently
   * invisible to `CircuitField`. Confirmed live: `apps/web` mounts under
   * `React.StrictMode`, and this exact sequence made hard-barrier
   * enforcement a silent no-op in the running app despite every unit test
   * (none of which render under StrictMode) passing.
   */
  it("still populates rects after React.StrictMode's simulated mount->unmount->remount", async () => {
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

    render(
      <React.StrictMode>
        <CircuitOccluderProvider>
          <Registrant rect={rect} />
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>
      </React.StrictMode>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
  });
});
