import { createLazyFileRoute } from "@tanstack/react-router";
import { useRef } from "react";

import { RedirectToSignIn, SignedIn, SignedOut, UserProfile } from "@unimatrix/auth/react";
import { useCircuitOccluder } from "@unimatrix/ui/public";

export const Route = createLazyFileRoute("/account")({
  component: AccountRoute,
});

function AccountRoute() {
  return (
    <>
      <SignedIn>
        <AccountProfile />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function AccountProfile() {
  // Clerk's hosted widget doesn't forward a DOM ref (see sign-in.lazy.tsx).
  // Registered here, inside `SignedIn`, so the ref is attached to the
  // mounted wrapper by the time this effect runs.
  const ref = useRef<HTMLDivElement | null>(null);
  useCircuitOccluder(ref);

  return (
    <div className="w-fit" ref={ref}>
      {/* See the comment in sign-in.lazy.tsx for why this uses routing="hash". */}
      <UserProfile routing="hash" />
    </div>
  );
}
