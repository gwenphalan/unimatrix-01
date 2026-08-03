import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));

vi.mock("@unimatrix/auth/react", () => ({
  SignUp: () => <div>sign-up-widget</div>,
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
}));

const { SignUpCard } = await import("../src/features/auth/sign-up-card");

const VALID_REDIRECT = "http://localhost:5176/";

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

describe("SignUpCard", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("sends an already-signed-in visitor straight to a valid redirect_url", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignUpCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).toHaveBeenCalledWith(VALID_REDIRECT);
  });

  it("renders Clerk's own signed-in state when there is no redirect_url to honor", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignUpCard redirectUrl={undefined} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("sign-up-widget")).toBeInTheDocument();
  });

  it("renders the widget for a signed-out visitor", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(<SignUpCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("sign-up-widget")).toBeInTheDocument();
  });

  it("does not redirect while Clerk has not resolved the session yet", () => {
    auth.isLoaded = false;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignUpCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).not.toHaveBeenCalled();
  });
});
