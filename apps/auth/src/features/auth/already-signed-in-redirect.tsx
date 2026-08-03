import { useEffect, useRef } from "react";
import { useAuth } from "@unimatrix/auth/react";

export type AlreadySignedInRedirectProps = {
  /** An already-validated destination (see `hasValidatedRedirectUrl` at the call site) — never the raw `redirect_url` param. */
  target: string;
};

/**
 * Sends a visitor who already has a Clerk session on to `target`, for the
 * case Clerk's own widgets don't cover: `forceRedirectUrl` on `<SignIn>` /
 * `<SignUp>` only fires once a sign-in/up flow *completes*, and a visitor who
 * already has a session never runs that flow — Clerk renders its own
 * already-signed-in state instead, and `target` is never consulted. This
 * component is what actually gets them there.
 *
 * Callers render this only once `hasValidatedRedirectUrl` confirms `target`
 * is a genuine validated `redirect_url` and not the auth app's own fallback
 * landing, so an already-signed-in visitor with no return address keeps
 * seeing today's behavior (Clerk's signed-in view) unchanged.
 *
 * `isLoaded` gates `isSignedIn` for the same reason as `RequireSignedIn` in
 * `apps/admin`: Clerk resolves the session asynchronously, and `isSignedIn`
 * reads `false` during that window too — indistinguishable from a genuine
 * signed-out visitor without it.
 *
 * **Only the arrival state counts, which is what `arrivedSignedIn` records.**
 * This component stays mounted for the whole sign-in flow, so a visitor who
 * arrives signed *out* and then signs in flips `isSignedIn` to `true` under
 * it — and redirecting on that flip means racing Clerk's own
 * `forceRedirectUrl` navigation with a second one to the same place, fired
 * the instant `setActive` resolves rather than once Clerk has finished. A
 * completed sign-in is Clerk's to land, not this component's; it only covers
 * the case Clerk's widgets skip. The first render where `isLoaded` is true
 * decides, and nothing afterward changes the answer.
 *
 * The navigation is in an effect rather than in the render body for the
 * ordinary reason: `window.location.assign` is a side effect, and under
 * StrictMode a render-phase one fires twice.
 *
 * `target` is always a same-family origin other than this app itself in
 * practice (the service that sent the visitor here), so this is a
 * `Location` assignment, not a router navigation — a `Link`/`navigate` call
 * cannot leave the SPA.
 */
export function AlreadySignedInRedirect({ target }: AlreadySignedInRedirectProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const arrivedSignedIn = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    arrivedSignedIn.current ??= isSignedIn;

    if (arrivedSignedIn.current) {
      window.location.assign(target);
    }
  }, [isLoaded, isSignedIn, target]);

  return null;
}
