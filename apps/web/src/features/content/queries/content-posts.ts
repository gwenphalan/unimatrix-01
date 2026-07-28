import { queryOptions } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { ContentPost, ContentPostType, ListPostsResponse } from "@unimatrix/shared";

import { apiClient } from "@/lib/api-client";

/**
 * Retries transport and server failures, never client ones. A 404 for a slug
 * that does not exist is a final answer, and retrying it three times with
 * backoff would delay the not-found page by seconds for no benefit.
 */
function isRetryable(error: unknown): boolean {
  return !(error instanceof ApiClientError && error.status >= 400 && error.status < 500);
}

const RETRY_DELAYS_MS = [200, 600] as const;

/**
 * Retries inside the query function rather than through TanStack Query's own
 * `retry` option, which cannot be used here.
 *
 * These queries are awaited by route loaders via `ensureQueryData`, and in that
 * position any `retry` above `0` makes the returned promise never settle: the
 * first attempt rejects, no second request is ever issued, and the loader's
 * `await` hangs forever. The router then sits in its pending state with nothing
 * to render, so an unreachable API produced a permanently blank document rather
 * than the route's error component — on `/`, `/blog` and `/projects` alike.
 *
 * Verified by bisection against a running build with the API stopped:
 * `retry: false` renders the error panel correctly, `retry: 1` (with an
 * explicit 300 ms delay, ruling out backoff) and the previous predicate both
 * hang indefinitely. Bypassing TanStack Query in the loader also renders
 * correctly, which places the fault in the retryer rather than in the loader,
 * the transport, or the router.
 *
 * Retrying here keeps the resilience the predicate was written for while
 * TanStack Query sees exactly one attempt that either resolves or rejects.
 */
async function withRetry<T>(attempt: () => Promise<T>): Promise<T> {
  for (const delayMs of RETRY_DELAYS_MS) {
    try {
      return await attempt();
    } catch (error) {
      if (!isRetryable(error)) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // The final attempt is deliberately outside the loop: its rejection is the
  // answer, not something to sleep after.
  return attempt();
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
    queryFn: () => withRetry(() => client.listPosts({ type })),
    staleTime: 60_000,
    retry: false,
  });
}

export function publishedPostQueryOptions(
  type: ContentPostType,
  slug: string,
  client: ApiClient = apiClient,
) {
  return queryOptions<ContentPost>({
    queryKey: contentQueryKeys.detail(type, slug),
    queryFn: () => withRetry(() => client.getPost({ type, slug })),
    staleTime: 60_000,
    retry: false,
  });
}
