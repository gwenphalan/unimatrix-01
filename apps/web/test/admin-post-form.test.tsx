import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApiClient } from "@unimatrix/api-client";
import type { ContentPost } from "@unimatrix/shared";
import type * as EditorModule from "@unimatrix/ui/editor";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted`, not a plain `const`, and that is what lets `PostForm` be a
// static import below. `vi.mock` is hoisted above every import, so a factory
// closing over a normal module-level `const` reads it inside its temporal dead
// zone the moment anything imports the mocked module at module scope — the file
// fails to collect with "Cannot access 'toastSuccess' before initialization".
// Deferring the import into a test is the other way to dodge that, and is what
// this file used to do; see the note on the import for why it stopped.
const { apiClient, toastError, toastSuccess } = vi.hoisted(() => ({
  apiClient: { createPost: vi.fn(), updatePost: vi.fn() } satisfies Partial<ApiClient>,
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  useApiClient: () => apiClient as unknown as ApiClient,
  apiClient: apiClient as unknown as ApiClient,
}));

vi.mock("@unimatrix/auth/react", () => ({
  useAuth: () => ({ getToken: () => Promise.resolve("token-123") }),
}));

vi.mock("@unimatrix/ui/editor", async () => {
  const actual = await vi.importActual<typeof EditorModule>("@unimatrix/ui/editor");

  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

// Statically imported, not `await import(...)` inside the first test.
// `post-form` reaches `@unimatrix/ui/editor` and CodeMirror through it, and
// resolving that inside a test charged the whole cost to one 5s budget — only
// the first test paid it, the rest hit the module cache. It timed out twice on
// CI, on unrelated branches, while running in under a second locally. At module
// scope the cost lands in collection, which `testTimeout` does not bound.
import { PostForm } from "@/features/admin/post-form";

const PROJECT: ContentPost = {
  id: "33333333-3333-4333-8333-333333333333",
  type: "project",
  slug: "cflop",
  title: "CFLOP",
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

    renderForm(<PostForm title="Edit post" onDone={() => {}} post={null} type="blog" />);

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
        repoUrl: null,
        liveUrl: null,
      });
    });
  });

  it("derives the slug from the title until the slug is typed in", () => {
    renderForm(<PostForm title="Edit post" onDone={() => {}} post={null} type="blog" />);

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
  it("never rewrites an existing post's slug from its title", () => {
    renderForm(<PostForm title="Edit post" onDone={() => {}} post={PROJECT} type="project" />);

    type("Title", "CFLOP Renamed");

    expect(screen.getByLabelText("Slug")).toHaveValue("cflop");
  });

  it("offers no project fields on a blog post", () => {
    renderForm(<PostForm title="Edit post" onDone={() => {}} post={null} type="blog" />);

    expect(screen.queryByLabelText("Repository URL")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Feature on the homepage/u)).not.toBeInTheDocument();
  });

  /**
   * A project's status is whether it answers on its live URL, which
   * `ProjectStatusBadge` measures. A typed field would only ever be a second
   * opinion that nobody remembers to update.
   */
  it("offers no project status field, and never sends one", async () => {
    apiClient.updatePost.mockResolvedValue(PROJECT);

    renderForm(<PostForm onDone={() => {}} post={PROJECT} title="Edit post" type="project" />);

    expect(screen.queryByLabelText("Project status")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updatePost).toHaveBeenCalled();
    });

    // Omitted, not nulled: the update store only writes columns the body
    // carries, so a seeded status survives an edit made through the form.
    expect(apiClient.updatePost.mock.calls[0]?.[0]).not.toHaveProperty("projectStatus");
  });

  it("loads an existing project into the form and sends an update keyed by id", async () => {
    apiClient.updatePost.mockResolvedValue(PROJECT);

    renderForm(<PostForm title="Edit post" onDone={() => {}} post={PROJECT} type="project" />);

    expect(screen.getByLabelText("Title")).toHaveValue("CFLOP");
    expect(screen.getByLabelText("Repository URL")).toHaveValue("https://example.com/repo");

    type("Title", "CFLOP 2");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(apiClient.updatePost).toHaveBeenCalledWith(
        expect.objectContaining({
          id: PROJECT.id,
          title: "CFLOP 2",
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

    renderForm(<PostForm onDone={onDone} post={null} title="Edit post" type="blog" />);

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
  /**
   * The `pattern` attribute is compiled with the `v` flag, and an invalid
   * pattern does not fail the field — the browser drops the constraint
   * silently. `[a-z0-9-]` is legal under `u` and rejected under `v`, so the
   * check has to be the stricter of the two.
   */
  it("uses a slug pattern that compiles under the flag browsers apply", () => {
    renderForm(<PostForm onDone={vi.fn()} post={null} title="Edit post" type="blog" />);

    const pattern = screen.getByLabelText("Slug").getAttribute("pattern");

    expect(pattern).not.toBeNull();
    expect(() => new RegExp(`^(?:${pattern ?? ""})$`, "v")).not.toThrow();
    expect(new RegExp(`^(?:${pattern ?? ""})$`, "v").test("cflop")).toBe(true);
    expect(new RegExp(`^(?:${pattern ?? ""})$`, "v").test("-leading-hyphen")).toBe(false);
  });
});
