import { createFileRoute } from "@tanstack/react-router";
import { contentPostIdSchema } from "@unimatrix/shared";

export interface EditPostSearch {
  id: string;
}

/**
 * Addressed by id, not by slug: the slug is editable in the form this route
 * renders, so a slug-addressed URL would stop resolving the moment it saved.
 *
 * Validated with the shared id schema, so what counts as an id here is the same
 * thing the API's contracts accept. A missing or malformed id becomes `""`,
 * which the page reports as a post that no longer exists rather than throwing.
 */
function validateSearch(search: Record<string, unknown>): EditPostSearch {
  const id = contentPostIdSchema.safeParse(search.id);

  return { id: id.success ? id.data : "" };
}

export const Route = createFileRoute("/content/posts/edit")({
  validateSearch,
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Edit post" }],
  }),
});
