import { createFileRoute } from "@tanstack/react-router";

import { routeHead } from "@/lib/route-head";

export const Route = createFileRoute("/learn")({
  head: () =>
    routeHead({
      path: "/learn",
      title: "CFLOP - Learn",
      description:
        "Learn 3x3 OLL and PLL algorithms in a guided teaching order, one case at a time.",
      indexable: false,
    }),
});
