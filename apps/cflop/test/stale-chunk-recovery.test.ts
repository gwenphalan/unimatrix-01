import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installStaleChunkRecovery, isStaleChunkError } from "@/lib/stale-chunk-recovery";

function dispatchPreloadError(payload: unknown): VitePreloadErrorEvent {
  const event = new Event("vite:preloadError", { cancelable: true }) as VitePreloadErrorEvent;
  event.payload = payload as Error;
  window.dispatchEvent(event);
  return event;
}

// Flushes the microtask queue so a `probe().then(...)` chain settles before
// an assertion runs — every probe-driven test needs this because
// `handlePreloadError` is synchronous and reloads from the probe's
// resolution.
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function goneProbe(): Promise<Response> {
  return Promise.resolve(new Response(null, { status: 404 }));
}

function okJsProbe(): Promise<Response> {
  return Promise.resolve(
    new Response(null, { status: 200, headers: { "content-type": "application/javascript" } }),
  );
}

function networkFailureProbe(): Promise<Response> {
  return Promise.reject(new TypeError("Failed to fetch"));
}

function timeoutProbe(): Promise<Response> {
  return Promise.reject(new DOMException("The operation timed out.", "TimeoutError"));
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

  it("reloads once for a stale-chunk failure the probe confirms is a 404", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never calls preventDefault, so __vitePreload still rethrows", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });

    const event = dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(false);
  });

  it("does not reload a second time for the same module URL", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });
    const message =
      "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js";

    dispatchPreloadError(new Error(message));
    await flushMicrotasks();
    dispatchPreloadError(new Error(message));
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shares one reload across two different failing chunk URLs in the same build", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();
    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/drill-xyz.js",
      ),
    );
    await flushMicrotasks();

    // The guard is keyed on the document's own build (`import.meta.url`), not
    // on the failing module, so a second distinct chunk failing in the same
    // stale document does not get a reload of its own.
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload when the probe reports the chunk is still there", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: okJsProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads when the probe answers 200 with the HTML shell", async () => {
    const reload = vi.fn();
    const probe = vi.fn().mockResolvedValue(
      new Response("<!doctype html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    );
    dispose = installStaleChunkRecovery({ reload, probe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  // `response.ok` spans the whole 2xx range, so this is what keeps a `201` or
  // `206` carrying HTML from spending the build's one reload.
  it("does not reload when an HTML response is 2xx but not 200", async () => {
    const reload = vi.fn();
    const probe = vi.fn().mockResolvedValue(
      new Response("<!doctype html>", {
        status: 206,
        headers: { "content-type": "text/html" },
      }),
    );
    dispose = installStaleChunkRecovery({ reload, probe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the probe rejects with a network failure", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: networkFailureProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the probe times out", async () => {
    const reload = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe: timeoutProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not write the guard key when the probe declines, so a later confirmed failure still reloads", async () => {
    const reload = vi.fn();
    const probe = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    dispose = installStaleChunkRecovery({ reload, probe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();
    expect(reload).not.toHaveBeenCalled();

    probe.mockResolvedValueOnce(new Response(null, { status: 404 }));
    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads a Safari-shaped failure without probing, since its message carries no URL", async () => {
    const reload = vi.fn();
    const probe = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe });

    dispatchPreloadError(new Error("Importing a module script failed"));
    await flushMicrotasks();

    expect(probe).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads when sessionStorage is unreachable", async () => {
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads when sessionStorage.setItem throws", async () => {
    // getItem still succeeds here — this is the quota-exceeded/Safari
    // private-browsing shape, where reads work but a write throws, rather
    // than the read-side failure the case above covers.
    const reload = vi.fn();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    dispose = installStaleChunkRecovery({ reload, probe: goneProbe });

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });

  it("ignores a preloadError event that is not a stale-chunk failure", async () => {
    const reload = vi.fn();
    const probe = vi.fn();
    dispose = installStaleChunkRecovery({ reload, probe });

    dispatchPreloadError(
      new Error("Unable to preload CSS for https://cflop.example/assets/learn.css"),
    );
    await flushMicrotasks();

    expect(probe).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("removes the listener when disposed", async () => {
    const reload = vi.fn();
    const dispose = installStaleChunkRecovery({ reload, probe: goneProbe });
    dispose();

    dispatchPreloadError(
      new Error(
        "Failed to fetch dynamically imported module: https://cflop.example/assets/learn-abc.js",
      ),
    );
    await flushMicrotasks();

    expect(reload).not.toHaveBeenCalled();
  });
});
