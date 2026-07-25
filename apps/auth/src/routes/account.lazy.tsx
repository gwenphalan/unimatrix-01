import { createLazyFileRoute } from "@tanstack/react-router";
import { useRef } from "react";

import { RedirectToSignIn, SignedIn, SignedOut, UserProfile } from "@unimatrix/auth/react";
import { useCircuitOccluder } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/account")({
  component: AccountRoute,
});

function AccountRoute() {
  // Clerk's hosted widget doesn't forward a DOM ref (see sign-in.lazy.tsx).
  const ref = useRef<HTMLDivElement | null>(null);
  useCircuitOccluder(ref);

  return (
    <>
      <SignedIn>
        <div ref={ref}>
          {/* See the comment in sign-in.lazy.tsx for why this uses routing="hash". */}
          <UserProfile routing="hash" />
        </div>
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}
