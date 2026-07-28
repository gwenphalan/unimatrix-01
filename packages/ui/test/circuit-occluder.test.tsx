import * as React from "react";

import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CircuitOccluderProvider,
  MAX_SCANS_PER_SECOND,
  MUTATION_BACKOFF_MS,
  MUTATION_SETTLE_MS,
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
      ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) });
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

/**
 * Measured rects are clamped to the viewport, and jsdom's is 1024x768 with a
 * `documentElement.clientWidth` of 0. Several cases below use deliberately
 * large synthetic geometry (a 1392px-wide header bar, a 1000px-tall panel), so
 * without a viewport big enough to contain the stubs the clamp would trim them
 * and the assertions would be measuring the fixture rather than the behaviour.
 */
function stubViewport(width: number, height: number): void {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: height,
  });
}

describe("CircuitOccluderProvider / useCircuitOccluder", () => {
  beforeEach(() => {
    MockResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    stubViewport(4000, 4000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document.documentElement, "clientWidth");
    Reflect.deleteProperty(document.documentElement, "clientHeight");
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

  it("clamps a taller-than-viewport registrant to the viewport, keeping it fully occluding", async () => {
    // Replaces an earlier `maxHeightPx` cap that let a long article panel stop
    // occluding past a fixed height — traces then ran behind its lower half.
    // The viewport is now the only bound: everything on screen occludes, and
    // the clamp exists purely to keep the lattice loop from walking rows that
    // aren't visible anyway.
    stubViewport(1024, 768);
    let latestRects: readonly { x0: number; y0: number; x1: number; y1: number }[] = [];
    const rect = makeRect({ left: 0, top: 100, right: 100, bottom: 3000 });

    render(
      <CircuitOccluderProvider>
        <Registrant rect={rect} />
        <RectsProbe onRects={(r) => (latestRects = r)} />
      </CircuitOccluderProvider>,
    );

    await flushRaf();

    expect(latestRects).toEqual([{ x0: 0, y0: 100, x1: 100, y1: 768 }]);
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
          ref.current.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) });
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

  /**
   * Automatic discovery. jsdom reflects inline styles through
   * `getComputedStyle` but reports every rect as zero-sized, so a discoverable
   * surface here is an inline background plus a stubbed box — which is enough to
   * exercise the real classifier rather than a mock of it.
   */
  describe("automatic discovery", () => {
    // Discovery walks the whole of `document.body`, so anything appended here
    // outlives its own test unless it is tracked and removed — testing-library's
    // `cleanup` only removes its own render containers, and a leaked surface
    // shows up as a phantom extra rect in every later case.
    let appended: Element[] = [];

    function boxAt(el: Element, left: number, top: number, width: number, height: number): void {
      el.getBoundingClientRect = () => ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
      });
    }

    function discoverable(width: number, height: number): HTMLDivElement {
      const el = document.createElement("div");
      el.style.backgroundColor = "rgb(255, 0, 0)";
      boxAt(el, 200, 300, width, height);

      return el;
    }

    function attach(el: Element): void {
      appended.push(el);
      document.body.append(el);
    }

    afterEach(() => {
      vi.useRealTimers();
      appended.forEach((el) => {
        el.remove();
      });
      appended = [];
    });

    it("discovers a painting surface with no registration at all", async () => {
      let latestRects: readonly Rect[] = [];
      attach(discoverable(300, 200));

      render(
        <CircuitOccluderProvider>
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();

      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);
    });

    /**
     * The no-double-count rule. `useCircuitOccluder` stamps
     * `data-circuit-occluder="surface"`, and the scan skips that element *and*
     * its subtree, so the manual registry keeps sole ownership of its rect.
     */
    it("does not double-count a manually registered surface", async () => {
      let latestRects: readonly Rect[] = [];
      const rect = makeRect({ left: 0, top: 0, right: 100, bottom: 100 });

      render(
        <CircuitOccluderProvider>
          <Registrant rect={rect} />
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();

      expect(latestRects).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
    });

    it("commits newly inserted content after the mutation settles", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      let latestRects: readonly Rect[] = [];

      render(
        <CircuitOccluderProvider>
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();
      expect(latestRects).toEqual([]);

      attach(discoverable(300, 200));
      // The MutationObserver callback is a microtask; the rescan behind it is
      // debounced by `MUTATION_SETTLE_MS`.
      await Promise.resolve();
      act(() => {
        vi.advanceTimersByTime(MUTATION_SETTLE_MS);
      });
      await flushRaf();

      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);
    });

    /**
     * The filter that makes observing `style` attributes affordable at all:
     * `CircuitField`'s animation loop writes `style.opacity` on its own SVG
     * children every frame, so without this every rendered frame would queue a
     * rescan and the debounce would never drain.
     */
    it("ignores style mutations inside its own field layer", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      const field = document.createElement("div");
      field.setAttribute("data-circuit-field", "");
      const animated = discoverable(300, 200);
      field.append(animated);
      attach(field);

      let commits = 0;

      render(
        <CircuitOccluderProvider>
          <RectsProbe
            onRects={() => {
              commits += 1;
            }}
          />
        </CircuitOccluderProvider>,
      );

      await flushRaf();
      const baseline = commits;

      for (let frame = 0; frame < 10; frame += 1) {
        animated.style.opacity = String(frame / 10);
      }
      await Promise.resolve();
      act(() => {
        vi.advanceTimersByTime(MUTATION_BACKOFF_MS * 2);
      });
      await flushRaf();

      // No rescan, and nothing inside the field layer was ever discovered.
      expect(commits).toBe(baseline);
    });

    /**
     * A CSS transition mutates no attribute when it finishes, so neither
     * observer sees the settle — `apps/web`'s condensed header fades over 300ms
     * and would otherwise leave a stale mid-transition occluder behind.
     */
    it("rescans on transitionend", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      let latestRects: readonly Rect[] = [];
      const transitioning = discoverable(300, 200);
      attach(transitioning);

      render(
        <CircuitOccluderProvider>
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();
      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);

      // Geometry changes with no DOM mutation whatsoever — the stub function is
      // swapped, no attribute or child is touched. Neither observer can see
      // this, so a commit afterwards proves the transition event is what
      // triggered the remeasure. A real transition ends the same way: the final
      // computed style differs from the one the last scan read, with nothing
      // mutated to announce it.
      boxAt(transitioning, 200, 300, 300, 400);

      window.dispatchEvent(new Event("transitionend"));
      act(() => {
        vi.advanceTimersByTime(MUTATION_SETTLE_MS);
      });
      await flushRaf();

      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 700 }]);
    });

    /**
     * The counterpart to the case above, and the one that keeps a pointer sweep
     * from re-deriving the whole occluder set: measured in Chromium on `apps/web`
     * `/about`, four hovers fired 38 `transitionend` events, 34 of them colour
     * properties, driving 260 `getComputedStyle` calls from an idle baseline of
     * zero. A colour transition cannot move an element, so it cannot invalidate
     * geometry the way the opacity fade above does.
     */
    it("ignores a colour transition ending", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

      let latestRects: readonly Rect[] = [];
      const transitioning = discoverable(300, 200);
      attach(transitioning);

      render(
        <CircuitOccluderProvider>
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();
      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);

      boxAt(transitioning, 200, 300, 300, 400);

      const colourEnd = new Event("transitionend");
      // `TransitionEvent` is not constructible in this jsdom, and the handler
      // reads `propertyName` off the event rather than instanceof-checking it.
      Object.defineProperty(colourEnd, "propertyName", { value: "background-color" });
      window.dispatchEvent(colourEnd);
      act(() => {
        vi.advanceTimersByTime(MUTATION_SETTLE_MS);
      });
      await flushRaf();

      // Still the pre-transition geometry: no rescan ran, so the new box was
      // never measured.
      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);
    });

    it("stretches the debounce once the scan rate is exceeded", async () => {
      // `Date` is faked alongside the timers, not left real: the backoff branch
      // compares `Date.now()` against the timestamps of the last
      // `MAX_SCANS_PER_SECOND` scans, so with a real clock this test would
      // depend on the four burn iterations below finishing within one wall-clock
      // second — fine locally, a flake on a loaded runner. Faked, each
      // `advanceTimersByTime` moves the same clock the provider reads, and the
      // four scans land 120ms apart deterministically.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

      let latestRects: readonly Rect[] = [];

      render(
        <CircuitOccluderProvider>
          <RectsProbe onRects={(r) => (latestRects = r)} />
        </CircuitOccluderProvider>,
      );

      await flushRaf();

      // Burn through the per-second scan budget.
      for (let i = 0; i < MAX_SCANS_PER_SECOND; i += 1) {
        attach(document.createElement("span"));
        await Promise.resolve();
        act(() => {
          vi.advanceTimersByTime(MUTATION_SETTLE_MS);
        });
        await flushRaf();
      }

      attach(discoverable(300, 200));
      await Promise.resolve();

      // The normal settle window is no longer enough.
      act(() => {
        vi.advanceTimersByTime(MUTATION_SETTLE_MS);
      });
      await flushRaf();
      expect(latestRects).toEqual([]);

      act(() => {
        vi.advanceTimersByTime(MUTATION_BACKOFF_MS);
      });
      await flushRaf();
      expect(latestRects).toEqual([{ x0: 200, y0: 300, x1: 500, y1: 500 }]);
    });
  });
});
