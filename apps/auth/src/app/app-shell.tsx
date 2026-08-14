import type { ReactNode } from "react";
import { ToolShell } from "@unimatrix/chrome/tool";

type AppShellProps = {
  children: ReactNode;
};

/**
 * The auth app is a focused utility, not a mini-site: no nav tabs, no site
 * footer, and no `UserButton` of its own (the `UserButton` lives on the
 * services). Every route is a single Clerk widget or a small card.
 *
 * It takes the shared tool shell rather than growing its own, which is what
 * `@unimatrix/chrome` exists for. `ToolShell` centres its `main`
 * vertically, so this app adds only horizontal centring.
 *
 * `homeHref` without `homeLabel` is deliberate: the shell renders no title bar
 * unless one of `homeLabel` or `accountControl` is given, so this app gets its
 * way back to the public site through the footer's copyright link and nothing
 * sits above the content. A wordmark over a single sign-in card is noise — the
 * card already says "Unimatrix Accounts".
 *
 * No `accountControl` either. Signing in and out is what this app *is*, so an
 * account control in its own chrome would be circular.
 *
 * The grid background comes from the shell, via `GraphBackground`. Nothing in
 * this app registers anything with it: it measures the viewport, not the page's
 * contents.
 */
export function AppShell({ children }: AppShellProps) {
  return (
    <ToolShell homeHref="https://unimatrix-01.dev/">
      {/* Horizontal centring is this app's business, not the shell's. The tool
          shell's `main` centres vertically only, because a tool's content is
          normally full-width — cflop's grids would be pinched by an
          `items-center` there. Every route here is one narrow card, so the
          centring wraps the children instead. */}
      <div className="flex w-full flex-col items-center">{children}</div>
    </ToolShell>
  );
}
