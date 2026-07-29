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
// Nothing here registers a circuit occluder by hand: `CircuitOccluderProvider`
// (mounted inside `ToolShell`) discovers every painting surface itself. `main`
// is a centered, non-scrolling column spanning the whole viewport and would
// blanket the entire field if it occluded — it paints nothing, so the scan
// walks straight through it to the mode tiles, learn/drill panels, and case
// cards.
//
// The control rows (the view title bars, the set/preview toggles) are therefore
// *soft* occluders, not hard ones: a shadcn control is 36px on its short side
// and `MIN_HARD_SIDE_PX` is one 40px grid cell, so they demote to ink. They used
// to be force-included through a padded `useCircuitOccluder` wrapper; that was
// removed deliberately rather than lost.
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
