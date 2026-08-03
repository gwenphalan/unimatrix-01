import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both branches of the panel turn on `isSignedIn`, and the signed-out one is
// only reachable where `requireSignIn` is off — so a rendered Clerk session is
// the wrong tool here. Stubbing the hook is what lets both branches be asserted
// without a live key.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock("@unimatrix/auth/react", () => ({ useAuth: mockUseAuth }));

const { AdminAccessDenied } = await import("@/features/content/content-panel");

afterEach(() => {
  mockUseAuth.mockReset();
});

describe("AdminAccessDenied", () => {
  it("sends a signed-out visitor to the auth hub with a return address", () => {
    mockUseAuth.mockReturnValue({ isSignedIn: false });

    render(<AdminAccessDenied authAppUrl="https://auth.example.test" />);

    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `https://auth.example.test/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`,
    );
    expect(screen.getByText(/Sign in with an admin account/)).toBeInTheDocument();
  });

  it("tells a signed-in visitor the account lacks access, and offers no sign-in link", () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true });

    render(<AdminAccessDenied authAppUrl="https://auth.example.test" />);

    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByText(/does not carry admin access/)).toBeInTheDocument();
  });

  it.each([false, true])(
    "exits to the public site with a cross-origin anchor (isSignedIn: %s)",
    (isSignedIn) => {
      mockUseAuth.mockReturnValue({ isSignedIn });

      render(<AdminAccessDenied authAppUrl="https://auth.example.test" />);

      // A router `Link to="/"` here resolves to the admin root, not the site.
      // Asserting the absolute href is what catches that regression.
      expect(screen.getByRole("link", { name: "Return to the site" })).toHaveAttribute(
        "href",
        "https://unimatrix-01.dev/",
      );
    },
  );
});
