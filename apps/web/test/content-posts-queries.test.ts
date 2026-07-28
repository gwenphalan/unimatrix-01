import { QueryClient } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { ContentPost, ListPostsResponse } from "@unimatrix/shared";
import { describe, expect, it, vi } from "vitest";

import {
  contentQueryKeys,
  isMissingContentError,
  publishedPostQueryOptions,
  publishedPostsQueryOptions,
} from "@/features/content/queries/content-posts";

const emptyList: ListPostsResponse = { posts: [] };

function createStubClient(overrides: Partial<ApiClient>): ApiClient {
  return overrides as ApiClient;
}

function createSilentQueryClient(): QueryClient {
  // Query errors are expected in these tests; the default logger would print
  // them and make a passing run look broken.
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("publishedPostsQueryOptions", () => {
  it("keys lists per collection so blog and project caches never collide", () => {
    expect(contentQueryKeys.list("blog")).not.toEqual(contentQueryKeys.list("project"));
    expect(contentQueryKeys.detail("blog", "x")).not.toEqual(
      contentQueryKeys.detail("project", "x"),
    );
  });

  it("fetches the requested collection through the supplied client", async () => {
    const listPosts = vi.fn().mockResolvedValue(emptyList);
    const options = publishedPostsQueryOptions("project", createStubClient({ listPosts }));

    await new QueryClient().ensureQueryData(options);

    expect(listPosts).toHaveBeenCalledWith({ type: "project" });
  });

  it("fetches one entry by type and slug", async () => {
    const post = { slug: "a-post" } as ContentPost;
    const getPost = vi.fn().mockResolvedValue(post);
    const options = publishedPostQueryOptions("blog", "a-post", createStubClient({ getPost }));

    await expect(new QueryClient().ensureQueryData(options)).resolves.toBe(post);
    expect(getPost).toHaveBeenCalledWith({ type: "blog", slug: "a-post" });
  });
});

describe("retry policy", () => {
  /**
   * A 404 for a slug that does not exist is a final answer. Retrying it would
   * delay the not-found page by seconds of backoff for no benefit, so the
   * policy is asserted rather than assumed.
   */
  it("does not retry a client error", async () => {
    const getPost = vi
      .fn()
      .mockRejectedValue(new ApiClientError("gone", { status: 404, code: "NOT_FOUND" }));
    const options = publishedPostQueryOptions("blog", "missing", createStubClient({ getPost }));

    await expect(createSilentQueryClient().ensureQueryData(options)).rejects.toThrow("gone");
    expect(getPost).toHaveBeenCalledTimes(1);
  });

  it("retries a server error", async () => {
    const listPosts = vi
      .fn()
      .mockRejectedValueOnce(new ApiClientError("boom", { status: 503 }))
      .mockResolvedValue(emptyList);
    const options = publishedPostsQueryOptions("blog", createStubClient({ listPosts }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });

    await expect(queryClient.ensureQueryData(options)).resolves.toEqual(emptyList);
    expect(listPosts).toHaveBeenCalledTimes(2);
  });
});

describe("isMissingContentError", () => {
  it("treats 404 and a schema-rejected slug as missing content", () => {
    expect(isMissingContentError(new ApiClientError("nope", { status: 404 }))).toBe(true);
    expect(isMissingContentError(new ApiClientError("bad slug", { status: 400 }))).toBe(true);
  });

  it("does not swallow server or transport failures", () => {
    expect(isMissingContentError(new ApiClientError("down", { status: 503 }))).toBe(false);
    expect(isMissingContentError(new TypeError("network"))).toBe(false);
  });
});
