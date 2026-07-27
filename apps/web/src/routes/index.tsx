import { createFileRoute } from "@tanstack/react-router";

import { featuredProjects, latestBlogEntries, homeContent } from "@/features/content/site-content";

export const Route = createFileRoute("/")({
  loader: () => ({
    blogEntries: latestBlogEntries,
    home: homeContent,
    projects: featuredProjects,
  }),
  head: () => ({
    meta: [
      { title: "Unimatrix-01 - Home" },
      {
        name: "description",
        content:
          "A collection of projects, experiments, and the occasional blog post from Gwenny, a developer working mostly in TypeScript and Node.js.",
      },
    ],
  }),
});
