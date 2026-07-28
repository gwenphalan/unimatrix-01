import type { ApiClientFetch } from "../src/config.js";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiClient } from "../src/client.js";

const BASE_URL = "https://api.example.test";

const POST_SUMMARY = {
  id: "11111111-1111-4111-8111-111111111111",
  type: "blog",
  slug: "placeholder-post",
  title: "Placeholder blog",
  summary: "A placeholder entry.",
  description: null,
  publicationState: "published",
  publishedAt: "2026-03-17",
  featured: false,
  projectStatus: null,
  repoUrl: null,
  liveUrl: null,
  updatedAt: "2026-03-17T00:00:00.000Z",
} as const;

const POST = { ...POST_SUMMARY, body: "Body copy." } as const;

/**
 * Every response here is parsed against the contract's own response schema, so
 * these payloads have to be schema-valid — a shape mistake fails the test
 * rather than passing silently.
 */
function respondWith(payload: unknown) {
  return vi.fn(() =>
    Promise.resolve({
      json: () => Promise.resolve(payload),
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    }),
  );
}

const originalFetch = (globalThis as { fetch?: ApiClientFetch }).fetch;

afterEach(() => {
  vi.restoreAllMocks();

  if (originalFetch === undefined) {
    delete (globalThis as { fetch?: ApiClientFetch }).fetch;
    return;
  }

  (globalThis as { fetch?: ApiClientFetch }).fetch = originalFetch;
});

describe("content methods", () => {
  it("lists published posts for one collection", async () => {
    const fetchMock = respondWith({ posts: [POST_SUMMARY] });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.listPosts({ type: "blog" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/posts?type=blog`,
      expect.objectContaining({ method: "GET" }),
    );
    // List responses never carry bodies, and the schema is strict, so a body
    // arriving here would be a parse failure rather than a wasted byte.
    expect(result.posts[0]).not.toHaveProperty("body");
  });

  it("gets one published post by type and slug", async () => {
    const fetchMock = respondWith(POST);
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.getPost({ type: "blog", slug: "placeholder-post" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/post?type=blog&slug=placeholder-post`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.body).toBe("Body copy.");
  });

  it("lists posts for the admin table, filters included", async () => {
    const fetchMock = respondWith({ posts: [POST_SUMMARY] });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.adminListPosts({ type: "blog", publicationState: "draft" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts?type=blog&publicationState=draft`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("omits absent admin filters from the query string", async () => {
    const fetchMock = respondWith({ posts: [] });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.adminListPosts({});

    // Both filters are optional; the unfiltered call must not send empty
    // values, which the API would reject as invalid enum members.
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("gets a post through the admin route, which reaches drafts", async () => {
    const fetchMock = respondWith({ ...POST, publicationState: "draft", publishedAt: null });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.adminGetPost({ type: "blog", slug: "placeholder-post" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/post?type=blog&slug=placeholder-post`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.publicationState).toBe("draft");
  });

  it("creates a post", async () => {
    const fetchMock = respondWith(POST);
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.createPost({
      type: "blog",
      slug: "placeholder-post",
      title: "Placeholder blog",
      summary: "A placeholder entry.",
      body: "Body copy.",
      publicationState: "draft",
      featured: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "blog",
          slug: "placeholder-post",
          title: "Placeholder blog",
          summary: "A placeholder entry.",
          body: "Body copy.",
          publicationState: "draft",
          featured: false,
        }),
      }),
    );
  });

  it("updates a post with a partial body addressed by id", async () => {
    const fetchMock = respondWith(POST);
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    await client.updatePost({ id: POST.id, title: "Renamed" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ id: POST.id, title: "Renamed" }),
      }),
    );
  });

  it("changes publication state in bulk", async () => {
    const fetchMock = respondWith({ affected: 2 });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.setPostsState({
      ids: [POST.id, "22222222-2222-4222-8222-222222222222"],
      publicationState: "published",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts/state`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({ affected: 2 });
  });

  it("deletes posts in bulk", async () => {
    const fetchMock = respondWith({ affected: 1 });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.deletePosts({ ids: [POST.id] });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/posts`,
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ ids: [POST.id] }),
      }),
    );
    expect(result).toEqual({ affected: 1 });
  });

  it("lists assets without any request options", async () => {
    const fetchMock = respondWith({
      assets: [
        {
          hash: "a".repeat(64),
          contentType: "image/png",
          size: 2048,
          originalFilename: "diagram.png",
          createdAt: "2026-07-22T00:00:00.000Z",
        },
      ],
    });
    const client = createApiClient({ baseUrl: BASE_URL, fetch: fetchMock });

    const result = await client.listAssets();

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/content/admin/assets`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.assets[0]?.originalFilename).toBe("diagram.png");
  });
});
