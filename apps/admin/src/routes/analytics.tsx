import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Analytics" }],
  }),
});
