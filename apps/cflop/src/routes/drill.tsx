import { createFileRoute } from "@tanstack/react-router";

import { routeHead } from "@/lib/route-head";

export const Route = createFileRoute("/drill")({
  head: () =>
    routeHead({
      path: "/drill",
      title: "CFLOP - Drill",
      description: "Drill 3x3 OLL and PLL algorithms with a keyboard-driven flashcard session.",
      indexable: false,
    }),
});
