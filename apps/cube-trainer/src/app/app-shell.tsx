import type { ReactNode } from "react";
import { ToolFooterLink, ToolShell } from "@unimatrix/chrome/tool";

type AppShellProps = {
  children: ReactNode;
};

// The chrome itself lives in `@unimatrix/chrome/tool` — this app supplies only
// what is specific to it: the source link and the algorithm-data attribution.
// No `accountControl` is passed, because Cube Trainer is a public, sign-in-free
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
          <ToolFooterLink href="https://github.com/unimatrixcore/unimatrix-01/tree/main/apps/cube-trainer">
            GitHub source
          </ToolFooterLink>{" "}
          · Algorithm data from{" "}
          <ToolFooterLink href="https://jperm.net/algs">jperm.net/algs</ToolFooterLink>
        </>
      }
      homeHref="https://unimatrix-01.dev/"
    >
      {children}
    </ToolShell>
  );
}
