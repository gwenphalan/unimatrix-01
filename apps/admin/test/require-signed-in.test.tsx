import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
}));

const { RequireSignedIn } = await import("../src/app/require-signed-in.js");

const AUTH_APP_URL = "https://auth.example.test";

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

describe("RequireSignedIn", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("renders nothing while Clerk has not resolved the session yet", () => {
    auth.isLoaded = false;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(
      <RequireSignedIn authAppUrl={AUTH_APP_URL} enabled>
        <p>console body</p>
      </RequireSignedIn>,
    );

    // The load-bearing assertion: an unresolved session must not be read as
    // "signed out", or a signed-in operator gets bounced on every cold load.
    expect(assign).not.toHaveBeenCalled();
    expect(screen.queryByText("console body")).not.toBeInTheDocument();
  });

  it("redirects to the auth hub with a return address once Clerk resolves signed-out", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(
      <RequireSignedIn authAppUrl={AUTH_APP_URL} enabled>
        <p>console body</p>
      </RequireSignedIn>,
    );

    expect(assign).toHaveBeenCalledWith(
      `${AUTH_APP_URL}/sign-in?redirect_url=${encodeURIComponent(originalLocation.href)}`,
    );
    expect(screen.queryByText("console body")).not.toBeInTheDocument();
  });

  it("renders its children once Clerk resolves signed-in", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(
      <RequireSignedIn authAppUrl={AUTH_APP_URL} enabled>
        <p>console body</p>
      </RequireSignedIn>,
    );

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("console body")).toBeInTheDocument();
  });

  // No build passes `enabled={false}` today — dev included, since a local hub
  // issues a session a local console can read. The prop is still the guard's
  // contract, so the off state stays asserted rather than assumed.
  it("renders its children signed out when disabled", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(
      <RequireSignedIn authAppUrl={AUTH_APP_URL} enabled={false}>
        <p>console body</p>
      </RequireSignedIn>,
    );

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("console body")).toBeInTheDocument();
  });
});
