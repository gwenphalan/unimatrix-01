import { createRouter, type RouterHistory } from "@tanstack/react-router";

import type { AdminAppRuntimeConfig } from "@/lib/config";
import { routeTree } from "@/routes/routeTree.gen";

export type AppRouterContext = {
  runtimeConfig: AdminAppRuntimeConfig;
};

export interface CreateAppRouterOptions {
  history?: RouterHistory;
  runtimeConfig: AdminAppRuntimeConfig;
}

/**
 * Builds the app's router.
 *
 * Deliberately **not** a module-level singleton the way `apps/auth` has one:
 * the runtime config is required and throws on a missing Clerk key, so a
 * singleton would move that throw to module-evaluation time and take down
 * anything that merely imports the router — including tests. `main.tsx` is the
 * one place that reads `import.meta.env`, and the config travels from there
 * through the router context.
 *
 * There is no `queryClient` in the context yet. Nothing in the scaffold fetches,
 * so `@tanstack/react-query` would be a dependency with no consumer; the CMS
 * move is what brings it in.
 */
export function createAppRouter(options: CreateAppRouterOptions) {
  return createRouter({
    ...(options.history ? { history: options.history } : {}),
    context: {
      runtimeConfig: options.runtimeConfig,
    } satisfies AppRouterContext,
    routeTree,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
