import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@unimatrix/api-client";
import type { ContentPostSummary } from "@unimatrix/shared";
import type * as EditorModule from "@unimatrix/ui/editor";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = {
  adminListPosts: vi.fn(),
  adminGetPost: vi.fn(),
  setPostsState: vi.fn(),
} satisfies Partial<ApiClient>;

vi.mock("@/lib/api-client", () => ({
  useApiClient: () => apiClient as unknown as ApiClient,
  apiClient: apiClient as unknown as ApiClient,
}));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ getToken: () => Promise.resolve("token-123") }),
}));

const toastError = vi.fn();

vi.mock("@unimatrix/ui/editor", async () => {
  const actual = await vi.importActual<typeof EditorModule>("@unimatrix/ui/editor");

  return { ...actual, toast: { success: vi.fn(), error: toastError } };
});

const DRAFT: ContentPostSummary = {
  id: "44444444-4444-4444-8444-444444444444",
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
};

const PUBLISHED: ContentPostSummary = { ...DRAFT, publicationState: "published" };

function renderControls(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

describe("PostControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a slug the admin list does not contain", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [] });

    const { PostControls } = await import("@/features/admin/post-controls");
    const { container } = renderControls(<PostControls slug="a-post" type="blog" />);

    await waitFor(() => {
      expect(apiClient.adminListPosts).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Publish for a draft and sends the id the public page never sees", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });
    apiClient.setPostsState.mockResolvedValue({ affected: 1 });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderControls(<PostControls slug="a-post" type="blog" />);

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(apiClient.setPostsState).toHaveBeenCalledWith({
        ids: [DRAFT.id],
        publicationState: "published",
      });
    });
  });

  it("offers Unpublish for a published post", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [PUBLISHED] });
    apiClient.setPostsState.mockResolvedValue({ affected: 1 });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderControls(<PostControls slug="a-post" type="blog" />);

    fireEvent.click(await screen.findByRole("button", { name: "Unpublish" }));

    await waitFor(() => {
      expect(apiClient.setPostsState).toHaveBeenCalledWith({
        ids: [PUBLISHED.id],
        publicationState: "draft",
      });
    });
  });

  it("never offers Delete beside a reading surface", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderControls(<PostControls slug="a-post" type="blog" />);

    await screen.findByRole("button", { name: "Publish" });
    // Irreversible and the database is the only copy: delete lives on /admin,
    // behind a selection and a confirmation, not one mis-click from an article.
    expect(screen.queryByRole("button", { name: /delete/iu })).not.toBeInTheDocument();
  });

  it("fetches the body only when the editor is opened", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });
    apiClient.adminGetPost.mockResolvedValue({ ...DRAFT, body: "# Body\n" });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderControls(<PostControls slug="a-post" type="blog" />);

    await screen.findByRole("button", { name: "Publish" });
    // The list carries summaries only, so a twenty-row page does not fetch
    // twenty bodies.
    expect(apiClient.adminGetPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(apiClient.adminGetPost).toHaveBeenCalledWith({ type: "blog", slug: "a-post" });
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("reports a failed body fetch instead of opening an empty editor", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });
    apiClient.adminGetPost.mockRejectedValue(new Error("network down"));

    const { PostControls } = await import("@/features/admin/post-controls");

    renderControls(<PostControls slug="a-post" type="blog" />);

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
