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
import {
  formatPublishedDate,
  type ContentPostSummary,
  type ContentPostType,
} from "@unimatrix/shared";
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
  useIsMobile,
} from "@unimatrix/ui/editor";
import { useMemo, useState } from "react";

import { useApiClient } from "@/lib/api-client";
import { SectionPanel } from "@/features/sections/section-panel";

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
export function PostsPage() {
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
    // `content-start items-start` at every width, not just `xl`. A grid inside
    // a flex column is taller than its rows, and both defaults spend that
    // slack: `align-content` stretches the *rows apart*, `align-items`
    // stretches each panel to fill its row. Stacked on a phone that produced a
    // panel whose border sat far below its own table, with a gap between the
    // two collections wide enough to read as a rendering fault.
    <div className="grid min-h-0 flex-1 content-start items-start gap-4 overflow-y-auto pb-2 xl:grid-cols-2">
      {COLLECTIONS.map((collection) => (
        <SectionPanel
          actions={
            <Button asChild className="gap-2" size="sm" variant="outline">
              <Link search={{ type: collection.type }} to="/content/posts/new">
                <RiAddLine aria-hidden="true" className="size-4" />
                {collection.newLabel}
              </Link>
            </Button>
          }
          // A grid item's `min-width` is `auto`, so the table's intrinsic width
          // widens the track rather than being scrolled inside it — and since
          // the container sets `overflow-y`, its `overflow-x` computes to
          // `auto` too, so the whole dashboard scrolled sideways on a phone
          // instead of just the table.
          className="min-w-0"
          key={collection.type}
          title={collection.title}
        >
          <PostBulkTable
            error={error}
            isPending={isPending}
            posts={posts.filter((post) => post.type === collection.type)}
          />
        </SectionPanel>
      ))}
    </div>
  );
}

/**
 * The row's publication state.
 *
 * Rendered twice with one of the two hidden by width: it is a column of its own
 * where there is room for one, and part of the title cell on a phone. Sharing
 * the component is what keeps the two from drifting apart.
 */
function StateBadge({ className, post }: { className?: string; post: ContentPostSummary }) {
  return (
    <Badge
      className={className}
      variant={post.publicationState === "published" ? "secondary" : "outline"}
    >
      {post.publicationState}
    </Badge>
  );
}

/**
 * The controls that act on one row, identical in the table and the mobile list.
 *
 * View first, Edit next, Delete last. Edit is on every row and View is not, so
 * putting the optional control on the outside keeps Edit in the same place
 * whether or not the post is published — otherwise it slides across as you read
 * down a mixed list.
 *
 * View is the exit that actually gets used: after publishing, the next thing an
 * admin wants is that post on the site. A plain anchor, because it leaves the
 * admin subtree — and now leaves the origin entirely, since the public site is
 * a different one. Absent for a draft, which has no public URL to open — the
 * public routes 404 on anything unpublished.
 */
