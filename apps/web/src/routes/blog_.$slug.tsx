import { createFileRoute, notFound } from "@tanstack/react-router";

import { toBlogDetail } from "@/features/content/entries";
import {
  isMissingContentError,
  publishedPostQueryOptions,
} from "@/features/content/queries/content-posts";

export const Route = createFileRoute("/blog_/$slug")({
  loader: async ({ context, params }) => {
    try {
      const post = await context.queryClient.ensureQueryData(
        publishedPostQueryOptions("blog", params.slug),
      );

      return toBlogDetail(post);
    } catch (error) {
      if (isMissingContentError(error)) {
        throw createBlogNotFoundError(params.slug);
      }

      throw error;
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Unimatrix-01 - ${loaderData?.frontmatter.title ?? "Article"}` },
      {
        name: "description",
        content: loaderData?.frontmatter.summary ?? "A blog entry on Unimatrix-01.",
      },
    ],
  }),
});

function createBlogNotFoundError(slug: string): Error {
  return Object.assign(new Error(`Blog entry not found: ${slug}`), notFound());
}
