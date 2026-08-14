import { useMemo } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { createApiClient, type ApiClient } from "@unimatrix/api-client";
import { useAuth } from "@unimatrix/auth/react";

/**
 * The one supported way to obtain an `ApiClient` for component/route code.
 *
 * Unlike `apps/web`'s module-level, tokenless `apiClient`, this is a hook:
 * every surface in this app needs a signed-in `auth:admin` session, so Clerk is
 * always present. `baseUrl` comes from the router context rather than
 * `import.meta.env` — `main.tsx` is the one file allowed to read that, and a
 * module-scope read here would move `loadAdminAppRuntimeConfig`'s
 * throw-on-missing-key to import time, breaking every test that imports this
 * module.
 */
export function useApiClient(): ApiClient {
  const { runtimeConfig } = useRouteContext({ from: "__root__" });
  const { getToken } = useAuth();

  return useMemo(
    () =>
      createApiClient({
        baseUrl: runtimeConfig.apiBaseUrl,
        getAuthToken: () => getToken(),
      }),
    [getToken, runtimeConfig.apiBaseUrl],
  );
}
