import {
  DEFAULT_AUTH_APP_URL,
  apiBaseUrl,
  envSchema,
  loadDevProxyConfig,
  optionalEnvStringWithoutFallback,
  optionalHttpUrl,
  parseAppEnv,
  type DevProxyConfig,
  type DevProxyEnv,
} from "@unimatrix/app-config";

export interface WebRuntimeConfig {
  apiBaseUrl: string;
  authAppUrl: string;
  clerkPublishableKey?: string;
}

export interface WebRuntimeEnv {
  VITE_API_BASE_URL?: string | undefined;
  VITE_AUTH_APP_URL?: string | undefined;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
}

export type WebDevProxyConfig = DevProxyConfig;
export type WebDevProxyEnv = DevProxyEnv;

const runtimeEnvSchema = envSchema({
  VITE_API_BASE_URL: apiBaseUrl(),
  VITE_AUTH_APP_URL: optionalHttpUrl("VITE_AUTH_APP_URL", DEFAULT_AUTH_APP_URL),
  // Clerk is entirely optional for `apps/web` (a public portfolio site): when
  // unset, the app renders exactly as it does with no auth provider
  // configured at all. When set, it must be non-empty once trimmed.
  VITE_CLERK_PUBLISHABLE_KEY: optionalEnvStringWithoutFallback("VITE_CLERK_PUBLISHABLE_KEY"),
});

export function loadWebRuntimeConfig(env: WebRuntimeEnv): WebRuntimeConfig {
  const parsed = parseAppEnv("web", runtimeEnvSchema, env);

  return {
    apiBaseUrl: parsed.VITE_API_BASE_URL,
    authAppUrl: parsed.VITE_AUTH_APP_URL,
    ...(parsed.VITE_CLERK_PUBLISHABLE_KEY !== undefined
      ? { clerkPublishableKey: parsed.VITE_CLERK_PUBLISHABLE_KEY }
      : {}),
  };
}

export function loadWebDevProxyConfig(env: WebDevProxyEnv): WebDevProxyConfig {
  return loadDevProxyConfig("web", env);
}

/**
 * Whether Clerk-backed auth is enabled for this build. Narrows
 * `clerkPublishableKey` to `string` so callers can branch on this once
 * instead of re-checking `!== undefined` at every call site.
 */
export function isAuthEnabled(
  config: WebRuntimeConfig,
): config is WebRuntimeConfig & { clerkPublishableKey: string } {
  return config.clerkPublishableKey !== undefined;
}
