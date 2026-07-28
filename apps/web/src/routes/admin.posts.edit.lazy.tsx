import { createLazyFileRoute } from "@tanstack/react-router";

import { AdminSlot } from "@/features/admin/admin-slot";

export const Route = createLazyFileRoute("/admin/posts/edit")({
  component: EditPostRoute,
});

function EditPostRoute() {
  const { id } = Route.useSearch();

  // `type` is only used when creating; the edited post carries its own.
  return <AdminSlot kind="post-form" postId={id} type="blog" />;
}