function RowActions({
  isBusy,
  onDelete,
  post,
}: {
  isBusy: boolean;
  onDelete: () => void;
  post: ContentPostSummary;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-1">
      {post.publicationState === "published" ? (
        <Button aria-label={`View ${post.title}`} asChild size="sm" variant="ghost">
          <a
            href={`https://unimatrix-01.dev/${post.type === "blog" ? "blog" : "projects"}/${post.slug}`}
          >
            <RiExternalLinkLine aria-hidden="true" className="size-4" />
          </a>
        </Button>
      ) : null}
      <Button aria-label={`Edit ${post.title}`} asChild size="sm" variant="outline">
        <Link search={{ id: post.id }} to="/content/posts/edit">
          <RiEditLine aria-hidden="true" className="size-4" />
        </Link>
      </Button>
      {/* Filled red, and last. Deleting one row goes through the same
          confirmation as the bulk button — the dialog is told what to delete
          rather than reading the selection, so this removes the row it sits in
          whatever happens to be ticked. */}
      <Button
        aria-label={`Delete ${post.title}`}
        // The `destructive` variant's tinted fill and red glyph, plus the red
        // edge it does not draw itself — the base button class borders in
        // `transparent`, so the box only reads as a box once this is set.
        className="border border-destructive"
        disabled={isBusy}
        onClick={onDelete}
        size="sm"
        variant="destructive"
      >
        <RiDeleteBinLine aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}

/**
 * One collection's rows, with its own selection, bulk actions and delete
 * confirmation. Nothing here is shared with the sibling table.
 *
 * Below the mobile breakpoint the table is replaced by a compact list rather
 * than being made to fit: five columns at 390px either scroll sideways or turn
 * every row into four stacked lines. Which one renders is decided in JS, not by
 * a `sm:hidden` pair, so only one set of per-row controls is ever in the tree —
 * two buttons with the same accessible name is an accessibility fault, not a
 * layout detail.
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
  /**
   * What the open confirmation is about to delete, or `null` when it is closed.
   *
   * One dialog serves both entry points — the bulk button and the per-row one —
   * because they differ only in what they target. Holding the target rather
   * than a boolean is what stops the row button from silently deleting the
   * current *selection* instead of the row it sits in.
   */
  const [pendingDelete, setPendingDelete] = useState<readonly ContentPostSummary[] | null>(null);
  const setPostsState = useSetPostsState();
  const deletePosts = useDeletePosts();
  const isMobile = useIsMobile();

  // A row that disappeared between renders — deleted in another tab, say —
  // must not keep contributing to the selection count the confirmation names.
  const selected = useMemo(
    () => posts.filter((post) => selectedIds.has(post.id)),
    [posts, selectedIds],
  );

  const allSelected = posts.length > 0 && selected.length === posts.length;
  const isBusy = setPostsState.isPending || deletePosts.isPending;
  const targeted = pendingDelete ?? [];

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
            <span>{selected.length} selected</span>
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
                setPendingDelete(selected);
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

      {isMobile ? (
        <ul className="divide-y divide-border border-y border-border">
          {posts.map((post) => (
            <li className="flex items-center gap-3 py-2" key={post.id}>
              <Checkbox
                aria-label={`Select ${post.title}`}
                checked={selectedIds.has(post.id)}
                onCheckedChange={(checked) => {
                  toggle(post.id, checked === true);
                }}
              />
              {/* `min-w-0` is what lets the title truncate instead of pushing
                  the controls off the edge. Two lines and nothing else: the
                  slug and the date are both dropped, because a list a thumb
                  has to scroll through is worth more than every column of the
                  desktop table, and the state is the only one of the three
                  that changes what the row's controls will do. */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{post.title}</p>
                <p className="truncate text-xs text-muted-foreground">{post.publicationState}</p>
              </div>
              <RowActions
                isBusy={isBusy}
                onDelete={() => {
                  setPendingDelete([post]);
                }}
                post={post}
              />
            </li>
          ))}
        </ul>
      ) : (
        // `Table` already renders its own `overflow-x-auto` wrapper; a second
        // one around it nested two scroll containers with nothing between them.
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
              {/* Named for assistive technology only. The icons say what they
                  do, and a printed "Actions" heading over three buttons is a
                  label for something nobody was going to misread. */}
              <TableHead className="w-30">
                <span className="sr-only">Actions</span>
              </TableHead>
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
                  <StateBadge post={post} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatPublishedDate(post.publishedAt) || "—"}
                </TableCell>
                <TableCell>
                  <RowActions
                    isBusy={isBusy}
                    onDelete={() => {
                      setPendingDelete([post]);
                    }}
                    post={post}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setPendingDelete(null);
          }
        }}
        open={pendingDelete !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            {/* The count is in the heading rather than only in the body copy:
                it is the single fact that decides whether this is the intended
                action, and the database is now the only copy of the content. */}
            <AlertDialogTitle>
              Delete {targeted.length} {targeted.length === 1 ? "post" : "posts"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {targeted.length === 1
                ? `"${targeted[0]?.title ?? ""}" will be removed from the site and from the admin list.`
                : "They will be removed from the site and from the admin list."}{" "}
              This cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {/* Destructive, not the default primary. The confirm button of a
                delete dialog reading the same as a Save is how a reflex click
                loses a post. */}
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const deletedIds = targeted.map((post) => post.id);

                deletePosts.mutate(
                  { ids: deletedIds },
                  {
                    onSuccess: () => {
                      // Only what was actually deleted leaves the selection: a
                      // row deleted from its own control must not clear a
                      // selection the admin is still building.
                      setSelectedIds((current) => {
                        const next = new Set(current);

                        for (const id of deletedIds) {
                          next.delete(id);
                        }

                        return next;
                      });
                    },
                  },
                );
                setPendingDelete(null);
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
