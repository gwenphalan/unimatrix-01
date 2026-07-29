import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CircuitField, CircuitOccluderProvider } from "@unimatrix/ui/public";

import { AppFooter, AppPageContainer } from "@/features/cube-trainer-site/components";

type AppShellProps = {
  children: ReactNode;
};

// Nothing in this app registers a circuit occluder by hand any more:
// `CircuitOccluderProvider` discovers every painting surface itself. `main` is a
// centered, non-scrolling column spanning the whole viewport and would blanket
// the entire field if it occluded — it paints nothing, so the scan walks
// straight through it to the mode tiles, learn/drill panels, and case cards.
//
// The control rows (the view title bars, the set/preview toggles, the home
// wordmark) are therefore *soft* occluders, not hard ones: a shadcn control is
// 36px on its short side and `MIN_HARD_SIDE_PX` is one 40px grid cell, so they
// demote to ink. They used to be force-included through a padded
// `useCircuitOccluder` wrapper; that was removed deliberately rather than lost.
function AppShellContent({ children }: AppShellProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <AppPageContainer>
      <CircuitField routeKey={pathname} />

      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:border focus:border-primary/45 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        Skip to main content
      </a>

      <main className="flex flex-1 flex-col justify-center gap-8 lg:gap-10" id="main-content">
        {children}
      </main>

      <AppFooter />
    </AppPageContainer>
  );
}

export function AppShell({ children }: AppShellProps) {
  return (
    <CircuitOccluderProvider>
      <AppShellContent>{children}</AppShellContent>
    </CircuitOccluderProvider>
  );
}
