import { createFileRoute } from "@tanstack/react-router";
import type { ContentPostType } from "@unimatrix/shared";
import { contentPostTypeSchema } from "@unimatrix/shared";

export interface NewPostSearch {
  type: ContentPostType;
}

/**
 * The shared schema decides what a type is, so this cannot drift from the
 * contract the form posts against. No direct `zod` dependency is involved —
 * the schema object arrives from `@unimatrix/shared` with its own.
 *
 * `safeParse` rather than `parse`: an unrecognised `type` falls back to "blog"
 * rather than rendering the router's error component over a form the admin was
 * trying to open.
 */
function validateSearch(search: Record<string, unknown>): NewPostSearch {
  const type = contentPostTypeSchema.safeParse(search.type);

  return { type: type.success ? type.data : "blog" };
}

export const Route = createFileRoute("/content/posts/new")({
  validateSearch,
  head: () => ({
    meta: [{ title: "Unimatrix Admin - New post" }],
  }),
});
