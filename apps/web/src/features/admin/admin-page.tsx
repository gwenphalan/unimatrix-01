import {
  RiAddLine,
  RiDeleteBinLine,
  RiEditLine,
  RiExternalLinkLine,
  RiEyeLine,
  RiEyeOffLine,
} from "@remixicon/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ContentPostSummary, ContentPostType } from "@unimatrix/shared";
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@unimatrix/ui/editor";
import { useMemo, useState } from "react";

import { formatPublishedDate } from "@/features/content/entries";
import { useApiClient } from "@/lib/api-client";

import { AdminPanel } from "./admin-shell";
import { describeAdminError, useDeletePosts, useSetPostsState } from "./mutations";
import { adminPostsQueryOptions } from "./queries";

const COLLECTIONS: readonly { type: ContentPostType; title: string; newLabel: string }[] = [
  { type: "blog", title: "Blog posts", newLabel: "New blog post" },
  { type: "project", title: "Projects", newLabel: "New project" },
];

/**
 * Bulk management, one table per collection.
 *
 * Blog posts and projects are managed separately because they are managed
 * differently: a bulk publish is a decision about one collection, and a shared
 * "select all" across a combined table would sweep up rows from the other.
 * Each {@link PostBulkTable} therefore owns its own selection and its own
 * confirmation — a single shared `selectedIds` would make the delete dialog's
 * count lie about what is being deleted.
 *
 * Still one request: the unfiltered admin list is fetched once here and
 * partitioned by type, so splitting the UI costs no extra round trip.
 */
export function AdminPage() {
  const client = useApiClient();
  const { data, error, isPending } = useQuery(adminPostsQueryOptions(client));

  const posts = useMemo(() => data?.posts ?? [], [data]);

  // The failure is reported inside both panels rather than replacing them with
  // one combined card. One request backs both collections, so a single error
  // card is the honest description of what happened — but it collapses the
  // page to a layout that appears nowhere else, so a transient API failure
  // reads as the dashboard having changed shape. Keeping the two panels means
  // the only thing that changes is what is inside them.
  return (
    <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pb-2 xl:grid-cols-2 xl:items-start">
      {COLLECTIONS.map((collection) => (
        <AdminPanel
          actions={
            <Button asChild className="gap-2" size="sm" variant="outline">
              <Link search={{ type: collection.type }} to="/admin/posts/new">
                <RiAddLine aria-hidden="true" className="size-4" />
                {collection.newLabel}
              </Link>
            </Button>
          }
          key={collection.type}
          title={collection.title}
        >
          <PostBulkTable
            error={error}
            isPending={isPending}
            posts={posts.filter((post) => post.type === collection.type)}
          />
        </AdminPanel>
      ))}
    </div>
  );
}

/**
 * One collection's rows, with its own selection, bulk actions and delete
 * confirmation. Nothing here is shared with the sibling table.
 */
function PostBulkTable({
  error,
  isPending,
  posts,
}: {
  error: Error | null;
  isPending: boolean;
  posts: readonly ContentPostSummary[];
}) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const setPostsState = useSetPostsState();
  const deletePosts = useDeletePosts();

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

  if (isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing here yet.</EmptyTitle>
          <EmptyDescription>Create one to see it listed here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <div
        aria-live="polite"
        className="flex min-h-9 flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        {selected.length === 0 ? (
          <span>Select rows to manage them in bulk.</span>
        ) : (
          <>
            <span>
              {selected.length} selected
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

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all rows"
                  checked={allSelected}
                  onCheckedChange={(checked) => {
                    setSelectedIds(
                      checked === true ? new Set(posts.map((post) => post.id)) : new Set(),
                    );
                  }}
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Published</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
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
                <TableCell>
                  <Badge variant={post.publicationState === "published" ? "secondary" : "outline"}>
                    {post.publicationState}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatPublishedDate(post.publishedAt) || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {/* View first, Edit last. Edit is on every row and View is
                        not, so putting the optional control on the outside
                        keeps Edit in the same place whether or not the post is
                        published — otherwise it slides across as you read down
                        a mixed list.

                        View is the exit that actually gets used: after
                        publishing, the next thing an admin wants is that post
                        on the site. A plain anchor, because it leaves the admin
                        subtree. Absent for a draft, which has no public URL to
                        open — the public routes 404 on anything unpublished. */}
                    {post.publicationState === "published" ? (
                      <Button aria-label={`View ${post.title}`} asChild size="sm" variant="ghost">
                        <a href={`/${post.type === "blog" ? "blog" : "projects"}/${post.slug}`}>
                          <RiExternalLinkLine aria-hidden="true" className="size-4" />
                        </a>
                      </Button>
                    ) : null}
                    <Button aria-label={`Edit ${post.title}`} asChild size="sm" variant="outline">
                      <Link search={{ id: post.id }} to="/admin/posts/edit">
                        <RiEditLine aria-hidden="true" className="size-4" />
                      </Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

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
