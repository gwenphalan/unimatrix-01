import { act, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CircuitField } from "../src/components/circuit-field.js";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/**
 * jsdom has no `matchMedia`/reports `hardwareConcurrency: undefined`, so
 * `decideMotionMode` resolves to `full` here by default (see capability.ts's
 * decision order) — this suite relies on that to exercise Session E2's
 * idle-loop lifecycle without needing to stub media queries.
 */
describe("CircuitField idle loop (full mode)", () => {
  const originalRAF = window.requestAnimationFrame.bind(window);
  let rafCallCount = 0;

  beforeEach(() => {
    rafCallCount = 0;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      rafCallCount += 1;
      return originalRAF(callback);
    }) as typeof window.requestAnimationFrame;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRAF;
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
  });

  it("keeps scheduling frames once boot settles, with zero in-flight transitions", async () => {
    render(<CircuitField routeKey="route-idle" />);

    await act(async () => {
      await nextFrame();
    });
    const callsAfterMount = rafCallCount;
    expect(callsAfterMount).toBeGreaterThan(0);

    // Boot is a pure CSS stagger -- it never populates transitionsRef, so if
    // the idle loop weren't keeping ensureLoop's rAF chain alive on its own,
    // scheduling would stop here. It shouldn't: `full` mode's idle producers
    // require the shared loop to run permanently.
    await act(async () => {
      await nextFrame();
      await nextFrame();
      await nextFrame();
    });

    expect(rafCallCount).toBeGreaterThan(callsAfterMount);
  });

  it("stops scheduling while hidden and resumes on show, even with nothing in flight", async () => {
    render(<CircuitField routeKey="route-idle-2" />);
    await act(async () => {
      await nextFrame();
    });

    setHidden(true);
    const callsRightAfterHide = rafCallCount;

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(rafCallCount).toBe(callsRightAfterHide);

    setHidden(false);
    await act(async () => {
      await nextFrame();
    });

    expect(rafCallCount).toBeGreaterThan(callsRightAfterHide);
  });

  it("does not spawn a packet on the very first frame back from a hide (no post-show burst)", async () => {
    const { container } = render(<CircuitField routeKey="route-idle-3" />);
    await act(async () => {
      await nextFrame();
    });

    setHidden(true);
    setHidden(false);

    await act(async () => {
      await nextFrame();
    });

    const visiblePackets = Array.from(container.querySelectorAll(".circuit-field-packet")).filter(
      (el) => (el as SVGRectElement).style.opacity === "1",
    );
    expect(visiblePackets.length).toBe(0);
  });

  /**
   * Regression guard for the stale-`runTick`-closure bug (see the
   * `runTickRef`/`scheduleTick` trampoline in circuit-field.tsx). Deliberately
   * asserts the loop makes *progress* — rendered path geometry actually
   * advances — not merely that frames get scheduled: the bug's whole signature
   * was a loop that ran forever at 60fps while processing a pinned
   * `traceIds: []` closure, so every scheduling-based assertion in this file
   * passed while the field was visibly frozen in a real browser.
   */
  it("advances rendered geometry on a routeKey change that lands after mount", async () => {
    const { container, rerender } = render(<CircuitField routeKey="route-progress-a" />);

    await act(async () => {
      for (let i = 0; i < 4; i += 1) await nextFrame();
    });

    const paths = () =>
      Array.from(container.querySelectorAll("path")).map((el) => el.getAttribute("d") ?? "");
    const booted = paths();
    expect(booted.length).toBeGreaterThan(0);
    expect(booted.some((d) => d.length > 0)).toBe(true);

    rerender(<CircuitField routeKey="route-progress-b" />);

    await act(async () => {
      for (let i = 0; i < 8; i += 1) await nextFrame();
    });

    const crawling = paths();
    expect(crawling.filter((d, i) => d !== booted[i]).length).toBeGreaterThan(0);
  });

  /**
   * Plain sanity check, not a regression guard: a real bug was found live
   * (StrictMode's mount->unmount->remount cancelled the rAF the idle-enable
   * effect scheduled on its first pass, and `rafActiveRef` was never reset
   * to `null` after that cancel — see the unmount-cleanup effect's comment
   * in circuit-field.tsx for the actual fix). This test passes against both
   * the buggy and fixed code in jsdom (checked directly) — the live browser
   * is what actually caught and confirmed the bug, not this file. Left in
   * only as basic "loop starts under StrictMode" coverage.
   */
  it("still starts the idle loop under React.StrictMode's double-invoke mount", async () => {
    render(
      <React.StrictMode>
        <CircuitField routeKey="route-strict" />
      </React.StrictMode>,
    );

    await act(async () => {
      await nextFrame();
    });
    const callsAfterMount = rafCallCount;
    expect(callsAfterMount).toBeGreaterThan(0);

    await act(async () => {
      await nextFrame();
      await nextFrame();
    });

    expect(rafCallCount).toBeGreaterThan(callsAfterMount);
  });
});
