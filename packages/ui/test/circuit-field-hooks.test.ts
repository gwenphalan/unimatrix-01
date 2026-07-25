import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDebouncedSize } from "../src/components/circuit-field-hooks.js";

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
