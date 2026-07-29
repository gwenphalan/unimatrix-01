import { createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot } from "@/features/admin/admin-slot";

export const Route = createLazyFileRoute("/admin/posts/new")({
  component: NewPostRoute,
});

function NewPostRoute() {
  const { type } = Route.useSearch();

  return <AdminSlot kind="post-form" postId={null} type={type} />;
}
