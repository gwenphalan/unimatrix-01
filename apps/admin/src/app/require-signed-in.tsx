import type { ReactNode } from "react";
import { useAuth } from "@unimatrix/auth/react";

import { buildSignInHref } from "@/lib/config";

type RequireSignedInProps = {
  authAppUrl: string;
  children: ReactNode;
};

/**
 * Gates every route in `__root.tsx` behind a Clerk session. Not an access
 * control — the browser has already downloaded and booted the admin bundle
 * by the time this runs, and the origin's actual protection is Cloudflare
 * Access in front of it. This only sends a signed-out visitor on to the auth
 * hub instead of leaving the console mounted underneath them.
 *
 * `useAuth`'s `isLoaded` is read before `isSignedIn`, and deliberately: Clerk
 * resolves the session asynchronously, so on a cold load `isSignedIn` is
 * `false` for both "definitely signed out" and "haven't heard back yet". Ap
 * plying the redirect against the wrong reading of that combination would
 * bounce a signed-in operator to the login page on every fresh tab. `useAuth`
 * is `@unimatrix/auth/react`'s re-export of Clerk's own hook, whose
 * `isLoaded`/`isSignedIn` pair exists for exactly this distinction.
 *
 * `admin.` and `auth.` are different origins, so this is a `Location`
 * assignment rather than a router navigation — a `Link`/`navigate` call
 * cannot leave the SPA.
 */
export function RequireSignedIn({ authAppUrl, children }: RequireSignedInProps) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return null;
  }

  if (!isSignedIn) {
    window.location.assign(buildSignInHref(authAppUrl, window.location.href));
    return null;
  }

  return <>{children}</>;
}
