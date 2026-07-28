import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiClientError } from "@unimatrix/api-client";
import type {
  BulkResult,
  ContentPost,
  ContentPublicationState,
  CreatePostBody,
  DeletePostsBody,
  SetPostsStateBody,
  UpdatePostBody,
} from "@unimatrix/shared";
import { toast } from "@unimatrix/ui/editor";

import { useApiClient } from "@/lib/api-client";

import { invalidateContent } from "./queries";

/**
 * Turns a failed admin call into one line an admin can act on.
 *
 * The API's own message is preferred wherever it has one — a slug collision
 * and a body over the length cap are both 400s, and "that failed" would leave
 * the admin guessing which. The status-specific text is only for the cases
 * where the message would be about HTTP rather than about the post.
 */
export function describeAdminError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) {
      return "Your session has expired. Sign in again to continue.";
    }

    if (error.status === 403) {
      return "Your account does not have admin access.";
    }

    if (error.message.length > 0) {
      return error.message;
    }

    return `The request failed (${String(error.status)}).`;
  }

  return "The request could not be sent. Check your connection and try again.";
}

/**
 * Shared success/failure handling for every admin write.
 *
 * Invalidation runs in `onSuccess` rather than `onSettled` on purpose: a
 * failed write changed nothing, and refetching every content query to
 * rediscover that wastes requests at exactly the moment the API is unhappy.
 */
function useContentMutation<TVariables, TResult>(
  run: (variables: TVariables) => Promise<TResult>,
  describeSuccess: (result: TResult, variables: TVariables) => string,
) {
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TVariables>({
    mutationFn: run,
    onSuccess: async (result, variables) => {
      await invalidateContent(queryClient);
      toast.success(describeSuccess(result, variables));
    },
    onError: (error) => {
      toast.error(describeAdminError(error));
    },
  });
}

const STATE_VERBS: Record<ContentPublicationState, string> = {
  draft: "moved to drafts",
  published: "published",
  archived: "archived",
};

/** How many rows a bulk verb applied to, worded so "1 posts" never appears. */
export function describeAffected(affected: number, state: ContentPublicationState): string {
  return `${String(affected)} ${affected === 1 ? "post" : "posts"} ${STATE_VERBS[state]}.`;
}

export function useCreatePost() {
  const client = useApiClient();

  return useContentMutation<CreatePostBody, ContentPost>(
    (body) => client.createPost(body),
    (post) => `"${post.title}" created as a ${post.publicationState}.`,
  );
}

export function useUpdatePost() {
  const client = useApiClient();

  return useContentMutation<UpdatePostBody, ContentPost>(
    (body) => client.updatePost(body),
    (post) => `"${post.title}" saved.`,
  );
}

export function useSetPostsState() {
  const client = useApiClient();

  return useContentMutation<SetPostsStateBody, BulkResult>(
    (body) => client.setPostsState(body),
    (result, variables) => describeAffected(result.affected, variables.publicationState),
  );
}

export function useDeletePosts() {
  const client = useApiClient();

  return useContentMutation<DeletePostsBody, BulkResult>(
    (body) => client.deletePosts(body),
    ({ affected }) => `${String(affected)} ${affected === 1 ? "post" : "posts"} deleted.`,
  );
}
