import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";

import { SignUpCard } from "@/features/auth/sign-up-card";

const routeApi = getRouteApi("/sign-up");

export const Route = createLazyFileRoute("/sign-up")({
  component: SignUpRoute,
});

function SignUpRoute() {
  const { redirect_url } = routeApi.useSearch();

  return <SignUpCard redirectUrl={redirect_url} />;
}
