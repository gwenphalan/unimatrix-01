import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@unimatrix/api-client";
import type { ContentPost } from "@unimatrix/shared";
import type * as EditorModule from "@unimatrix/ui/editor";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = {
  createPost: vi.fn(),
  updatePost: vi.fn(),
} satisfies Partial<ApiClient>;

vi.mock("@/lib/api-client", () => ({
  useApiClient: () => apiClient as unknown as ApiClient,
  apiClient: apiClient as unknown as ApiClient,
}));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ getToken: () => Promise.resolve("token-123") }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@unimatrix/ui/editor", async () => {
  const actual = await vi.importActual<typeof EditorModule>("@unimatrix/ui/editor");

  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

const PROJECT: ContentPost = {
  id: "33333333-3333-4333-8333-333333333333",
  type: "project",
  slug: "cube-trainer",
  title: "Cube Trainer",
  summary: "A trainer.",
  description: null,
  body: "# Heading\n",
  publicationState: "published",
  publishedAt: "2026-07-01T00:00:00.000Z",
  featured: true,
  projectStatus: "live",
  repoUrl: "https://example.com/repo",
  liveUrl: null,
  updatedAt: "2026-07-28T00:00:00.000Z",
};

function renderForm(node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

function type(label: RegExp | string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("PostForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a blog post as a draft without any project-only fields", async () => {
    apiClient.createPost.mockResolvedValue({ ...PROJECT, title: "New post" });

    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={() => {}} post={null} type="blog" />);

    type("Title", "New post");
    type("Slug", "new-post");
    type("Summary", "A summary.");

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(apiClient.createPost).toHaveBeenCalledWith({
        type: "blog",
        slug: "new-post",
        title: "New post",
        summary: "A summary.",
        // An empty text input means "no value"; the contract spells that null.
        description: null,
        body: "",
        publicationState: "draft",
        // Project-only columns stay null on a blog row rather than picking up
        // the form's defaults.
        featured: false,
        projectStatus: null,
        repoUrl: null,
        liveUrl: null,
      });
    });
  });

  it("derives the slug from the title until the slug is typed in", async () => {
    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={() => {}} post={null} type="blog" />);

    type("Title", "A Post About Things");
    expect(screen.getByLabelText("Slug")).toHaveValue("a-post-about-things");

    // Once it is typed by hand it stops following: a slug is a URL, and having
    // a later title edit silently rewrite it is how links break.
    type("Slug", "custom-slug");
    type("Title", "A Different Title");
    expect(screen.getByLabelText("Slug")).toHaveValue("custom-slug");

    // Clearing it hands control back, which is the only way to recover the
    // derived value after typing one by hand.
    type("Slug", "");
    type("Title", "Back To Derived");
    expect(screen.getByLabelText("Slug")).toHaveValue("back-to-derived");
  });

  /**
   * An existing post's slug is its published URL. Editing the title must never
   * rewrite it, so derivation starts off rather than on when editing.
   */
  it("never rewrites an existing post's slug from its title", async () => {
    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={() => {}} post={PROJECT} type="project" />);

    type("Title", "Cube Trainer Renamed");

    expect(screen.getByLabelText("Slug")).toHaveValue("cube-trainer");
  });

  it("offers no project fields on a blog post", async () => {
    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={() => {}} post={null} type="blog" />);

    expect(screen.queryByLabelText("Repository URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Feature on the homepage/u)).not.toBeInTheDocument();
  });

  it("loads an existing project into the form and sends an update keyed by id", async () => {
    apiClient.updatePost.mockResolvedValue(PROJECT);

    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={() => {}} post={PROJECT} type="project" />);

    expect(screen.getByLabelText("Title")).toHaveValue("Cube Trainer");
    expect(screen.getByLabelText("Repository URL")).toHaveValue("https://example.com/repo");

    type("Title", "Cube Trainer 2");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PROJECT.id,
          title: "Cube Trainer 2",
          projectStatus: "live",
          featured: true,
        }),
      );
    });

    // `type` is not a field of the update contract's strictObject, so an
    // inherited key — even one set to undefined — would be a 400.
    expect(apiClient.updatePost.mock.calls[0]?.[0]).not.toHaveProperty("type");
  });

  it("keeps the dialog open and reports the failure when a save is rejected", async () => {
    const onDone = vi.fn();

    apiClient.createPost.mockRejectedValue(new Error("nope"));

    const { PostForm } = await import("@/features/admin/post-form");

    renderForm(<PostForm onDone={onDone} post={null} type="blog" />);

    type("Title", "New post");
    type("Slug", "new-post");
    type("Summary", "A summary.");

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled();
    });
    // Closing on failure would discard whatever the admin had typed.
    expect(onDone).not.toHaveBeenCalled();
  });
});
