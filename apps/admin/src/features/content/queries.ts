import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { ContentPostSummary, ContentPostType, ListPostsResponse } from "@unimatrix/shared";

/**
 * Admin reads, keyed separately from the public ones. The two answer different
 * questions about the same rows — `/content/posts` returns published entries,
 * `/content/admin/posts` returns drafts and archived ones too — so sharing a
 * key would let a public list render admin-only rows out of the cache.
 */
export const adminQueryKeys = {
  all: ["admin", "content"] as const,
  list: (type?: ContentPostType) => ["admin", "content", "list", type ?? "all"] as const,
};

/**
 * Never retried. Every admin call needs a valid `auth:admin` session, so a
 * failure here is a 401 or a 403 far more often than a blip, and retrying it
 * only delays telling the admin their session is the problem.
 *
 * A `retry` option is safe here, unlike on the public content queries, because
 * these are read through `useQuery` inside components that render their own
 * pending and error states. Do not move one of these into a route loader
 * without also setting `retry: false` — awaited through `ensureQueryData`, any
 * retry above `0` leaves the promise unsettled and the route renders nothing
 * at all.
 */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 1;
}

/**
 * Every post in a collection, in every publication state.
 */
export function adminPostsQueryOptions(client: ApiClient, type?: ContentPostType) {
  return queryOptions<ListPostsResponse>({
    queryKey: adminQueryKeys.list(type),
    queryFn: () => client.adminListPosts(type === undefined ? {} : { type }),
    staleTime: 15_000,
    retry: retryUnlessClientError,
  });
}

/** The row for one slug, or `undefined` while the list is still loading. */
export function findPostBySlug(
  posts: readonly ContentPostSummary[] | undefined,
  slug: string,
): ContentPostSummary | undefined {
  return posts?.find((post) => post.slug === slug);
}

/**
 * Drops every cached admin content read after a write.
 *
 * There is no public content cache to invalidate here — that lives in
 * `apps/web`, on a different origin with its own query client — so this only
 * touches the admin keys.
 */
export async function invalidateContent(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: adminQueryKeys.all });
}
