import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ isLoaded: true, isSignedIn: true }));

vi.mock("@unimatrix/auth/react", () => ({
  SignIn: () => <div>sign-in-widget</div>,
  useAuth: () => ({ isLoaded: auth.isLoaded, isSignedIn: auth.isSignedIn }),
}));

const { SignInCard } = await import("../src/features/auth/sign-in-card");

const VALID_REDIRECT = "https://cflop.unimatrix-01.dev/oll";

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

describe("SignInCard", () => {
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

    render(<SignInCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).toHaveBeenCalledWith(VALID_REDIRECT);
  });

  it("renders Clerk's own signed-in state when there is no redirect_url to honor", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignInCard redirectUrl={undefined} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("sign-in-widget")).toBeInTheDocument();
  });

  it("renders Clerk's own signed-in state when redirect_url was rejected", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignInCard redirectUrl="https://attacker.com/" />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("sign-in-widget")).toBeInTheDocument();
  });

  it("renders the widget for a signed-out visitor", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;
    const assign = stubLocationAssign();

    render(<SignInCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("sign-in-widget")).toBeInTheDocument();
  });

  it("does not redirect while Clerk has not resolved the session yet", () => {
    auth.isLoaded = false;
    auth.isSignedIn = true;
    const assign = stubLocationAssign();

    render(<SignInCard redirectUrl={VALID_REDIRECT} />);

    expect(assign).not.toHaveBeenCalled();
  });
});
