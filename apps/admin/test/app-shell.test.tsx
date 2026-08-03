import type { ReactNode } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `SignedIn` needs a mounted Clerk provider, and mounting a real one would
// need live keys. `RequireSignedIn` is what gates a signed-out visitor out of
// this component entirely (see require-signed-in.test.tsx) — by the time
// `AppShell` mounts a session is guaranteed, so this mock always renders.
vi.mock("@unimatrix/auth/react", () => ({
  SignedIn: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserButton: () => <button type="button">Account</button>,
}));

const { AppShell } = await import("../src/app/app-shell.js");

function renderShell(children: ReactNode) {
  const rootRoute = createRootRoute({
    component: () => <AppShell>{children}</AppShell>,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute,
  });

  return render(<RouterProvider router={router as never} />);
}

describe("AppShell", () => {
  it("renders its children inside the shared tool shell", async () => {
    renderShell(<p>console body</p>);

    expect(await screen.findByText("console body")).toBeInTheDocument();
    // The skip link is `ToolShell`'s, not this app's. Finding it is how this
    // test proves the shared shell actually mounted rather than the app having
    // quietly grown chrome of its own.
    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
  });

  it("carries a wordmark that stays on the admin origin, and a way back to the public site in the footer", async () => {
    renderShell(<p>console body</p>);

    // The wordmark: `sectionsHomeHref="/"` keeps it same-origin, unlike the
    // old title bar's `homeHref`.
    expect(await screen.findByRole("link", { name: "Unimatrix Admin" })).toHaveAttribute(
      "href",
      "/",
    );
    // The way back out to the public site is the footer's copyright link,
    // still pointing off-origin.
    expect(
      within(screen.getByRole("contentinfo")).getByRole("link", { name: /Gwen Phalan/u }),
    ).toHaveAttribute("href", "https://unimatrix-01.dev/");
  });

  it("renders the seven section links", async () => {
    renderShell(<p>console body</p>);

    const nav = await screen.findByRole("navigation", { name: "Sections" });

    for (const label of [
      "Overview",
      "Content",
      "Feedback",
      "Deploys",
      "Analytics",
      "Social",
      "Secrets",
    ]) {
      expect(within(nav).getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("is a tool surface: no site nav tabs and no site footer", async () => {
    renderShell(<p>console body</p>);

    await screen.findByText("console body");

    for (const label of ["Home", "Projects", "Blog", "About"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    // The other half of the name, and it is not "no `contentinfo` at all":
    // the section rail renders its own footer beside `main`, so one landmark
    // is expected. What must not appear is `PublicSiteFooter`, the
    // `site-shell` panel that only `PublicShell` mounts. `getByRole` throws on
    // a second `contentinfo`, so this also catches the site footer arriving
    // alongside.
    expect(screen.getByRole("contentinfo")).not.toHaveClass("site-shell");
  });

  it("shows the account control", async () => {
    renderShell(<p>console body</p>);

    expect(await screen.findByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
