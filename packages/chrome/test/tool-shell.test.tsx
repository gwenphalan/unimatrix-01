import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { ToolFooterLink, ToolShell, ToolTitleBar } from "../src/tool.js";

/**
 * Mounts `ui` under a real router. `ToolTitleBar`'s `to` form renders a `Link`,
 * which needs one, so every case here goes through this.
 */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    component: () => ui,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([indexRoute]),
  });

  render(<RouterProvider router={router as never} />);

  await act(async () => {
    await router.load();
  });
}

describe("ToolShell", () => {
  it("renders no title bar when the service supplies neither an account control nor a wordmark", async () => {
    await renderInRouter(<ToolShell>tool content</ToolShell>);

    // The `apps/cube-trainer` case. A bar with nothing in it would only cost
    // vertical space, so the shell must not reserve one.
    expect(screen.getByRole("main")).toHaveTextContent("tool content");
    expect(screen.queryByRole("link", { name: "Unimatrix-01" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to main content" })).toBeInTheDocument();
  });

  it("renders the account control and the way back to the public site when given them", async () => {
    await renderInRouter(
      <ToolShell
        accountControl={<button type="button">Account</button>}
        homeHref="https://unimatrix-01.dev/"
        homeLabel="Unimatrix-01"
      >
        tool content
      </ToolShell>,
    );

    const homeLink = screen.getByRole("link", { name: "Unimatrix-01" });

    expect(homeLink).toHaveAttribute("href", "https://unimatrix-01.dev/");
    expect(screen.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });

  it("puts the owner and the tool's own attribution in the footer", async () => {
    await renderInRouter(
      <ToolShell
        footerEnd={<ToolFooterLink href="https://example.test/src">Source</ToolFooterLink>}
        homeHref="https://unimatrix-01.dev/"
        ownerName="Gwen Phalan"
      >
        tool content
      </ToolShell>,
    );

    const footer = screen.getByRole("contentinfo");
    const year = new Date().getFullYear();

    expect(within(footer).getByRole("link", { name: `${year} Gwen Phalan` })).toHaveAttribute(
      "href",
      "https://unimatrix-01.dev/",
    );
    expect(within(footer).getByRole("link", { name: "Source" })).toHaveAttribute(
      "href",
      "https://example.test/src",
    );
  });

  it("falls back to plain copyright text when no public site is given", async () => {
    await renderInRouter(<ToolShell ownerName="Gwen Phalan">tool content</ToolShell>);

    const footer = screen.getByRole("contentinfo");

    expect(footer).toHaveTextContent(`${new Date().getFullYear()} Gwen Phalan`);
    expect(within(footer).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("ToolTitleBar", () => {
  it("renders the routed back control with an accessible name and the view's h1", async () => {
    await renderInRouter(
      <ToolTitleBar
        actions={<span>actions slot</span>}
        back={{ label: "Back to modes", to: "/" }}
        title="Learn OLL"
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Learn OLL" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to modes" })).toHaveAttribute("href", "/");
    expect(screen.getByText("actions slot")).toBeInTheDocument();
  });

  it("renders the callback back control as a button", async () => {
    const onClick = vi.fn();

    await renderInRouter(<ToolTitleBar back={{ label: "Back to cases", onClick }} title="Drill" />);

    fireEvent.click(screen.getByRole("button", { name: "Back to cases" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
