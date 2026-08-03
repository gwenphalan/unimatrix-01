import { createLazyFileRoute } from "@tanstack/react-router";

import { PostsPage } from "@/features/content/posts-page";

export const Route = createLazyFileRoute("/content/")({
  component: PostsPage,
});
