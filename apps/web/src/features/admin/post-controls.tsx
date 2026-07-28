import { RiAddLine, RiEditLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import type { ContentPost, ContentPostSummary, ContentPostType } from "@unimatrix/shared";
import { Badge, Button, toast } from "@unimatrix/ui/editor";
import { useState } from "react";

import { useApiClient } from "@/lib/api-client";

import { describeAdminError, useSetPostsState } from "./mutations";
import { PostFormDialog } from "./post-form-dialog";
import { adminPostsQueryOptions, findPostBySlug } from "./queries";

const TYPE_LABELS: Record<ContentPostType, string> = {
  blog: "blog post",
  project: "project",
};

/**
 * "New blog post" / "New project", rendered beside a collection's heading.
 */
export function NewPostButton({ type }: { type: ContentPostType }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        className="w-fit gap-2"
        onClick={() => {
          setIsOpen(true);
        }}
        size="sm"
        variant="outline"
      >
        <RiAddLine aria-hidden="true" className="size-4" />
        New {TYPE_LABELS[type]}
      </Button>

      {isOpen ? (
        <PostFormDialog onOpenChange={setIsOpen} open={isOpen} post={null} type={type} />
      ) : null}
    </>
  );
}

/**
 * Edit / publish / unpublish for one post, shown inline on the public listing
 * and detail pages.
 *
 * Addressed by `(type, slug)` because that is all a public page knows about a
 * post — the id never reaches the public contracts. The row is found in the
 * admin list, which every control on a page shares, so a twenty-row listing
 * costs one request rather than twenty.
 *
 * Delete is deliberately absent here and lives only on `/admin`: an
 * irreversible action does not belong one mis-click away from a reading
 * surface.
 */
export function PostControls({ type, slug }: { type: ContentPostType; slug: string }) {
  const client = useApiClient();
  const { data } = useQuery(adminPostsQueryOptions(client, type));
  const post = findPostBySlug(data?.posts, slug);

  if (post === undefined) {
    return null;
  }

  return <PostControlsBar post={post} />;
}

function PostControlsBar({ post }: { post: ContentPostSummary }) {
  const client = useApiClient();
  const setPostsState = useSetPostsState();
  const [editing, setEditing] = useState<ContentPost | null>(null);
  const [isLoadingBody, setIsLoadingBody] = useState(false);

  const isPublished = post.publicationState === "published";

  async function handleEdit() {
    setIsLoadingBody(true);

    try {
      // The list carries summaries only, so the body is fetched when the form
      // is actually opened rather than for every row on the page.
      setEditing(await client.adminGetPost({ type: post.type, slug: post.slug }));
    } catch (error) {
      toast.error(describeAdminError(error));
    } finally {
      setIsLoadingBody(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
      <Badge variant={isPublished ? "secondary" : "outline"}>{post.publicationState}</Badge>

      <Button
        className="gap-2"
        disabled={isLoadingBody}
        onClick={() => {
          void handleEdit();
        }}
        size="sm"
        variant="outline"
      >
        <RiEditLine aria-hidden="true" className="size-4" />
        Edit
      </Button>

      <Button
        className="gap-2"
        disabled={setPostsState.isPending}
        onClick={() => {
          setPostsState.mutate({
            ids: [post.id],
            publicationState: isPublished ? "draft" : "published",
          });
        }}
        size="sm"
        variant="outline"
      >
        {isPublished ? (
          <RiEyeOffLine aria-hidden="true" className="size-4" />
        ) : (
          <RiEyeLine aria-hidden="true" className="size-4" />
        )}
        {isPublished ? "Unpublish" : "Publish"}
      </Button>

      {editing === null ? null : (
        <PostFormDialog
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
            }
          }}
          open
          post={editing}
          type={editing.type}
        />
      )}
    </div>
  );
}
