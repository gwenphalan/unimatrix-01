import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { useAdminSections } from "../src/app/sections.js";

function SectionLabels() {
  const sections = useAdminSections();

  return (
    <ul>
      {sections.map((section) => (
        <li key={section.to}>
          {section.label}: {section.active ? "active" : "inactive"}
        </li>
      ))}
    </ul>
  );
}

async function renderAt(pathname: string) {
  const rootRoute = createRootRoute();
  const routes = [
    "/",
    "/content",
    "/feedback",
    "/deploys",
    "/analytics",
    "/social",
    "/secrets",
  ].map((path) => createRoute({ component: SectionLabels, getParentRoute: () => rootRoute, path }));
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [pathname] }),
    routeTree: rootRoute.addChildren(routes),
  });

  render(<RouterProvider router={router as never} />);

  await act(async () => {
    await router.load();
  });
}

describe("useAdminSections", () => {
  it("marks only Overview active at the root, an exact match", async () => {
    await renderAt("/");

    expect(screen.getByText("Overview: active")).toBeInTheDocument();
    expect(screen.getByText("Content: inactive")).toBeInTheDocument();
  });

  it("marks the section whose path prefixes the current location active", async () => {
    await renderAt("/content");

    expect(screen.getByText("Content: active")).toBeInTheDocument();
    expect(screen.getByText("Overview: inactive")).toBeInTheDocument();
    expect(screen.getByText("Feedback: inactive")).toBeInTheDocument();
  });
});
