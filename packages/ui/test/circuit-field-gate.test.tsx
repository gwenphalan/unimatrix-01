import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CircuitField } from "../src/components/circuit-field.js";
import { type FakeMediaQueryList, stubMatchMedia } from "./helpers/match-media.js";

// Deliberately re-stated rather than imported from the hook module. This is
// the breakpoint's behavioural contract, so it should be asserted from the
// outside: moving the gate to another width has to fail here (the stub stops
// matching the query the hook actually asks for) instead of quietly following
// the source.
const NARROW_VIEWPORT_QUERY = "(max-width: 639px)";

// Half of each is a whole number of pixels but not a whole number of 40px
// cells, so the expected phase is non-zero and a *missing* effect is
// distinguishable from a ran-and-computed-zero one.
const CLIENT_WIDTH = 500;
const CLIENT_HEIGHT = 620;
const EXPECTED_FINE_PHASE_X = "10px"; // (500 / 2) % 40
const EXPECTED_FINE_PHASE_Y = "30px"; // (620 / 2) % 40
// The bold tier is the same measurement against the 240px tile, plus half a
// tile so the centerline lands mid-cell rather than on a bold line:
// ((250 % 240) + 120) % 240.
const EXPECTED_BOLD_PHASE_X = "130px";

function stubClientSize(): void {
  Object.defineProperty(document.documentElement, "clientWidth", {
    value: CLIENT_WIDTH,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    value: CLIENT_HEIGHT,
    configurable: true,
  });
}

/**
 * The narrow-viewport gate: below the breakpoint `CircuitField` renders
 * nothing at all, while the lattice phase it owns keeps being published for
 * `.grid-backdrop` (the CSS grid that still paints at every width).
 */
describe("CircuitField narrow-viewport gate", () => {
  // The traces themselves are switched off at `CIRCUIT_FIELD_ENABLED` while the
  // field is unfinished, so every canvas assertion below is skipped. The phase
  // assertions are not: `useGridPhase` runs above that switch, and the CSS
  // lattice it drives still paints. Un-skip in the commit that flips the flag.
  const itWithCanvas = it.skip;

  // Captured purely to restore `window.matchMedia` in afterEach. It is
  // reassigned to the same receiver it came from and never invoked detached,
  // so the `this` scoping `unbound-method` guards against cannot occur here.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalMatchMedia = window.matchMedia;
  let registry: Map<string, FakeMediaQueryList>;

  beforeEach(() => {
    stubClientSize();
    registry = stubMatchMedia({ [NARROW_VIEWPORT_QUERY]: false });
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    document.documentElement.removeAttribute("style");
  });

  itWithCanvas("renders the canvas on a wide viewport", () => {
    render(<CircuitField routeKey="/" />);

    expect(document.querySelector("svg.circuit-field")).not.toBeNull();
  });

  it("renders nothing on a narrow viewport", () => {
    registry.get(NARROW_VIEWPORT_QUERY)!.matches = true;

    render(<CircuitField routeKey="/" />);

    expect(document.querySelector("svg.circuit-field")).toBeNull();
  });

  it("still publishes the grid phase while gated out", () => {
    registry.get(NARROW_VIEWPORT_QUERY)!.matches = true;

    render(<CircuitField routeKey="/" />);

    const { style } = document.documentElement;
    expect(style.getPropertyValue("--grid-phase-x")).toBe(EXPECTED_FINE_PHASE_X);
    expect(style.getPropertyValue("--grid-phase-y")).toBe(EXPECTED_FINE_PHASE_Y);
    expect(style.getPropertyValue("--grid-bold-phase-x")).toBe(EXPECTED_BOLD_PHASE_X);
  });

  it("keeps one `change` subscription across re-renders", () => {
    const { rerender } = render(<CircuitField routeKey="/" />);
    rerender(<CircuitField routeKey="/projects" />);
    rerender(<CircuitField routeKey="/blog" />);

    // Not `listeners.size`: `useSyncExternalStore` removes as it re-adds, so a
    // subscription rebuilt on every render still reads as exactly one live
    // listener. `attachCount` is what catches an unstable `subscribe`.
    expect(registry.get(NARROW_VIEWPORT_QUERY)!.attachCount).toBe(1);
  });

  itWithCanvas("unmounts and remounts the canvas as the query flips live", () => {
    render(<CircuitField routeKey="/" />);
    expect(document.querySelector("svg.circuit-field")).not.toBeNull();

    act(() => {
      registry.get(NARROW_VIEWPORT_QUERY)!.setMatches(true);
    });
    expect(document.querySelector("svg.circuit-field")).toBeNull();

    act(() => {
      registry.get(NARROW_VIEWPORT_QUERY)!.setMatches(false);
    });
    expect(document.querySelector("svg.circuit-field")).not.toBeNull();
  });
});
