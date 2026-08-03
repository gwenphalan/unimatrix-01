import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ContentPost, ContentPostType } from "@unimatrix/shared";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle, Skeleton } from "@unimatrix/ui/editor";

import { useApiClient } from "@/lib/api-client";

import { AdminPanel } from "./content-panel";
import { describeAdminError } from "./mutations";
import { PostForm } from "./post-form";
import { adminPostsQueryOptions } from "./queries";

const TYPE_LABELS: Record<ContentPostType, string> = {
  blog: "blog post",
  project: "project",
};

/**
 * `/content/posts/new` and `/content/posts/edit` — the full-page editor.
 *
 * Editing is addressed by id because that is the only stable handle: the slug
 * is editable in the very form this page renders, so a slug-addressed URL would
 * stop resolving the moment it was saved.
 *
 * There is no get-by-id contract, so the row is found in the admin list — which
 * `/content` has almost always already cached — and the body is then fetched by
 * `(type, slug)`. Two requests on a cold load, one on the common path from the
 * admin table.
 */
export function PostFormPage({
  baseUrl,
  postId,
  type,
}: {
  baseUrl: string;
  postId: string | null;
  type: ContentPostType;
}) {
  const client = useApiClient();
  const navigate = useNavigate();

  const list = useQuery({ ...adminPostsQueryOptions(client), enabled: postId !== null });
  const summary = list.data?.posts.find((post) => post.id === postId);

  const detail = useQuery<ContentPost>({
    queryKey: ["admin", "content", "post", summary?.type, summary?.slug],
    queryFn: () => {
      if (summary === undefined) {
        throw new Error("The post is no longer in the admin list.");
      }

      return client.adminGetPost({ type: summary.type, slug: summary.slug });
    },
    enabled: summary !== undefined,
    // A post being edited must never come from a stale cache: the form seeds
    // its state once, on mount, so anything stale here is silently written back
    // over whatever the row actually holds.
    staleTime: 0,
    retry: false,
  });

  function leave() {
    void navigate({ to: "/content" });
  }

  // `PostForm` renders its own panel — the publication state lives in the panel
  // header and has to stay inside the `<form>`.
  if (postId === null) {
    return (
      <PostForm
        baseUrl={baseUrl}
        onDone={leave}
        post={null}
        title={`New ${TYPE_LABELS[type]}`}
        type={type}
      />
    );
  }

  const error = list.error ?? detail.error;

  if (error !== null) {
    return (
      <AdminPanel title="Edit post">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>This post could not be loaded.</EmptyTitle>
            <EmptyDescription>{describeAdminError(error)}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </AdminPanel>
    );
  }

  // The list has resolved and holds no row with this id — a deleted post, or a
  // hand-typed URL. Distinct from "still loading", which shows skeletons.
  if (!list.isPending && summary === undefined) {
    return (
      <AdminPanel title="Edit post">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>That post no longer exists.</EmptyTitle>
            <EmptyDescription>It may have been deleted from another tab.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </AdminPanel>
    );
  }

  if (detail.data === undefined) {
    return (
      <AdminPanel title="Edit post">
        <div className="grid gap-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </AdminPanel>
    );
  }

  return (
    <PostForm
      baseUrl={baseUrl}
      onDone={leave}
      post={detail.data}
      title={`Edit ${TYPE_LABELS[detail.data.type]}`}
      type={detail.data.type}
    />
  );
}
