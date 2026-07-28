import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import type { ApiClient } from "@unimatrix/api-client";
import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const apiClient = {
  adminListPosts: vi.fn().mockResolvedValue({ posts: [] }),
} satisfies Partial<ApiClient>;

vi.mock("@/lib/api-client", () => ({
  useApiClient: () => apiClient as unknown as ApiClient,
  apiClient: apiClient as unknown as ApiClient,
}));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ getToken: () => Promise.resolve("token-123") }),
}));

/**
 * Mounts a node under a router of its own rather than the app's.
 *
 * `AdminSurface`'s nav-link case renders a `<Link to="/admin">`, which needs a
 * router in context and a matching route to resolve an href against — but the
 * app router would route past the component under test rather than render it.
 */
function renderInRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: () => children });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: "/admin", component: () => null }),
  ]);
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      {/* The test router is deliberately not the app's registered tree. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("AdminSurface", () => {
  it("points the nav link at /admin", async () => {
    const { AdminSurface } = await import("@/features/admin/admin-surface");

    renderInRouter(<AdminSurface kind="nav-link" />);

    // The only route to /admin an admin is ever given: nothing links there from
    // the public navigation, and the route is `noindex`.
    expect(await screen.findByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
  });

  it("mounts the toast region that every admin action reports through", async () => {
    const { AdminSurface } = await import("@/features/admin/admin-surface");
    const { toast } = await import("@unimatrix/ui/editor");

    // Rendered without the router wrapper, and the toast fired only after the
    // region is on screen. Sonner delivers to live subscribers only, so a
    // toast raised before `<Toaster />` mounts is dropped — which is what a
    // router-deferred mount would silently turn this into a false failure.
    render(<AdminSurface kind="toaster" />);
    await screen.findByRole("region", { name: /Notifications/u });

    await act(async () => {
      toast.success("Published.");
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // Asserted through the rendered toast rather than the `toast` mock every
    // other admin test installs: this is the one test that proves `<Toaster />`
    // and the `toast()` feeding it resolve to the same copy of sonner. Two
    // copies render nothing here while every mocked test still passes.
    expect(await screen.findByText("Published.")).toBeInTheDocument();
  });

  it("renders a create button for each collection", async () => {
    const { AdminSurface } = await import("@/features/admin/admin-surface");

    renderInRouter(
      <>
        <AdminSurface kind="new-post" type="blog" />
        <AdminSurface kind="new-post" type="project" />
      </>,
    );

    expect(await screen.findByRole("button", { name: "New blog post" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("dispatches the page and post-controls cases to their own components", async () => {
    const { AdminSurface } = await import("@/features/admin/admin-surface");

    renderInRouter(
      <>
        <AdminSurface kind="page" />
        <AdminSurface kind="post-controls" slug="a-post" type="blog" />
      </>,
    );

    // Both cases read the admin list; reaching the API at all is what proves
    // the switch landed on them rather than falling through to `undefined`.
    expect(await screen.findByText("Select posts to manage them in bulk.")).toBeInTheDocument();
    expect(apiClient.adminListPosts).toHaveBeenCalled();
  });
});
