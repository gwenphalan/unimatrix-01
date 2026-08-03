import { SignedIn, UserButton } from "@unimatrix/auth/react";

/**
 * The account affordance handed to `ToolShell` as its `accountControl` slot.
 *
 * It lives in the app rather than in `@unimatrix/chrome` for the reason the
 * slot exists at all: the shell package must never gain `@unimatrix/auth`, or
 * a sign-in-free tool like `apps/cflop` could not import a shell from it.
 *
 * There is no signed-out state to render here: `RequireSignedIn` in
 * `src/app/require-signed-in.tsx` gates every route above this component, so
 * by the time it mounts a session is guaranteed. `SignedIn` costs nothing to
 * keep and is the honest expression of "render this only when there is a
 * user" rather than an assumption baked into the JSX.
 */
export function AccountControl() {
  return (
    <SignedIn>
      {/* No `afterSignOutUrl` here — it is deprecated on the button, and
          `AuthProvider` in `main.tsx` already sets it. */}
      <UserButton />
    </SignedIn>
  );
}
