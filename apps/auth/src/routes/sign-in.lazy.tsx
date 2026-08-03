import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";

import { SignInCard } from "@/features/auth/sign-in-card";

const routeApi = getRouteApi("/sign-in");

export const Route = createLazyFileRoute("/sign-in")({
  component: SignInRoute,
});

function SignInRoute() {
  const { redirect_url } = routeApi.useSearch();

  return <SignInCard redirectUrl={redirect_url} />;
}
