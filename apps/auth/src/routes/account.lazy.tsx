import { createLazyFileRoute } from "@tanstack/react-router";

import { RedirectToSignIn, SignedIn, SignedOut, UserProfile } from "@unimatrix/auth/react";

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
  return (
    <div className="w-fit">
      {/* See the comment in sign-in.lazy.tsx for why this uses routing="hash". */}
      <UserProfile routing="hash" />
    </div>
  );
}
