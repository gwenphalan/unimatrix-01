import {
  HeadContent,
  Link,
  Outlet,
  createRootRouteWithContext,
  useRouterState,
} from "@tanstack/react-router";
import { RiAlertLine } from "@remixicon/react";

import { AppShell } from "@/app/app-shell";
import type { AppRouterContext } from "@/app/router";
import { useAdminAccess } from "@/features/admin/admin-slot";
import { Badge, Button, Card } from "@unimatrix/ui/public";

export const Route = createRootRouteWithContext<AppRouterContext>()({
  component: RootComponent,
  head: () => ({
    meta: [
      { title: "Unimatrix-01" },
      {
        name: "description",
        content:
          "A collection of projects, experiments, and the occasional blog post from Gwenny, a developer working mostly in TypeScript and Node.js.",
      },
    ],
  }),
  notFoundComponent: RootNotFound,
});

/**
 * Picks the shell.
 *
 * The public site's header, nav and footer are wayfinding for a reader; the
 * admin subtree is a tool, so it brings its own application chrome
 * (`AdminShell`) and must not be wrapped in the site's. Matched on the `/admin`
 * route id rather than on the pathname so every child route — the editor pages
 * included — is covered without a second case to remember.
 *
 * Only an admin gets the dashboard chrome. A visitor without the permission
 * sees the ordinary site around the route's "not for you" notice, which is both
 * a better place to land and one less shell to build. Rendering nothing until
 * Clerk resolves avoids mounting the public shell and swapping it out a beat
 * later, which would remount the whole subtree.
 */
function RootComponent() {
  const isAdminRoute = useRouterState({
    select: (state) => state.matches.some((match) => match.routeId === "/admin"),
  });
  const { isLoaded, isAdmin } = useAdminAccess();

  if (isAdminRoute) {
    if (!isLoaded) {
      return null;
    }

    if (isAdmin) {
      return (
        <>
          <HeadContent />
          <Outlet />
        </>
      );
    }
  }

  return (
    <AppShell>
      <HeadContent />
      <Outlet />
    </AppShell>
  );
}

function RootNotFound() {
  return (
    <Card className="site-panel site-panel-strong max-w-3xl px-6 py-6 lg:px-8 lg:py-8">
      <div className="space-y-5">
        <Badge variant="destructive" className="gap-1.5">
          <RiAlertLine aria-hidden="true" className="size-3.5" />
          Page unavailable
        </Badge>
        <div className="space-y-3">
          <h2 className="text-3xl leading-tight font-medium tracking-[-0.05em] text-foreground">
            That page is not part of the current site.
          </h2>
          <p className="max-w-2xl text-sm leading-7 text-muted-foreground lg:text-base lg:leading-8">
            Return home or jump straight to projects, the blog, or the about page.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild className="w-fit">
            <Link to="/">Go home</Link>
          </Button>
          <Button asChild variant="outline" className="w-fit">
            <Link to="/projects">Open projects</Link>
          </Button>
          <Button asChild variant="secondary" className="w-fit">
            <Link to="/about">Open about</Link>
          </Button>
        </div>
      </div>
    </Card>
  );
}
