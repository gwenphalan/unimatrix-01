import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/content")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Content" }],
  }),
});
