import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";

import { LabShell } from "@/app/lab-shell";
import { PrototypeHostPage } from "@/routes/prototype-host";
import { PrototypeIndexPage } from "@/routes/prototype-index";

/**
 * Hand-written, code-based routing — no `@tanstack/router-plugin`, no
 * `routeTree.gen.ts`.
 *
 * The three apps generate their route tree from files, which is right for them.
 * Here it would mean a generated file churning on every prototype added or
 * deleted, in the one directory that must stay empty on `main`. There are two
 * routes and there will only ever be two: the index, and a splat that hosts
 * whichever prototype the URL names.
 *
 * The router exists at all because `@unimatrix/chrome`'s `ToolShell` calls
 * `useRouterState` — a shell without a router above it reads a context nothing
 * ever wrote to.
 */
const rootRoute = createRootRoute({
  component: () => (
    <LabShell>
      <Outlet />
    </LabShell>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PrototypeIndexPage,
});

/**
 * `/p/$` rather than `/p/$prototypeId`: prototype ids carry the directory
 * structure of `lab/prototypes/`, so `admin/section-nav` is one id containing a
 * slash. A splat captures it whole into `_splat`.
 */
const prototypeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/p/$",
  component: PrototypeRouteComponent,
});

function PrototypeRouteComponent() {
  const { _splat } = prototypeRoute.useParams();

  return <PrototypeHostPage prototypeId={_splat ?? ""} />;
}

const routeTree = rootRoute.addChildren([indexRoute, prototypeRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
