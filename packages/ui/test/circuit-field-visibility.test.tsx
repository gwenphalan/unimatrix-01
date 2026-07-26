import { act, render } from "@testing-library/react";
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
 * Covers the "background-tab check (rAF actually stops)" validation step —
 * per the plan doc, this is the real coverage for that check: the
 * Chrome-extension harness used for live validation can't observe it (the
 * controlled tab reports `visibilityState === "hidden"` permanently), so
 * jsdom is the only place this is actually exercised.
 */
describe("CircuitField visibilitychange", () => {
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

  it("stops scheduling frames while hidden and resumes once shown again", async () => {
    const { rerender } = render(<CircuitField routeKey="route-a" />);

    // Different routeKey -> different generation seed -> at least some
    // traces' target geometry differs -> a real in-flight crawl, which is
    // what keeps the shared rAF loop actually running frame over frame
    // (rather than merely being scheduled once).
    rerender(<CircuitField routeKey="route-b" />);
    await act(async () => {
      await nextFrame();
    });

    const callsBeforeHide = rafCallCount;
    expect(callsBeforeHide).toBeGreaterThan(0);

    setHidden(true);
    const callsRightAfterHide = rafCallCount;

    // Give the (now-stopped) loop several real frame-lengths to prove it
    // isn't quietly still scheduling itself.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(rafCallCount).toBe(callsRightAfterHide);

    setHidden(false);
    await act(async () => {
      await nextFrame();
    });

    expect(rafCallCount).toBeGreaterThan(callsRightAfterHide);
  });
});
