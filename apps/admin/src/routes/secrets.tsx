import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/secrets")({
  head: () => ({
    meta: [{ title: "Unimatrix Admin - Secrets" }],
  }),
});
