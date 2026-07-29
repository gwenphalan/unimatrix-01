import type { ReactNode } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `SignedIn`/`SignedOut` need a mounted Clerk provider, and mounting a real one
// would need live keys. The mock is a *switch* rather than a pair that both
// render their children: with both rendering, swapping the two wrappers in the
// shell leaves every assertion below green, so the two tests named after auth
// gating would assert nothing about gating at all.
const auth = vi.hoisted(() => ({ signedIn: true }));

vi.mock("@unimatrix/auth/react", () => ({
  SignedIn: ({ children }: { children: ReactNode }) => (auth.signedIn ? <>{children}</> : null),
  SignedOut: ({ children }: { children: ReactNode }) => (auth.signedIn ? null : <>{children}</>),
  UserButton: () => <button type="button">Account</button>,
}));

const { AppShell } = await import("../src/app/app-shell.js");

function renderShell(children: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <AppShell authAppUrl="https://auth.example.test">{children}</AppShell>,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute,
  });

  return render(<RouterProvider router={router as never} />);
}

describe("AppShell", () => {
  beforeEach(() => {
    auth.signedIn = true;
  });

  it("renders its children inside the shared tool shell", async () => {
    renderShell(<p>console body</p>);

    expect(await screen.findByText("console body")).toBeInTheDocument();
    // The skip link is `ToolShell`'s, not this app's. Finding it is how this
    // test proves the shared shell actually mounted rather than the app having
    // quietly grown chrome of its own.
    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
  });

  it("carries a title bar with the way back to the public site", async () => {
    renderShell(<p>console body</p>);

    expect(await screen.findByRole("link", { name: "Unimatrix" })).toHaveAttribute(
      "href",
      "https://unimatrix-01.dev/",
    );
  });

  it("is a tool surface: no site nav tabs and no site footer", async () => {
    renderShell(<p>console body</p>);

    await screen.findByText("console body");

    for (const label of ["Home", "Projects", "Blog", "About"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it("sends the signed-out visitor to the auth hub with a return address", async () => {
    auth.signedIn = false;
    renderShell(<p>console body</p>);

    // jsdom's default location. Asserted through the built href rather than a
    // hardcoded string so the encoding stays covered.
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `https://auth.example.test/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`,
    );
    // The negative half is what makes this a gating test: the account control
    // must be absent, not merely the sign-in link present.
    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
  });

  it("shows the account control to a signed-in operator", async () => {
    renderShell(<p>console body</p>);

    expect(await screen.findByRole("button", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });
});
