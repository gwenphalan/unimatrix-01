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
export type AccountControlProps = {
  /** The rail's collapsed state, from `ToolShell`'s `accountControl` render prop. */
  collapsed: boolean;
};

export function AccountControl({ collapsed }: AccountControlProps) {
  return (
    <SignedIn>
      {/* No `afterSignOutUrl` here — it is deprecated on the button, and
          `AuthProvider` in `main.tsx` already sets it.
          `appearance` is the only way to size Clerk's internals: the avatar
          defaults to 28px, and the rail aligns a 24px control on the same
          centre column as the section icons, so `size-6` here is what makes
          that alignment land rather than a style preference.
          `flex-row-reverse` is needed because Clerk renders the identifier
          *before* the trigger in the DOM; without it the name sits left of
          the avatar and nothing lines up with the icon column.

          The trailing `!` on the three layout utilities is load-bearing.
          Clerk ships its own emotion class on the same element and it wins
          on order, so `size-6` and `flex-row-reverse` are applied as class
          names and then computed as 28px and `row` — the markup looks right
          while the layout is unchanged. Measured, not assumed. */}
      <UserButton
        appearance={{
          elements: {
            avatarBox: "size-6!",
            userButtonBox: "flex-row-reverse! gap-1.5!",
            userButtonOuterIdentifier: "text-sm text-muted-foreground truncate",
          },
        }}
        showName={!collapsed}
      />
    </SignedIn>
  );
}
