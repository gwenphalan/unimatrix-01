import { afterEach, describe, expect, it } from "vitest";

import {
  getCircuitDebugState,
  installCircuitDebugConsoleApi,
  isCircuitDebugEnabled,
  setCircuitDebug,
  subscribeCircuitDebug,
} from "../src/components/circuit-debug.js";

afterEach(() => {
  setCircuitDebug(false);
  delete window.__circuitField;
});

describe("circuit debug flag store", () => {
  it("defaults to disabled", () => {
    expect(isCircuitDebugEnabled()).toBe(false);
    expect(getCircuitDebugState()).toEqual({ enabled: false, cells: false });
  });

  it("setCircuitDebug flips the flag and notifies subscribers", () => {
    let notified = 0;
    const unsubscribe = subscribeCircuitDebug(() => {
      notified += 1;
    });

    setCircuitDebug(true);
    expect(isCircuitDebugEnabled()).toBe(true);
    expect(notified).toBe(1);

    setCircuitDebug(false);
    expect(isCircuitDebugEnabled()).toBe(false);
    expect(notified).toBe(2);

    unsubscribe();
  });

  it("does not notify when the state doesn't actually change", () => {
    let notified = 0;
    const unsubscribe = subscribeCircuitDebug(() => {
      notified += 1;
    });

    setCircuitDebug(false); // already false
    expect(notified).toBe(0);

    unsubscribe();
  });

  it("clears cells when disabling, and turns cells on/off with debug", () => {
    setCircuitDebug(true, { cells: true });
    expect(getCircuitDebugState()).toEqual({ enabled: true, cells: true });

    setCircuitDebug(false);
    expect(getCircuitDebugState()).toEqual({ enabled: false, cells: false });
  });
});

describe("installCircuitDebugConsoleApi", () => {
  it("installs window.__circuitField.debug/.state", () => {
    installCircuitDebugConsoleApi();

    expect(window.__circuitField).toBeDefined();
    expect(window.__circuitField?.state()).toEqual({ enabled: false, cells: false });

    const next = window.__circuitField?.debug(true);
    expect(next).toEqual({ enabled: true, cells: false });
    expect(isCircuitDebugEnabled()).toBe(true);
  });

  it("is idempotent — a second install does not replace the existing api object", () => {
    installCircuitDebugConsoleApi();
    const first = window.__circuitField;
    installCircuitDebugConsoleApi();
    expect(window.__circuitField).toBe(first);
  });
});
