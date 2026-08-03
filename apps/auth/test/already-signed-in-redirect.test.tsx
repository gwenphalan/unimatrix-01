import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
}));

const { AlreadySignedInRedirect } = await import("../src/features/auth/already-signed-in-redirect");

const TARGET = "https://cflop.unimatrix-01.dev/oll";

// jsdom's `window.location.assign` is not configurable, so `vi.spyOn` cannot
// wrap it directly — replace the whole `location` object instead, restoring
// the original afterward so other suites in this run see a real one.
const originalLocation = window.location;

function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();

  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, assign },
  });

  return assign;
}

describe("AlreadySignedInRedirect", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("sends an already-signed-in visitor to target", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<AlreadySignedInRedirect target={TARGET} />);

    expect(assign).toHaveBeenCalledWith(TARGET);
  });

  it("does nothing for a signed-out visitor", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(<AlreadySignedInRedirect target={TARGET} />);

    expect(assign).not.toHaveBeenCalled();
  });

  // The load-bearing case: an unresolved session must not be read as "signed
  // out" (fine, already covered above) or as "signed in" — either misread
  // sends the wrong visitor down the wrong path on a cold load.
  it("does nothing while Clerk has not resolved the session yet", () => {
    auth.isLoaded = false;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<AlreadySignedInRedirect target={TARGET} />);

    expect(assign).not.toHaveBeenCalled();
  });

  // The regression this component was reported for: a visitor who arrives
  // signed out and then completes a sign-in must be landed by Clerk's own
  // `forceRedirectUrl`, not by a second navigation from here racing it.
  it("does nothing when a signed-out visitor signs in underneath it", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    const { rerender } = render(<AlreadySignedInRedirect target={TARGET} />);

    auth.isSignedIn = true;
    rerender(<AlreadySignedInRedirect target={TARGET} />);

    expect(assign).not.toHaveBeenCalled();
  });

  // The same arrival state must survive Clerk resolving late: `isLoaded`
  // false first, then true with a session, is a visitor who arrived signed
  // in — not one who signed in underneath the component.
  it("still redirects when Clerk resolves an existing session late", () => {
    auth.isLoaded = false;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    const { rerender } = render(<AlreadySignedInRedirect target={TARGET} />);

    auth.isLoaded = true;
    auth.isSignedIn = true;
    rerender(<AlreadySignedInRedirect target={TARGET} />);

    expect(assign).toHaveBeenCalledWith(TARGET);
  });
});
