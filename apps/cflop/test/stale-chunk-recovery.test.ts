import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installStaleChunkRecovery, isStaleChunkError } from "@/lib/stale-chunk-recovery";

function dispatchPreloadError(payload: unknown): VitePreloadErrorEvent {
  const event = new Event("vite:preloadError", { cancelable: true }) as VitePreloadErrorEvent;
  event.payload = payload as Error;
  window.dispatchEvent(event);
  return event;
}

describe("isStaleChunkError", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://cflop.example/assets/learn.js",
    "error loading dynamically imported module: https://cflop.example/assets/learn.js",
    "Importing a module script failed",
  ])("matches the browser stale-chunk message %s", (message) => {
    expect(isStaleChunkError(new Error(message))).toBe(true);
  });

  it("rejects an unrelated Error", () => {
    expect(isStaleChunkError(new Error("network request failed"))).toBe(false);
  });

  it("rejects a plain string", () => {
    expect(isStaleChunkError("Failed to fetch dynamically imported module")).toBe(false);
  });

  it("rejects null and undefined", () => {
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });

  it("rejects a non-Error object before its message is even inspected", () => {
    expect(isStaleChunkError({ message: 42 })).toBe(false);
  });
});

describe("installStaleChunkRecovery", () => {
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it("reloads once for a stale-chunk failure", () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never calls preventDefault, so __vitePreload still rethrows", () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload });

    const event = dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not reload a second time for the same module URL", () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload });
    const message =
      "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js";

    dispatchPreloadError(new Error(message));
    dispatchPreloadError(new Error(message));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again for a different module URL", () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/drill-xyz.js",
      ),
    );

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads when sessionStorage is unreachable", () => {
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    dispose = installStaleChunkRecovery({ reload });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads when sessionStorage.setItem throws", () => {
    // getItem still succeeds here — this is the quota-exceeded/Safari
    // private-browsing shape, where reads work but a write throws, rather
    // than the read-side failure the case above covers.
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    dispose = installStaleChunkRecovery({ reload });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores a preloadError event that is not a stale-chunk failure", () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload });

    dispatchPreloadError(
      new Error("Unable to preload CSS for https://cflop.example/assets/learn.css"),
    );

    expect(reload).not.toHaveBeenCalled();
  });

  it("removes the listener when disposed", () => {
    const reload = vi.fn();
    const dispose = installStaleChunkRecovery({ reload });
    dispose();

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );

    expect(reload).not.toHaveBeenCalled();
  });
});
