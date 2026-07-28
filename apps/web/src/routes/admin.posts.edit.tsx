import { createFileRoute } from "@tanstack/react-router";

export interface EditPostSearch {
  id: string;
}

/**
 * Addressed by id, not by slug: the slug is editable in the form this route
 * renders, so a slug-addressed URL would stop resolving the moment it saved.
 * A missing or malformed id becomes `""`, which the page reports as a post
 * that no longer exists rather than throwing.
 */
function validateSearch(search: Record<string, unknown>): EditPostSearch {
  return { id: typeof search.id === "string" ? search.id : "" };
}

export const Route = createFileRoute("/admin/posts/edit")({
  validateSearch,
  head: () => ({
    meta: [{ title: "Unimatrix-01 - Edit post" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
