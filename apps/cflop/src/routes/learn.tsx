import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/learn")({
  head: () => ({
    meta: [
      { title: "CFLOP - Learn" },
      {
        name: "description",
        content: "Learn 3x3 OLL and PLL algorithms in a guided teaching order, one case at a time.",
      },
    ],
  }),
});
