import { createFileRoute, notFound } from "@tanstack/react-router";

import { toProjectDetail } from "@/features/content/entries";
import {
  isMissingContentError,
  publishedPostQueryOptions,
} from "@/features/content/queries/content-posts";

export const Route = createFileRoute("/projects_/$slug")({
  loader: async ({ context, params }) => {
    try {
      const post = await context.queryClient.ensureQueryData(
        publishedPostQueryOptions("project", params.slug),
      );

      return toProjectDetail(post);
    } catch (error) {
      if (isMissingContentError(error)) {
        throw createProjectNotFoundError(params.slug);
      }

      throw error;
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `Unimatrix-01 - ${loaderData?.frontmatter.title ?? "Project"}` },
      {
        name: "description",
        content: loaderData?.frontmatter.summary ?? "A project on Unimatrix-01.",
      },
    ],
  }),
});

function createProjectNotFoundError(slug: string): Error {
  return Object.assign(new Error(`Project not found: ${slug}`), notFound());
}
