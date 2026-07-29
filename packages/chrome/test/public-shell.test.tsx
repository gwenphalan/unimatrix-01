import type { ReactNode } from "react";
import { render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act } from "react";
import { describe, expect, it } from "vitest";

import type { PublicNavItem } from "../src/public.js";
import { PublicFooterLink, PublicShell } from "../src/public.js";

function StubIcon({ className }: { className?: string | undefined }) {
  return <svg className={className} data-testid="nav-icon" />;
}

const navItems: PublicNavItem[] = [
  { active: true, icon: StubIcon, label: "Home", to: "/" },
  { active: false, icon: StubIcon, label: "Projects", to: "/projects" },
];

/**
 * Mounts `ui` under a real router. The shell reads the pathname for the circuit
 * field's route key and renders `Link`s for both the logo and every nav tab, so
 * every case here needs one.
 */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    component: () => ui,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const projectsRoute = createRoute({
    component: () => ui,
    getParentRoute: () => rootRoute,
    path: "/projects",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute, projectsRoute]),
  });

  render(<RouterProvider router={router as never} />);

  await act(async () => {
    await router.load();
  });
}

function renderShell(props: Partial<Parameters<typeof PublicShell>[0]> = {}) {
  return renderInRouter(
    <PublicShell
      breadcrumbItems={[{ label: "Unimatrix-01", to: "/" }, { label: "Home" }]}
      navItems={navItems}
      {...props}
    >
      page content
    </PublicShell>,
  );
}

describe("PublicShell", () => {
  it("renders both header bars with distinct landmark names", async () => {
    await renderShell();

    // Two bars each carrying a breadcrumb and a nav means four landmarks, and
    // two sharing a role and an accessible name is exactly what axe's
    // `landmark-unique` rule reports. The distinct names are the fix.
    expect(screen.getByRole("navigation", { name: /^Breadcrumb$/u })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: /^Primary$/u })).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Breadcrumb, condensed header" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("navigation", { name: "Primary, condensed header" }),
    ).toBeInTheDocument();

    expect(screen.getByRole("main")).toHaveTextContent("page content");
    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
  });

  it("marks only the active nav item as the current page", async () => {
    await renderShell();

    const primaryNav = screen.getByRole("navigation", { name: /^Primary$/u });
    const current = within(primaryNav).getByRole("link", { current: "page" });

    // `active` is resolved by the consuming app — the shell holds no route
    // matching rules of its own, so this asserts it renders what it is told.
    expect(current).toHaveTextContent("Home");
    expect(within(primaryNav).getByRole("link", { name: /Projects/u })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("renders the trail with the last crumb as text rather than a link", async () => {
    await renderShell({
      breadcrumbItems: [
        { label: "Unimatrix-01", to: "/" },
        { label: "Projects", to: "/projects" },
        { label: "Cube Trainer" },
      ],
    });

    const trail = screen.getByRole("navigation", { name: /^Breadcrumb$/u });

    // The root crumb keeps its link even on a deep route: it is the way back,
    // and the trailing crumb is the current page, so it must not be a link.
    expect(within(trail).getByRole("link", { name: "Unimatrix-01" })).toBeInTheDocument();
    expect(within(trail).getByRole("link", { name: "Projects" })).toBeInTheDocument();
    expect(within(trail).queryByRole("link", { name: "Cube Trainer" })).not.toBeInTheDocument();
    expect(trail).toHaveTextContent("Cube Trainer");
  });

  it("omits the account cluster entirely when no control is supplied", async () => {
    await renderShell();

    expect(screen.queryByRole("button", { name: "Account" })).not.toBeInTheDocument();
  });

  it("renders the account control in both header bars", async () => {
    await renderShell({ accountControl: <button type="button">Account</button> });

    // Both bars carry it: the condensed bar replaces the header on scroll, so a
    // control in only one of them disappears at exactly the point it is needed.
    expect(screen.getAllByRole("button", { name: "Account" })).toHaveLength(2);
  });

  it("renders footer links and the owner's copyright", async () => {
    await renderShell({
      footerLinks: <PublicFooterLink href="mailto:someone@example.test">Email</PublicFooterLink>,
      ownerName: "Test Owner",
    });

    const footer = screen.getByRole("contentinfo");

    expect(footer).toHaveTextContent("Test Owner");
    expect(within(footer).getByRole("link", { name: "Email" })).toHaveAttribute(
      "href",
      "mailto:someone@example.test",
    );
  });

  it("renders the trailing slot out of the column's flow", async () => {
    await renderShell({ trailing: <span data-testid="toaster" /> });

    // A zero-height flex item still earns the column's gap, which is how an
    // admin-only toast host put dead space under the footer for admins only.
    const trailing = screen.getByTestId("toaster").parentElement;

    expect(trailing).toHaveClass("absolute");
  });
});
