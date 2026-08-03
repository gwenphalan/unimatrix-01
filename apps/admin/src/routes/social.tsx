import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/social")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Social" }],
  }),
});
