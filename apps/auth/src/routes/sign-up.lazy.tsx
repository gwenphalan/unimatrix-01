import { createLazyFileRoute, getRouteApi } from "@tanstack/react-router";
import { useRef } from "react";

import { SignUp } from "@unimatrix/auth/react";
import { useCircuitOccluder } from "@unimatrix/ui/public";

import { safeRedirectUrl, withRedirectParam } from "@/features/auth/safe-redirect";

const routeApi = getRouteApi("/sign-up");

export const Route = createLazyFileRoute("/sign-up")({
  component: SignUpRoute,
});

function SignUpRoute() {
  const { redirect_url } = routeApi.useSearch();
  // Validated against the same-family allowlist before use (see sign-in.lazy.tsx).
  const target = safeRedirectUrl(redirect_url);
  // Clerk's hosted widget doesn't forward a DOM ref (see sign-in.lazy.tsx).
  const ref = useRef<HTMLDivElement | null>(null);
  useCircuitOccluder(ref);

  return (
    /* See the comment in sign-in.lazy.tsx for why this uses routing="hash",
     * and why signInForceRedirectUrl mirrors forceRedirectUrl (the symmetric
     * OAuth-transfer case: signing up with a provider that already has an
     * account completes as a sign-in). */
    <div className="w-fit" ref={ref}>
      <SignUp
        forceRedirectUrl={target}
        routing="hash"
        signInForceRedirectUrl={target}
        signInUrl={withRedirectParam("/sign-in", redirect_url)}
      />
    </div>
  );
}
