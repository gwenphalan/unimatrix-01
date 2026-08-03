import { createLazyFileRoute } from "@tanstack/react-router";

import { PostFormPage } from "@/features/content/post-form-page";

export const Route = createLazyFileRoute("/content/posts/edit")({
  component: EditPostRoute,
});

function EditPostRoute() {
  const { id } = Route.useSearch();
  const { runtimeConfig } = Route.useRouteContext();

  // `type` is only used when creating; the edited post carries its own.
  return <PostFormPage baseUrl={runtimeConfig.apiBaseUrl} postId={id} type="blog" />;
}
