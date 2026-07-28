import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cube Trainer - Home" },
      {
        name: "description",
        content: "A flashcard trainer for memorizing every 3x3 Rubik's Cube OLL and PLL algorithm.",
      },
    ],
  }),
});
