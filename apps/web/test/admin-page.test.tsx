import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@unimatrix/api-client";
import type { ContentPostSummary } from "@unimatrix/shared";
import type * as EditorModule from "@unimatrix/ui/editor";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = {
  adminListPosts: vi.fn(),
  adminGetPost: vi.fn(),
  setPostsState: vi.fn(),
  deletePosts: vi.fn(),
} satisfies Partial<ApiClient>;

vi.mock("@/lib/api-client", () => ({
  useApiClient: () => apiClient as unknown as ApiClient,
  apiClient: apiClient as unknown as ApiClient,
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

// Only the toast host is stubbed out — the table, checkboxes, and alert dialog
// under test are the real primitives from `@unimatrix/ui/editor`.
vi.mock("@unimatrix/ui/editor", async () => {
  const actual = await vi.importActual<typeof EditorModule>("@unimatrix/ui/editor");

  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

function summary(overrides: Partial<ContentPostSummary> = {}): ContentPostSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    type: "blog",
    slug: "a-post",
    title: "A post",
    summary: "Summary.",
    description: null,
    publicationState: "draft",
    publishedAt: null,
    featured: false,
    projectStatus: null,
    repoUrl: null,
    liveUrl: null,
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

const DRAFT = summary();
const PUBLISHED = summary({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "shipped",
  title: "Shipped project",
  type: "project",
  publicationState: "published",
  publishedAt: "2026-07-01T00:00:00.000Z",
});

function renderAdminPage(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe("AdminPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT, PUBLISHED] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists every post in every publication state", async () => {
    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    expect(await screen.findByText("A post")).toBeInTheDocument();
    expect(screen.getByText("Shipped project")).toBeInTheDocument();
    // Drafts are the whole reason this page exists — they are absent from the
    // public list by design.
    expect(screen.getByText("draft")).toBeInTheDocument();
    expect(screen.getByText("published")).toBeInTheDocument();
    // One unfiltered request, not one per collection.
    expect(apiClient.adminListPosts).toHaveBeenCalledWith({});
  });

  it("keeps bulk actions hidden until something is selected", async () => {
    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    expect(await screen.findByText(/Select posts to manage them in bulk/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("publishes exactly the selected rows", async () => {
    apiClient.setPostsState.mockResolvedValue({ affected: 1 });

    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select A post" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(apiClient.setPostsState).toHaveBeenCalledWith({
        ids: [DRAFT.id],
        publicationState: "published",
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith("1 post published.");
  });

  it("selects and clears every row through the header checkbox", async () => {
    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select all posts" }));
    expect(screen.getByText("2 posts selected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select all posts" }));
    expect(screen.getByText(/Select posts to manage them in bulk/u)).toBeInTheDocument();
  });

  it("names the count in the delete confirmation and deletes nothing until it is confirmed", async () => {
    apiClient.deletePosts.mockResolvedValue({ affected: 2 });

    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select all posts" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");

    // The count is the single fact that decides whether this is the intended
    // action, and the database is the only copy of the content now.
    expect(within(dialog).getByText("Delete 2 posts?")).toBeInTheDocument();
    expect(apiClient.deletePosts).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(apiClient.deletePosts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(apiClient.deletePosts).toHaveBeenCalledWith({ ids: [DRAFT.id, PUBLISHED.id] });
    });
  });

  it("uses the singular in the confirmation for one post and names it", async () => {
    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select A post" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");

    expect(within(dialog).getByText("Delete 1 post?")).toBeInTheDocument();
    expect(within(dialog).getByText(/"A post" will be removed/u)).toBeInTheDocument();
  });

  it("reports a failed load instead of rendering an empty table", async () => {
    apiClient.adminListPosts.mockRejectedValue(new Error("network down"));

    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    expect(await screen.findByText("Posts could not be loaded.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("says so when there is nothing to manage", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [] });

    const { AdminPage } = await import("@/features/admin/admin-page");

    renderAdminPage(<AdminPage />);

    expect(await screen.findByText("No posts yet.")).toBeInTheDocument();
  });
});
