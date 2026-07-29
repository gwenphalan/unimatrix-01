import {
  RiAddLine,
  RiEditLine,
  RiEyeLine,
  RiEyeOffLine,
  RiStarFill,
  RiStarLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContentPostSummary, ContentPostType } from "@unimatrix/shared";
import { Badge, Button } from "@unimatrix/ui/editor";

import { useApiClient } from "@/lib/api-client";

import type { PostControlsPart } from "./admin-slot";

import { useSetPostsState, useUpdatePost } from "./mutations";
import { adminPostsQueryOptions, findPostBySlug } from "./queries";

const TYPE_LABELS: Record<ContentPostType, string> = {
  blog: "blog post",
  project: "project",
};

/**
 * "New blog post" / "New project", rendered beside a collection's heading.
 *
 * A link into the admin subtree rather than a dialog: writing a post happens on
 * its own full-height page now, so there is one editor to maintain and the
 * public listing pages stay free of form state.
 */
export function NewPostButton({ type }: { type: ContentPostType }) {
  return (
    <Button asChild className="w-fit gap-2" size="sm" variant="outline">
      <Link search={{ type }} to="/admin/posts/new">
        <RiAddLine aria-hidden="true" className="size-4" />
        New {TYPE_LABELS[type]}
      </Link>
    </Button>
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
export function PostControls({
  type,
  slug,
  part,
}: {
  type: ContentPostType;
  slug: string;
  // Not `part?:` — `exactOptionalPropertyTypes` is on, so an optional property
  // cannot be handed an explicit `undefined`, which is exactly what the slot's
  // own optional `part` forwards.
  part: PostControlsPart | undefined;
}) {
  const client = useApiClient();
  const { data } = useQuery(adminPostsQueryOptions(client, type));
  const post = findPostBySlug(data?.posts, slug);

  if (post === undefined) {
    return null;
  }

  return <PostControlsBar part={part} post={post} />;
}

function PostControlsBar({
  part,
  post,
}: {
  part: PostControlsPart | undefined;
  post: ContentPostSummary;
}) {
  const setPostsState = useSetPostsState();
  const updatePost = useUpdatePost();

  const isPublished = post.publicationState === "published";
  // Blog entries have the column but nothing reads it: the home page lists the
  // most recent posts, not featured ones, so a Feature button there would be a
  // control with no effect.
  const canFeature = post.type === "project";

  // No rule above the bar. It was separating these controls from the page
  // content when they sat at the bottom of it; split across a page's own badge
  // and button rows it would be a line through the middle of one of them.
  return (
    <div className="flex flex-wrap items-center gap-2">
      {part === "actions" ? null : (
        <Badge variant={isPublished ? "secondary" : "outline"}>{post.publicationState}</Badge>
      )}

      {part === "badge" ? null : (
        <>
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

          {canFeature ? (
            <Button
              className="gap-2"
              disabled={updatePost.isPending}
              onClick={() => {
                // `id` plus the one changed field: the update body is a partial,
                // so nothing else about the post is resent and nothing else can
                // be clobbered by a stale summary.
                updatePost.mutate({ id: post.id, featured: !post.featured });
              }}
              size="sm"
              variant="outline"
            >
              {post.featured ? (
                <RiStarFill aria-hidden="true" className="size-4" />
              ) : (
                <RiStarLine aria-hidden="true" className="size-4" />
              )}
              {post.featured ? "Unfeature" : "Feature"}
            </Button>
          ) : null}

          {/* The body is not fetched here any more — the editor route loads it.
              That takes a request off every listing page that shows these. */}
          <Button asChild className="gap-2" size="sm" variant="outline">
            <Link search={{ id: post.id }} to="/admin/posts/edit">
              <RiEditLine aria-hidden="true" className="size-4" />
              Edit
            </Link>
          </Button>
        </>
      )}
    </div>
  );
}
