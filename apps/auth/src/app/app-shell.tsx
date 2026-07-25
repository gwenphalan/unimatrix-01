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
 * shells. All 5 routes register an occluder for their content: `index` and
 * the 404 boundary register their local `Card` ref directly, while
 * `sign-in`/`sign-up`/`account` render Clerk's hosted widgets (which don't
 * forward a DOM ref) inside a minimal wrapper `div` that shrink-wraps the
 * widget and carries the ref instead. Route components render below this
 * provider, so they need no `AppShellContent` split.
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
