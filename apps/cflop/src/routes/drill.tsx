import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/drill")({
  head: () => ({
    meta: [
      { title: "CFLOP - Drill" },
      {
        name: "description",
        content: "Drill 3x3 OLL and PLL algorithms with a keyboard-driven flashcard session.",
      },
    ],
  }),
});
