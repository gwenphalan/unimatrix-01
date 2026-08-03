import { SignUp } from "@unimatrix/auth/react";

import { AlreadySignedInRedirect } from "@/features/auth/already-signed-in-redirect";
import {
  hasValidatedRedirectUrl,
  safeRedirectUrl,
  withRedirectParam,
} from "@/features/auth/safe-redirect";

export type SignUpCardProps = {
  redirectUrl: string | undefined;
};

/**
 * The `/sign-up` route body. Split out from `sign-up.lazy.tsx` so it takes
 * `redirectUrl` as a prop instead of reading it from `routeApi.useSearch()`
 * itself — that's what lets it be unit-tested without a router. Mirrors
 * `SignInCard`; see that file for the `routing="hash"` and
 * `AlreadySignedInRedirect` rationale.
 */
export function SignUpCard({ redirectUrl }: SignUpCardProps) {
  // Validated against the same-family allowlist before use (see sign-in-card.tsx).
  const target = safeRedirectUrl(redirectUrl);

  return (
    <div className="w-fit">
      {hasValidatedRedirectUrl(redirectUrl, target) ? (
        <AlreadySignedInRedirect target={target} />
      ) : null}
      {/* See the comment in sign-in-card.tsx for why this uses routing="hash",
       * and why signInForceRedirectUrl mirrors forceRedirectUrl (the symmetric
       * OAuth-transfer case: signing up with a provider that already has an
       * account completes as a sign-in). */}
      <SignUp
        forceRedirectUrl={target}
        routing="hash"
        signInForceRedirectUrl={target}
        signInUrl={withRedirectParam("/sign-in", redirectUrl)}
      />
    </div>
  );
}
