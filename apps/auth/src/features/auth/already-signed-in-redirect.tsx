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
 * `target` is always a same-family origin other than this app itself in
 * practice (the service that sent the visitor here), so this is a
 * `Location` assignment, not a router navigation — a `Link`/`navigate` call
 * cannot leave the SPA.
 */
export function AlreadySignedInRedirect({ target }: AlreadySignedInRedirectProps) {
  const { isLoaded, isSignedIn } = useAuth();

  if (isLoaded && isSignedIn) {
    window.location.assign(target);
  }

  return null;
}
