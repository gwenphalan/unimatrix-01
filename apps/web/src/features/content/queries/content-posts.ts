import { queryOptions } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { ContentPost, ContentPostType, ListPostsResponse } from "@unimatrix/shared";

import { apiClient } from "@/lib/api-client";

/**
 * Retries transport and server failures, never client ones. A 404 for a slug
 * that does not exist is a final answer, and retrying it three times with
 * backoff would delay the not-found page by seconds for no benefit.
 */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 2;
}

/**
 * Whether an error means "this content is not here": a 404, or a 400 for a
 * slug the shared schema rejects. Both are answered with the route's
 * not-found component rather than an error boundary.
 */
export function isMissingContentError(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 404 || error.status === 400);
}

/**
 * Query keys for published content. Kept in one place so the admin mutations
 * added later invalidate exactly what the public pages read.
 */
export const contentQueryKeys = {
  all: ["content"] as const,
  list: (type: ContentPostType) => ["content", "list", type] as const,
  detail: (type: ContentPostType, slug: string) => ["content", "detail", type, slug] as const,
};

/**
 * Published entries for one collection. Uses the tokenless client: this is
 * public data, and the public site must keep rendering when Clerk is not
 * configured at all.
 *
 * `staleTime` matches the API's own `max-age`, so a client-side navigation
 * back to a list does not refetch content the browser would have served from
 * cache anyway.
 */
export function publishedPostsQueryOptions(type: ContentPostType, client: ApiClient = apiClient) {
  return queryOptions<ListPostsResponse>({
    queryKey: contentQueryKeys.list(type),
    queryFn: () => client.listPosts({ type }),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}

export function publishedPostQueryOptions(
  type: ContentPostType,
  slug: string,
  client: ApiClient = apiClient,
) {
  return queryOptions<ContentPost>({
    queryKey: contentQueryKeys.detail(type, slug),
    queryFn: () => client.getPost({ type, slug }),
    staleTime: 60_000,
    retry: retryUnlessClientError,
  });
}
