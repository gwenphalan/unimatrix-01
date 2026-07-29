import {
  apiBaseUrl,
  envSchema,
  loadDevProxyConfig,
  parseAppEnv,
  requiredEnvString,
  type DevProxyConfig,
  type DevProxyEnv,
} from "@unimatrix/app-config";

export interface AuthAppRuntimeConfig {
  apiBaseUrl: string;
  clerkPublishableKey: string;
}

export interface AuthAppRuntimeEnv {
  VITE_API_BASE_URL?: string | undefined;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
}

export type AuthAppDevProxyConfig = DevProxyConfig;
export type AuthAppDevProxyEnv = DevProxyEnv;

const runtimeEnvSchema = envSchema({
  VITE_API_BASE_URL: apiBaseUrl(),
  VITE_CLERK_PUBLISHABLE_KEY: requiredEnvString("VITE_CLERK_PUBLISHABLE_KEY"),
});

/**
 * Loads and validates browser runtime config for the auth app. Requires
 * `VITE_CLERK_PUBLISHABLE_KEY` — there is no sensible default for a Clerk
 * publishable key, so a missing/empty value throws immediately rather than
 * silently rendering an app with no authentication provider configured.
 */
export function loadAuthAppRuntimeConfig(env: AuthAppRuntimeEnv): AuthAppRuntimeConfig {
  const parsed = parseAppEnv("auth app", runtimeEnvSchema, env);

  return {
    apiBaseUrl: parsed.VITE_API_BASE_URL,
    clerkPublishableKey: parsed.VITE_CLERK_PUBLISHABLE_KEY,
  };
}

export function loadAuthAppDevProxyConfig(env: AuthAppDevProxyEnv): AuthAppDevProxyConfig {
  return loadDevProxyConfig("auth app", env);
}
