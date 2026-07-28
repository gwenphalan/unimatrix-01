import { createFileRoute } from "@tanstack/react-router";
import type { ContentPostType } from "@unimatrix/shared";

export interface NewPostSearch {
  type: ContentPostType;
}

/**
 * Hand-rolled rather than a Zod adapter: `apps/web` has no direct `zod`
 * dependency, and this is one enum with a default. It never throws — an
 * unrecognised `type` falls back to "blog" rather than rendering the router's
 * error component over a form the admin was trying to open.
 */
function validateSearch(search: Record<string, unknown>): NewPostSearch {
  return { type: search.type === "project" ? "project" : "blog" };
}

export const Route = createFileRoute("/admin/posts/new")({
  validateSearch,
  head: () => ({
    meta: [{ title: "Unimatrix-01 - New post" }, { name: "robots", content: "noindex, nofollow" }],
  }),
});
