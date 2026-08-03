import {
  DEFAULT_AUTH_APP_URL,
  apiBaseUrl,
  envSchema,
  loadDevProxyConfig,
  optionalHttpUrl,
  parseAppEnv,
  requiredEnvString,
  type DevProxyConfig,
  type DevProxyEnv,
} from "@unimatrix/app-config";

export interface AdminAppRuntimeConfig {
  apiBaseUrl: string;
  authAppUrl: string;
  clerkPublishableKey: string;
  /**
   * Whether a signed-out visitor is sent to the auth hub. Not env-derived and
   * not validated here — it is a property of the build, supplied by
   * `main.tsx`, which is the one file allowed to read `import.meta.env`.
   *
   * It is off in dev because the hub only ever establishes a session for
   * `*.unimatrix-01.dev`, never for a loopback port, so a dev server can only
   * ever bounce straight back out again and the console is unreachable
   * locally. Production builds always set it.
   */
  requireSignIn: boolean;
}

export interface AdminAppRuntimeEnv {
  VITE_API_BASE_URL?: string | undefined;
  VITE_AUTH_APP_URL?: string | undefined;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
}

export type AdminAppDevProxyConfig = DevProxyConfig;
export type AdminAppDevProxyEnv = DevProxyEnv;

const runtimeEnvSchema = envSchema({
  VITE_API_BASE_URL: apiBaseUrl(),
  VITE_AUTH_APP_URL: optionalHttpUrl("VITE_AUTH_APP_URL", DEFAULT_AUTH_APP_URL),
  VITE_CLERK_PUBLISHABLE_KEY: requiredEnvString("VITE_CLERK_PUBLISHABLE_KEY"),
});

/**
 * Loads and validates browser runtime config for the admin app.
 *
 * `VITE_CLERK_PUBLISHABLE_KEY` is required and has no default: unlike
 * `apps/web`, where Clerk is optional and the site renders fine without it,
 * every eventual surface here is account-scoped. A build with no key would
 * come up looking healthy and be unable to sign anybody in, so it fails at
 * boot instead.
 *
 * `apiBaseUrl` is validated even though nothing in the scaffold reads it yet.
 * Vite inlines `import.meta.env.VITE_*` at *build* time, so a bad value cannot
 * be corrected by restarting the container — the earlier it is rejected, the
 * cheaper it is, and the CMS move is what starts consuming it.
 */
export function loadAdminAppRuntimeConfig(
  env: AdminAppRuntimeEnv,
): Omit<AdminAppRuntimeConfig, "requireSignIn"> {
  const parsed = parseAppEnv("admin app", runtimeEnvSchema, env);

  return {
    apiBaseUrl: parsed.VITE_API_BASE_URL,
    authAppUrl: parsed.VITE_AUTH_APP_URL,
    clerkPublishableKey: parsed.VITE_CLERK_PUBLISHABLE_KEY,
  };
}

export function loadAdminAppDevProxyConfig(env: AdminAppDevProxyEnv): AdminAppDevProxyConfig {
  return loadDevProxyConfig("admin app", env);
}

/**
 * The public site, as an absolute URL. Every link from this origin to the site
 * is cross-origin, so each one is a plain anchor rather than a router `Link` —
 * a `Link to="/"` here resolves to the admin root, which is the bug this
 * constant exists to make hard to reintroduce.
 */
export const PUBLIC_SITE_URL = "https://unimatrix-01.dev/";

/**
 * Builds the auth hub's sign-in URL with a validated return address.
 *
 * `admin.` is a different origin from `auth.`, so this is a full-page
 * navigation rather than a router link — and the return address is read from
 * the live `Location` rather than reconstructed, so a deep link survives the
 * round trip.
 */
export function buildSignInHref(authAppUrl: string, currentHref: string): string {
  return `${authAppUrl}/sign-in?redirect_url=${encodeURIComponent(currentHref)}`;
}
