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
});
