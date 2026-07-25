import type { ReactNode } from "react";
import { useRef } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CircuitField, CircuitOccluderProvider, useCircuitOccluder } from "@unimatrix/ui/public";

import { AppFooter, AppPageContainer } from "@/features/cube-trainer-site/components";

type AppShellProps = {
  children: ReactNode;
};

// `useCircuitOccluder` calls must live in a component rendered *inside*
// `CircuitOccluderProvider`, not the component that creates the provider —
// a component can't consume a context it renders as its own descendant.
function AppShellContent({ children }: AppShellProps) {
  const mainRef = useRef<HTMLElement | null>(null);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  useCircuitOccluder(mainRef);

  return (
    <AppPageContainer>
      <CircuitField routeKey={pathname} />

      <a
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:border focus:border-primary/45 focus:bg-background focus:px-3 focus:py-2 focus:text-sm"
        href="#main-content"
      >
        Skip to main content
      </a>

      <main className="flex flex-1 flex-col justify-center gap-8 lg:gap-10" id="main-content" ref={mainRef}>
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
