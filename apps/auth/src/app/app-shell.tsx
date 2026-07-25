import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { CircuitField, CircuitOccluderProvider } from "@unimatrix/ui/public";

type AppShellProps = {
  children: ReactNode;
};

/**
 * The auth app is a focused utility, not a mini-site: it has no header, no
 * nav, and no `UserButton` of its own (the `UserButton` lives on the
 * services). Every route is a single Clerk widget or a small card, so the
 * shell does nothing but center that content on a full-height dark page.
 *
 * Wrapped in `CircuitOccluderProvider` for consistency with the other two
 * shells, but registers zero occluders: the outer div here is near-full-
 * viewport-height even though the visible content is a small centered card,
 * and only 2 of 5 routes (`index`, the 404 boundary) have a local `Card` ref
 * available at all — `sign-in`/`sign-up`/`account` render Clerk's hosted
 * widgets directly with no local wrapper. Registering only the 2 available
 * routes would make trace density visibly differ navigating between routes
 * that look nearly identical, which reads as more broken than uniformly
 * having none. Trace count here still reacts to viewport size, just not to
 * DOM occlusion.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  return (
    <CircuitOccluderProvider>
      <div className="flex min-h-screen w-full flex-col items-center justify-center px-4 py-10">
        <CircuitField routeKey={pathname} />
        {children}
      </div>
    </CircuitOccluderProvider>
  );
}
