import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Every path an admin control links to.
 *
 * A TanStack `<Link>` resolves its `href` against the router's tree and throws
 * when the target is missing, so this list has to keep up with the admin
 * routes — a missing entry fails as a render error rather than a bad link.
 */
const ADMIN_PATHS = ["/", "/admin", "/admin/posts/new", "/admin/posts/edit"] as const;

/**
 * Mounts a node under a router and a query client of its own.
 *
 * The router is deliberately not the app's registered tree: the app router
 * would route past the component under test rather than render it. The routes
 * exist only so links have somewhere to point.
 */
export function renderInRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: () => children });
  const routeTree = rootRoute.addChildren(
    ADMIN_PATHS.map((path) =>
      createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
    ),
  );
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}
