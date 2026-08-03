import { SignIn } from "@unimatrix/auth/react";

import { AlreadySignedInRedirect } from "@/features/auth/already-signed-in-redirect";
import {
  hasValidatedRedirectUrl,
  safeRedirectUrl,
  withRedirectParam,
} from "@/features/auth/safe-redirect";

export type SignInCardProps = {
  redirectUrl: string | undefined;
};

/**
 * The `/sign-in` route body. Split out from `sign-in.lazy.tsx` so it takes
 * `redirectUrl` as a prop instead of reading it from `routeApi.useSearch()`
 * itself — that's what lets it be unit-tested without a router.
 */
export function SignInCard({ redirectUrl }: SignInCardProps) {
  // Validated against the same-family allowlist before it can ever be used
  // as a post-auth redirect target; falls back to the auth landing ("/").
  const target = safeRedirectUrl(redirectUrl);

  // `w-fit` shrink-wraps Clerk's widget inside the shell's centering column;
  // removing this wrapper is a layout change, not a cleanup.
  return (
    <div className="w-fit">
      {hasValidatedRedirectUrl(redirectUrl, target) ? (
        <AlreadySignedInRedirect target={target} />
      ) : null}
      {/*
       * Clerk's <SignIn /> needs to route its own internal sub-steps
       * (email code entry, MFA, etc). Two options integrate with
       * TanStack Router: `routing="path"` + a splat child route
       * (`/sign-in/$`), or `routing="hash"`, which keeps every sub-step
       * on this same `/sign-in` route and manages state via the URL
       * hash instead. We use `routing="hash"` here — it avoids adding a
       * splat route just for Clerk's internal navigation, and this app
       * has no other routes nested under `/sign-in` that would need to
       * coexist with a path-based splat.
       *
       * `forceRedirectUrl={target}` sends the user back to the service
       * that linked here after a successful sign-in; `signUpUrl` carries
       * the same (unvalidated) redirect_url so switching to sign-up keeps
       * the destination.
       *
       * `signUpForceRedirectUrl={target}` covers the OAuth "transfer" case:
       * signing in with a provider whose identity has no existing account
       * creates one, which Clerk completes as a *sign-up* — without this it
       * would ignore forceRedirectUrl and fall back to the auth app landing.
       */}
      <SignIn
        forceRedirectUrl={target}
        routing="hash"
        signUpForceRedirectUrl={target}
        signUpUrl={withRedirectParam("/sign-up", redirectUrl)}
      />
    </div>
  );
}
