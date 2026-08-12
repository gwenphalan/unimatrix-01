import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both branches of the panel turn on `isSignedIn`, and asserting either
// against a real Clerk session would need a live key. Stubbing the hook is
// what keeps this a unit test.
const { mockUseAuth } = vi.hoisted(() => ({ mockUseAuth: vi.fn() }));

vi.mock("@unimatrix/auth/react", () => ({ useAuth: mockUseAuth }));

const { SectionAccessDenied } = await import("@/features/sections/section-panel");

afterEach(() => {
  mockUseAuth.mockReset();
});

describe("SectionAccessDenied", () => {
  it("sends a signed-out visitor to the auth hub with a return address", () => {
    mockUseAuth.mockReturnValue({ isSignedIn: false });

    render(
      <SectionAccessDenied authAppUrl="https://auth.example.test" description="Manages things." />,
    );

    const signIn = screen.getByRole("link", { name: "Sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `https://auth.example.test/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`,
    );
    expect(screen.getByText(/Sign in with an admin account/)).toBeInTheDocument();
  });

  it("tells a signed-in visitor the account lacks access, and offers no sign-in link", () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true });

    render(
      <SectionAccessDenied authAppUrl="https://auth.example.test" description="Manages things." />,
    );

    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByText(/does not carry admin access/)).toBeInTheDocument();
  });

  it("renders the caller's description of what the section manages", () => {
    mockUseAuth.mockReturnValue({ isSignedIn: true });

    render(
      <SectionAccessDenied
        authAppUrl="https://auth.example.test"
        description="This tool manages integration credentials."
      />,
    );

    expect(screen.getByText(/manages integration credentials/)).toBeInTheDocument();
  });

  it.each([false, true])(
    "exits to the public site with a cross-origin anchor (isSignedIn: %s)",
    (isSignedIn) => {
      mockUseAuth.mockReturnValue({ isSignedIn });

      render(
        <SectionAccessDenied
          authAppUrl="https://auth.example.test"
          description="Manages things."
        />,
      );

      // A router `Link to="/"` here resolves to the admin root, not the site.
      // Asserting the absolute href is what catches that regression.
      expect(screen.getByRole("link", { name: "Return to the site" })).toHaveAttribute(
        "href",
        "https://unimatrix-01.dev/",
      );
    },
  );
});
