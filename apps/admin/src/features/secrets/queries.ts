import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { ApiClientError, type ApiClient } from "@unimatrix/api-client";
import type { AdminListSecretsResponse } from "@unimatrix/shared";

export const secretsQueryKeys = {
  all: ["admin", "secrets"] as const,
  list: ["admin", "secrets", "list"] as const,
};

/**
 * Never retried, for the same reason as the content queries in
 * `features/content/queries.ts`: every admin call needs a valid `auth:admin`
 * session, so a failure here is a 401/403 far more often than a blip.
 */
function retryUnlessClientError(failureCount: number, error: Error): boolean {
  if (error instanceof ApiClientError && error.status >= 400 && error.status < 500) {
    return false;
  }

  return failureCount < 1;
}

/**
 * The union of what the system expects and what the store holds, plus the
 * keyring's active KEK version. One request backs both panels — the tier on
 * each row is what splits them.
 */
export function secretsQueryOptions(client: ApiClient) {
  return queryOptions<AdminListSecretsResponse>({
    queryKey: secretsQueryKeys.list,
    queryFn: () => client.adminListSecrets(),
    staleTime: 15_000,
    retry: retryUnlessClientError,
  });
}

/** Drops the cached list after a write, so the next render reflects it. */
export async function invalidateSecrets(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: secretsQueryKeys.all });
}
