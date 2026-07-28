import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedSize, useMotionMode } from "../src/components/circuit-field-hooks.js";
import { type FakeMediaQueryList, stubMatchMedia } from "./helpers/match-media.js";

describe("useDebouncedSize", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits the first size immediately, with no delay", () => {
    const { result } = renderHook(({ size }) => useDebouncedSize(size, 200), {
      initialProps: { size: { width: 800, height: 600 } },
    });

    expect(result.current).toEqual({ width: 800, height: 600 });
  });

  it("a width-unchanged height delta under the jitter threshold never commits", () => {
    const { result, rerender } = renderHook(
      ({ size }) => useDebouncedSize(size, 200, { heightJitterIgnorePx: 120 }),
      { initialProps: { size: { width: 800, height: 600 } } },
    );

    rerender({ size: { width: 800, height: 660 } }); // +60px, under threshold

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toEqual({ width: 800, height: 600 });
  });

  it("a height delta exceeding the jitter threshold commits after delay", () => {
    const { result, rerender } = renderHook(
      ({ size }) => useDebouncedSize(size, 200, { heightJitterIgnorePx: 120 }),
      { initialProps: { size: { width: 800, height: 600 } } },
    );

    rerender({ size: { width: 800, height: 750 } }); // +150px, over threshold

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toEqual({ width: 800, height: 750 });
  });

  it("a genuine width+height change commits normally even alongside a small height component", () => {
    const { result, rerender } = renderHook(
      ({ size }) => useDebouncedSize(size, 200, { heightJitterIgnorePx: 120 }),
      { initialProps: { size: { width: 800, height: 600 } } },
    );

    rerender({ size: { width: 375, height: 640 } }); // orientation-style: width changed too

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toEqual({ width: 375, height: 640 });
  });

  it("a jitter sample does not cancel a real in-flight resize's pending commit", () => {
    const { result, rerender } = renderHook(
      ({ size }) => useDebouncedSize(size, 200, { heightJitterIgnorePx: 120 }),
      { initialProps: { size: { width: 800, height: 600 } } },
    );

    // Real resize starts.
    rerender({ size: { width: 1024, height: 700 } });

    act(() => {
      vi.advanceTimersByTime(100); // still pending
    });

    // A width-unchanged jitter sample lands mid-flight — must not reset the
    // pending timer for the real resize above.
    rerender({ size: { width: 1024, height: 715 } });

    act(() => {
      vi.advanceTimersByTime(100); // total 200ms since the real resize started
    });

    expect(result.current).toEqual({ width: 1024, height: 700 });
  });

  it("without heightJitterIgnorePx, any height change debounces and commits normally", () => {
    const { result, rerender } = renderHook(({ size }) => useDebouncedSize(size, 200), {
      initialProps: { size: { width: 800, height: 600 } },
    });

    rerender({ size: { width: 800, height: 620 } });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(result.current).toEqual({ width: 800, height: 620 });
  });
});

describe("useMotionMode", () => {
  let registry: Map<string, FakeMediaQueryList>;
  // Captured purely to restore `window.matchMedia` in afterEach. It is reassigned
  // to the same receiver it came from and never invoked detached, so the `this`
  // scoping `unbound-method` guards against cannot occur here.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalMatchMedia = window.matchMedia;
  const originalConcurrency = Object.getOwnPropertyDescriptor(
    window.navigator,
    "hardwareConcurrency",
  );

  beforeEach(() => {
    registry = stubMatchMedia({
      "(prefers-reduced-motion: reduce)": false,
      "(prefers-reduced-data: reduce)": false,
      "(pointer: coarse)": false,
      "(update: slow)": false,
    });
    Object.defineProperty(window.navigator, "hardwareConcurrency", {
      value: 8,
      configurable: true,
    });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    if (originalConcurrency) {
      Object.defineProperty(window.navigator, "hardwareConcurrency", originalConcurrency);
    }
  });

  it("decides synchronously on mount — no frame of the wrong mode before an effect runs", () => {
    registry.get("(pointer: coarse)")!.matches = true;
    const { result } = renderHook(() => useMotionMode());
    expect(result.current.mode).toBe("static");
  });

  it("mounts to full when every signal is neutral and concurrency is high", () => {
    const { result } = renderHook(() => useMotionMode());
    expect(result.current.mode).toBe("full");
  });

  it("demoteToStatic ratchets down and never rises back, even once the preference recomputes to full", () => {
    const { result } = renderHook(() => useMotionMode());
    expect(result.current.mode).toBe("full");

    act(() => {
      result.current.demoteToStatic();
    });
    expect(result.current.mode).toBe("static");

    act(() => {
      registry.get("(prefers-reduced-motion: reduce)")!.setMatches(true);
    });
    expect(result.current.mode).toBe("static");

    act(() => {
      registry.get("(prefers-reduced-motion: reduce)")!.setMatches(false);
    });
    expect(result.current.mode).toBe("static");
  });

  it("idleGlowEligible is true for a coarse-pointer-only static device", () => {
    const { result } = renderHook(() => useMotionMode());

    act(() => {
      registry.get("(pointer: coarse)")!.setMatches(true);
    });

    expect(result.current.mode).toBe("static");
    expect(result.current.idleGlowEligible).toBe(true);
  });

  it("idleGlowEligible is false for reduced-motion static, even though the device may otherwise be capable", () => {
    const { result } = renderHook(() => useMotionMode());

    act(() => {
      registry.get("(prefers-reduced-motion: reduce)")!.setMatches(true);
    });

    expect(result.current.mode).toBe("static");
    expect(result.current.idleGlowEligible).toBe(false);
  });

  it("idleGlowEligible is false once the frame-budget watchdog demotes at runtime, regardless of live preferences", () => {
    const { result } = renderHook(() => useMotionMode());

    act(() => {
      registry.get("(pointer: coarse)")!.setMatches(true);
    });
    expect(result.current.idleGlowEligible).toBe(true);

    act(() => {
      result.current.demoteToStatic();
    });
    expect(result.current.mode).toBe("static");
    expect(result.current.idleGlowEligible).toBe(false);
  });

  it("an OS-level preference change is honored live when not floored by a runtime demotion", () => {
    const { result } = renderHook(() => useMotionMode());
    expect(result.current.mode).toBe("full");

    act(() => {
      registry.get("(pointer: coarse)")!.setMatches(true);
    });
    expect(result.current.mode).toBe("static");

    act(() => {
      registry.get("(pointer: coarse)")!.setMatches(false);
    });
    expect(result.current.mode).toBe("full");
  });
});
