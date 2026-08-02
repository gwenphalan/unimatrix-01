import type { ReactNode } from "react";
import { ToolFooterLink, ToolShell } from "@unimatrix/chrome/tool";

type AppShellProps = {
  children: ReactNode;
};

// The chrome itself lives in `@unimatrix/chrome/tool` — this app supplies only
// what is specific to it: the source link and `homeHref`. The algorithm data's
// licence notices live in `vendor/NOTICE.md`, not on screen.
// No `accountControl` is passed, because CFLOP is a public, sign-in-free
// tool; the shell renders no title bar at all in that case, which is why this
// migration changes nothing on screen.
//
// The grid background comes from `ToolShell`, via `GraphBackground`. Nothing
// here has to register with it: it measures the viewport, not the page's
// contents.
export function AppShell({ children }: AppShellProps) {
  return (
    <ToolShell
      footerEnd={
        <>
          <ToolFooterLink href="https://github.com/unimatrixcore/unimatrix-01/tree/main/apps/cflop">
            GitHub source
          </ToolFooterLink>
        </>
      }
      homeHref="https://unimatrix-01.dev/"
    >
      {children}
    </ToolShell>
  );
}
