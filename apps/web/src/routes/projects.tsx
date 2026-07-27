import { createFileRoute } from "@tanstack/react-router";

import { projectEntries } from "@/features/content/site-content";

export const Route = createFileRoute("/projects")({
  loader: () => projectEntries,
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
