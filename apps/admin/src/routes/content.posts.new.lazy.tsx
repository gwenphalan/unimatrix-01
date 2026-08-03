import { createLazyFileRoute } from "@tanstack/react-router";

import { PostFormPage } from "@/features/content/post-form-page";

export const Route = createLazyFileRoute("/content/posts/new")({
  component: NewPostRoute,
});

function NewPostRoute() {
  const { type } = Route.useSearch();
  const { runtimeConfig } = Route.useRouteContext();

  return <PostFormPage baseUrl={runtimeConfig.apiBaseUrl} postId={null} type={type} />;
}
