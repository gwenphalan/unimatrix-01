import type { ApiClient } from "@unimatrix/api-client";
import type { ContentPostSummary } from "@unimatrix/shared";
import type * as EditorModule from "@unimatrix/ui/editor";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "./helpers/render-in-router";

const apiClient = {
  adminListPosts: vi.fn(),
  adminGetPost: vi.fn(),
  setPostsState: vi.fn(),
  updatePost: vi.fn(),
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

const PROJECT: ContentPostSummary = { ...PUBLISHED, type: "project", slug: "a-project" };

describe("PostControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing for a slug the admin list does not contain", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [] });

    const { PostControls } = await import("@/features/admin/post-controls");
    const { container } = renderInRouter(
      <PostControls part={undefined} slug="a-post" type="blog" />,
    );

    await waitFor(() => {
      expect(apiClient.adminListPosts).toHaveBeenCalled();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("offers Publish for a draft and sends the id the public page never sees", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });
    apiClient.setPostsState.mockResolvedValue({ affected: 1 });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderInRouter(<PostControls part={undefined} slug="a-post" type="blog" />);

    fireEvent.click(await screen.findByRole("button", { name: "Publish" }));

    await waitFor(() => {
      expect(apiClient.setPostsState).toHaveBeenCalledWith({
        ids: [DRAFT.id],
        publicationState: "published",
      });
    });
  });

  it("toggles featured on a project and sends only the changed field", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [PROJECT] });
    apiClient.updatePost.mockResolvedValue({ ...PROJECT, featured: true, body: "" });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderInRouter(<PostControls part={undefined} slug="a-project" type="project" />);

    fireEvent.click(await screen.findByRole("button", { name: "Feature" }));

    await waitFor(() => {
      // A partial update, so a stale summary cannot overwrite a field this
      // control has no business touching.
      expect(apiClient.updatePost).toHaveBeenCalledWith({ id: PROJECT.id, featured: true });
    });
  });

  // The home page lists the most recent entries, not featured ones, so the
  // column exists on a blog row and nothing reads it.
  it("offers no Feature button on a blog entry", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [PUBLISHED] });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderInRouter(<PostControls part={undefined} slug="a-post" type="blog" />);

    await screen.findByRole("button", { name: "Unpublish" });
    expect(screen.queryByRole("button", { name: /feature/iu })).not.toBeInTheDocument();
  });

  it("offers Unpublish for a published post", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [PUBLISHED] });
    apiClient.setPostsState.mockResolvedValue({ affected: 1 });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderInRouter(<PostControls part={undefined} slug="a-post" type="blog" />);

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

    renderInRouter(<PostControls part={undefined} slug="a-post" type="blog" />);

    await screen.findByRole("button", { name: "Publish" });
    // Irreversible and the database is the only copy: delete lives on /admin,
    // behind a selection and a confirmation, not one mis-click from an article.
    expect(screen.queryByRole("button", { name: /delete/iu })).not.toBeInTheDocument();
  });

  it("links Edit at the editor route and fetches no bodies from a listing", async () => {
    apiClient.adminListPosts.mockResolvedValue({ posts: [DRAFT] });

    const { PostControls } = await import("@/features/admin/post-controls");

    renderInRouter(<PostControls part={undefined} slug="a-post" type="blog" />);

    // Addressed by id, which is the only handle that survives the slug being
    // edited in the very form this links to.
    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      `/admin/posts/edit?id=${DRAFT.id}`,
    );
    // The list carries summaries only, and the editor route loads the body, so
    // a twenty-row page fetches no bodies at all.
    expect(apiClient.adminGetPost).not.toHaveBeenCalled();
  });
});
