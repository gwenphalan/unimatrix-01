import { createFileRoute } from "@tanstack/react-router";

import { toProjectEntry } from "@/features/content/entries";
import { publishedPostsQueryOptions } from "@/features/content/queries/content-posts";

export const Route = createFileRoute("/projects")({
  loader: async ({ context }) => {
    const { posts } = await context.queryClient.ensureQueryData(
      publishedPostsQueryOptions("project"),
    );

    return posts.map(toProjectEntry);
  },
  head: () => ({
    meta: [
      { title: "Unimatrix-01 - Projects" },
      {
        name: "description",
        content:
          "Projects and experiments by Gwenny, from web apps and typed API contracts to Rubik's Cube training tools.",
      },
    ],
  }),
});
