import { QueryClient } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { ContentPostSummary, ListPostsResponse } from "@unimatrix/shared";
import { describe, expect, it, vi } from "vitest";

import { contentQueryKeys } from "@/features/content/queries/content-posts";
import {
  adminPostsQueryOptions,
  adminQueryKeys,
  findPostBySlug,
  invalidateContent,
} from "@/features/admin/queries";

const POST: ContentPostSummary = {
  id: "0f9d2f5c-8f4d-4d0e-9a4f-2b5e6d7c8a90",
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

function stubClient(response: ListPostsResponse = { posts: [POST] }) {
  const adminListPosts = vi.fn().mockResolvedValue(response);

  return { client: { adminListPosts } as unknown as ApiClient, adminListPosts };
}

describe("admin content queries", () => {
  it("keys admin reads apart from the public ones", () => {
    // The two endpoints answer differently about the same rows — the admin one
    // includes drafts — so a shared key would let a public list render a draft
    // out of the cache.
    expect(adminQueryKeys.list("blog")).not.toEqual(contentQueryKeys.list("blog"));
    expect(adminQueryKeys.list(undefined)).toEqual(["admin", "content", "list", "all"]);
    expect(adminQueryKeys.list("project")).toEqual(["admin", "content", "list", "project"]);
  });

  it("omits the type filter entirely when asked for every collection", async () => {
    const { client, adminListPosts } = stubClient();
    const options = adminPostsQueryOptions(client);

    await options.queryFn?.({} as never);

    // `{}` rather than `{ type: undefined }`: the query schema is a
    // `strictObject`, and an explicit undefined would serialize as a stray key.
    expect(adminListPosts).toHaveBeenCalledWith({});
  });

  it("passes a requested collection through", async () => {
    const { client, adminListPosts } = stubClient();
    const options = adminPostsQueryOptions(client, "project");

    await options.queryFn?.({} as never);

    expect(adminListPosts).toHaveBeenCalledWith({ type: "project" });
  });

  it("does not retry a 403, but does retry a transport failure", () => {
    const { retry } = adminPostsQueryOptions(stubClient().client);
    const shouldRetry = retry as (failureCount: number, error: Error) => boolean;

    expect(shouldRetry(0, new ApiClientError("forbidden", { status: 403 }))).toBe(false);
    expect(shouldRetry(0, new ApiClientError("unauthorized", { status: 401 }))).toBe(false);
    expect(shouldRetry(0, new Error("network down"))).toBe(true);
    expect(shouldRetry(1, new Error("network down"))).toBe(false);
  });

  it("finds a row by slug and tolerates a list that has not loaded", () => {
    expect(findPostBySlug([POST], "a-post")).toBe(POST);
    expect(findPostBySlug([POST], "other")).toBeUndefined();
    expect(findPostBySlug(undefined, "a-post")).toBeUndefined();
  });

  it("invalidates both the public and the admin caches after a write", async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();

    await invalidateContent(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: contentQueryKeys.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: adminQueryKeys.all });
  });
});
