import { RiDeleteBinLine, RiEditLine, RiEyeLine, RiEyeOffLine } from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import type { ContentPost, ContentPostSummary, ContentPostType } from "@unimatrix/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Separator,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@unimatrix/ui/editor";
import { useMemo, useState } from "react";

import { formatPublishedDate } from "@/features/content/entries";
import { useApiClient } from "@/lib/api-client";

import { describeAdminError, useDeletePosts, useSetPostsState } from "./mutations";
import { NewPostButton } from "./post-controls";
import { PostFormDialog } from "./post-form-dialog";
import { adminPostsQueryOptions } from "./queries";

const TYPE_LABELS: Record<ContentPostType, string> = {
  blog: "Blog",
  project: "Project",
};

/**
 * Bulk management for every post in every publication state.
 *
 * Fetched with the unfiltered admin list rather than one request per
 * collection: the table shows both collections together, and filtering
 * client-side keeps switching the filter instant and free.
 */
export function AdminPage() {
  const client = useApiClient();
  const { data, error, isPending } = useQuery(adminPostsQueryOptions(client));
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<ContentPost | null>(null);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const setPostsState = useSetPostsState();
  const deletePosts = useDeletePosts();

  const posts = useMemo(() => data?.posts ?? [], [data]);

  // A row that disappeared between renders — deleted in another tab, say —
  // must not keep contributing to the selection count the confirmation names.
  const selected = useMemo(
    () => posts.filter((post) => selectedIds.has(post.id)),
    [posts, selectedIds],
  );

  const allSelected = posts.length > 0 && selected.length === posts.length;
  const isBusy = setPostsState.isPending || deletePosts.isPending;

  function toggle(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(posts.map((post) => post.id)) : new Set());
  }

  async function handleEdit(post: ContentPostSummary) {
    try {
      setEditing(await client.adminGetPost({ type: post.type, slug: post.slug }));
    } catch (caught) {
      toast.error(describeAdminError(caught));
    }
  }

  if (error !== null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Posts could not be loaded.</EmptyTitle>
          <EmptyDescription>{describeAdminError(error)}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <NewPostButton type="blog" />
        <NewPostButton type="project" />
      </div>

      <Separator />

      <div
        aria-live="polite"
        className="flex min-h-9 flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        {selected.length === 0 ? (
          <span>Select posts to manage them in bulk.</span>
        ) : (
          <>
            <span>
              {selected.length} {selected.length === 1 ? "post" : "posts"} selected
            </span>
            <Button
              className="gap-2"
              disabled={isBusy}
              onClick={() => {
                setPostsState.mutate({
                  ids: selected.map((post) => post.id),
                  publicationState: "published",
                });
              }}
              size="sm"
              variant="outline"
            >
              <RiEyeLine aria-hidden="true" className="size-4" />
              Publish
            </Button>
            <Button
              className="gap-2"
              disabled={isBusy}
              onClick={() => {
                setPostsState.mutate({
                  ids: selected.map((post) => post.id),
                  publicationState: "draft",
                });
              }}
              size="sm"
              variant="outline"
            >
              <RiEyeOffLine aria-hidden="true" className="size-4" />
              Unpublish
            </Button>
            <Button
              className="gap-2"
              disabled={isBusy}
              onClick={() => {
                setIsConfirmingDelete(true);
              }}
              size="sm"
              variant="destructive"
            >
              <RiDeleteBinLine aria-hidden="true" className="size-4" />
              Delete
            </Button>
          </>
        )}
      </div>

      {isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : posts.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No posts yet.</EmptyTitle>
            <EmptyDescription>
              Create a blog post or a project to see it listed here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        // `site-panel` rather than a bare table: every other content surface on
        // this site sits on one, and without it the circuit-field background
        // paints straight through the rows.
        <div className="site-panel overflow-x-auto px-2 py-2 lg:px-4 lg:py-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all posts"
                    checked={allSelected}
                    onCheckedChange={(checked) => {
                      toggleAll(checked === true);
                    }}
                  />
                </TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Published</TableHead>
                <TableHead className="w-24 text-right">Edit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${post.title}`}
                      checked={selectedIds.has(post.id)}
                      onCheckedChange={(checked) => {
                        toggle(post.id, checked === true);
                      }}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="block">{post.title}</span>
                    <span className="block text-xs text-muted-foreground">{post.slug}</span>
                  </TableCell>
                  <TableCell>{TYPE_LABELS[post.type]}</TableCell>
                  <TableCell>
                    <Badge
                      variant={post.publicationState === "published" ? "secondary" : "outline"}
                    >
                      {post.publicationState}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatPublishedDate(post.publishedAt) || "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      aria-label={`Edit ${post.title}`}
                      onClick={() => {
                        void handleEdit(post);
                      }}
                      size="sm"
                      variant="outline"
                    >
                      <RiEditLine aria-hidden="true" className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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

      <AlertDialog onOpenChange={setIsConfirmingDelete} open={isConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* The count is in the heading rather than only in the body copy:
                it is the single fact that decides whether this is the intended
                action, and the database is now the only copy of the content. */}
            <AlertDialogTitle>
              Delete {selected.length} {selected.length === 1 ? "post" : "posts"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selected.length === 1
                ? `"${selected[0]?.title ?? ""}" will be removed from the site and from the admin list.`
                : "They will be removed from the site and from the admin list."}{" "}
              This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deletePosts.mutate(
                  { ids: selected.map((post) => post.id) },
                  {
                    onSuccess: () => {
                      setSelectedIds(new Set());
                    },
                  },
                );
                setIsConfirmingDelete(false);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
