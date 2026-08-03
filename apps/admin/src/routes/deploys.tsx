import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/deploys")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Deploys" }],
  }),
});
