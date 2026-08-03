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

import type { ToolSection } from "../src/tool.js";
import { ToolShell } from "../src/tool.js";

function StubIcon({ className }: { className?: string | undefined }) {
  return <svg className={className} data-testid="section-icon" />;
}

const SECTIONS: ToolSection[] = [
  { active: false, icon: StubIcon, label: "Content", to: "/content" },
  { active: true, icon: StubIcon, label: "Feedback", to: "/feedback" },
];

/**
 * Mounts `ui` under a real router with every path the rail's `Link`s (and the
 * wordmark's) might target registered as a child route.
 */
async function renderInRouter(ui: ReactNode) {
  const rootRoute = createRootRoute();
  const childRoutes = ["/", "/content", "/feedback"].map((path) =>
    createRoute({ component: () => ui, getParentRoute: () => rootRoute, path }),
  );
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren(childRoutes),
  });

  render(<RouterProvider router={router as never} />);

  await act(async () => {
    await router.load();
  });
}

describe("ToolShell without sections", () => {
  it("renders no section rail, a title bar, and one footer landmark", async () => {
    await renderInRouter(
      <ToolShell
        accountControl={<button type="button">Account</button>}
        homeHref="https://unimatrix-01.dev/"
        homeLabel="Unimatrix-01"
      >
        tool content
      </ToolShell>,
    );

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unimatrix-01" })).toBeInTheDocument();
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });
});

describe("ToolShell with sections", () => {
  it("renders one named navigation landmark, one link per section, and no title bar", async () => {
    await renderInRouter(
      <ToolShell accountControl={<button type="button">Account</button>} sections={SECTIONS}>
        tool content
      </ToolShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Sections" });

    expect(within(nav).getByRole("link", { name: "Content" })).toHaveAttribute("href", "/content");
    expect(within(nav).getByRole("link", { name: "Feedback" })).toHaveAttribute(
      "href",
      "/feedback",
    );
    // The wordmark, not a title bar: `homeLabel` moved into the rail, so no
    // second copy of it renders outside `nav`.
    expect(screen.queryByRole("link", { name: "Unimatrix-01" })).not.toBeInTheDocument();
  });

  it("renders the copyright in the footer below the content", async () => {
    await renderInRouter(
      <ToolShell ownerName="Gwen Phalan" sections={SECTIONS}>
        tool content
      </ToolShell>,
    );

    const footer = screen.getByRole("contentinfo");

    expect(footer).toHaveTextContent(`${new Date().getFullYear()} Gwen Phalan`);
  });

  it("renders exactly one contentinfo landmark", async () => {
    await renderInRouter(
      <ToolShell accountControl={<button type="button">Account</button>} sections={SECTIONS}>
        tool content
      </ToolShell>,
    );

    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });

  it("keeps every section link reachable by name after collapsing, and flips the toggle's name", async () => {
    await renderInRouter(<ToolShell sections={SECTIONS}>tool content</ToolShell>);

    const toggle = screen.getByRole("button", { name: "Collapse sections" });

    fireEvent.click(toggle);

    expect(screen.getByRole("button", { name: "Expand sections" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Content" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Feedback" })).toBeInTheDocument();
  });

  it("resolves the accountControl render-prop form with the rail's collapsed state", async () => {
    const accountControl = vi.fn(({ collapsed }: { collapsed: boolean }) => (
      <span>{collapsed ? "collapsed" : "expanded"}</span>
    ));

    await renderInRouter(
      <ToolShell accountControl={accountControl} sections={SECTIONS}>
        tool content
      </ToolShell>,
    );

    expect(accountControl).toHaveBeenCalledWith({ collapsed: false });
    expect(screen.getByText("expanded")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse sections" }));

    expect(accountControl).toHaveBeenCalledWith({ collapsed: true });
    expect(screen.getByText("collapsed")).toBeInTheDocument();
  });

  it("marks only the active section as the current page", async () => {
    await renderInRouter(<ToolShell sections={SECTIONS}>tool content</ToolShell>);

    expect(screen.getByRole("link", { name: "Content" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("aria-current", "page");
  });

  it("falls back to the no-sections layout when sections is an empty array", async () => {
    await renderInRouter(
      <ToolShell
        accountControl={<button type="button">Account</button>}
        homeHref="https://unimatrix-01.dev/"
        homeLabel="Unimatrix-01"
        sections={[]}
      >
        tool content
      </ToolShell>,
    );

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Unimatrix-01" })).toBeInTheDocument();
    expect(screen.getAllByRole("contentinfo")).toHaveLength(1);
  });
});
