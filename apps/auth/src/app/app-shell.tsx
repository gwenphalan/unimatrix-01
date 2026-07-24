import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CircuitField } from "@unimatrix/ui/public";

type AppShellProps = {
  children: ReactNode;
};

/**
 * The auth app is a focused utility, not a mini-site: it has no header, no
 * nav, and no `UserButton` of its own (the `UserButton` lives on the
 * services). Every route is a single Clerk widget or a small card, so the
 * shell does nothing but center that content on a full-height dark page.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-10">
      <CircuitField routeKey={pathname} />
      {children}
    </div>
  );
}
