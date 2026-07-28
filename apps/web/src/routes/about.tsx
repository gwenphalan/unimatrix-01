import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "Unimatrix-01 - About" },
      {
        name: "description",
        content:
          "How Gwenny builds software: explicit boundaries, schemas that fail loudly, and systems more than one person can understand.",
      },
    ],
  }),
});
