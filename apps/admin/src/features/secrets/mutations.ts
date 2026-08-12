import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@unimatrix/api-client";
import type {
  AdminCreateSecretBody,
  AdminDeleteSecretBody,
  AdminDeleteSecretResponse,
  AdminRotateSecretBody,
  SecretMetadata,
} from "@unimatrix/shared";
import { toast } from "@unimatrix/ui/editor";

import { useApiClient } from "@/lib/api-client";

import { invalidateSecrets } from "./queries";

/**
 * Turns a failed admin call into one line an admin can act on.
 *
 * 409 (a duplicate name) and 404 (a name outside the store's namespace) are
 * both admin-actionable, so the API's own message is preferred for them, same
 * as the generic 400 case. 429 and 502 are distinct because neither is the
 * admin's fault: 429 is the store's own rate limit on the admin routes (20
 * requests/min — `apps/api/src/plugins/rate-limit.ts`), and 502 is the store
 * being unreachable, not a bad request.
 */
export function describeSecretsError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again to continue.";
    }

    if (error.status === 403) {
      return "Your account does not have admin access.";
    }

    if (error.status === 429) {
      return "Too many requests. Wait a moment and try again.";
    }

    if (error.status === 502) {
      return "The secrets store is unavailable right now. Try again shortly.";
    }

    if (error.message.length > 0) {
      return error.message;
    }

    return `The request failed (${String(error.status)}).`;
  }

  return "The request could not be sent. Check your connection and try again.";
}

/**
 * Shared success/failure handling for every admin secrets write.
 *
 * Invalidation runs in `onSuccess` rather than `onSettled`, same reasoning as
 * `useContentMutation`: a failed write changed nothing, and refetching the
 * list to rediscover that wastes a request at exactly the moment the API or
 * the store is unhappy.
 */
function useSecretsMutation<TVariables, TResult>(
  run: (variables: TVariables) => Promise<TResult>,
  describeSuccess: (result: TResult, variables: TVariables) => string,
) {
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TVariables>({
    mutationFn: run,
    onSuccess: async (result, variables) => {
      await invalidateSecrets(queryClient);
      toast.success(describeSuccess(result, variables));
    },
    onError: (error) => {
      toast.error(describeSecretsError(error));
    },
  });
}

/**
 * Backs both `Set value` on a name the store has nothing for and `Add
 * credential`. One route either way — the difference is where the name came
 * from, which is a property of the dialog, not of the request.
 */
export function useSetSecretValue() {
  const client = useApiClient();

  return useSecretsMutation<AdminCreateSecretBody, SecretMetadata>(
    (body) => client.adminCreateSecret(body),
    (secret) => `"${secret.name}" set.`,
  );
}

/**
 * The success toast names the returned `maskedPrefix` — rotation is the only
 * confirmation an admin gets that the new value actually took, since no route
 * this app can reach ever returns the value itself.
 */
export function useRotateSecret() {
  const client = useApiClient();

  return useSecretsMutation<AdminRotateSecretBody, SecretMetadata>(
    (body) => client.adminRotateSecret(body),
    (secret) => `Rotated. New prefix: ${secret.maskedPrefix}…`,
  );
}

/**
 * `Clear value` in the console, a delete in the store: every sealed version of
 * the name is destroyed. The console's word is the operator's, because for a
 * declared name the row survives the call — the registry is what remembers
 * that the system still expects it.
 */
export function useClearSecretValue() {
  const client = useApiClient();

  return useSecretsMutation<AdminDeleteSecretBody, AdminDeleteSecretResponse>(
    (body) => client.adminDeleteSecret(body),
    (_result, variables) => `"${variables.name}" cleared.`,
  );
}
