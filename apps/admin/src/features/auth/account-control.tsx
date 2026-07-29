import { RiLoginBoxLine } from "@remixicon/react";

import { SignedIn, SignedOut, UserButton } from "@unimatrix/auth/react";

import { buildSignInHref } from "@/lib/config";

type AccountControlProps = {
  authAppUrl: string;
};

/**
 * The account affordance handed to `ToolShell` as its `accountControl` slot.
 *
 * It lives in the app rather than in `@unimatrix/chrome` for the reason the
 * slot exists at all: the shell package must never gain `@unimatrix/auth`, or
 * a sign-in-free tool like `apps/cube-trainer` could not import a shell from
 * it.
 *
 * Signed out it offers a way to the auth hub — it does **not** redirect. This
 * scaffold's one route is deliberately ungated; the section gate
 * (`canAccessAdminSection` from `@unimatrix/auth`) is later work, and building
 * a half-gate here would be the kind of security control that looks present
 * and is not.
 */
export function AccountControl({ authAppUrl }: AccountControlProps) {
  return (
    <>
      <SignedIn>
        {/* No `afterSignOutUrl` here — it is deprecated on the button, and
            `AuthProvider` in `main.tsx` already sets it. */}
        <UserButton />
      </SignedIn>
      <SignedOut>
        <a
          className="inline-flex items-center gap-2 border border-border bg-secondary/60 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/75 transition-colors hover:border-primary/35 hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/45 focus-visible:outline-none"
          href={buildSignInHref(authAppUrl, window.location.href)}
        >
          <RiLoginBoxLine aria-hidden="true" className="size-3.5" />
          <span>Sign in</span>
        </a>
      </SignedOut>
    </>
  );
}
