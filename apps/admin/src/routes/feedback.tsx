import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Feedback" }],
  }),
});
