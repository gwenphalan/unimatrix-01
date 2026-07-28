import type { ApiClient } from "@unimatrix/api-client";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderInRouter } from "./helpers/render-in-router";

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

describe("AdminSurface", () => {
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

    // Links, not buttons: creating a post navigates to its own route now.
    expect(await screen.findByRole("link", { name: "New blog post" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New project" })).toBeInTheDocument();
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
    expect(await screen.findByRole("region", { name: "Blog posts" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Projects" })).toBeInTheDocument();
    expect(apiClient.adminListPosts).toHaveBeenCalled();
  });
});
