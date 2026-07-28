import { createFileRoute } from "@tanstack/react-router";

import { toBlogEntry } from "@/features/content/entries";
import { publishedPostsQueryOptions } from "@/features/content/queries/content-posts";

export const Route = createFileRoute("/blog")({
  loader: async ({ context }) => {
    const { posts } = await context.queryClient.ensureQueryData(publishedPostsQueryOptions("blog"));

    return posts.map(toBlogEntry);
  },
  head: () => ({
    meta: [
      { title: "Unimatrix-01 - Blog" },
      {
        name: "description",
        content:
          "Writing on software architecture, typed contracts, and the security questions that keep distributed systems honest.",
      },
    ],
  }),
});
