import {
  apiBaseUrl,
  envSchema,
  loadDevProxyConfig,
  parseAppEnv,
  type DevProxyConfig,
  type DevProxyEnv,
} from "@unimatrix/app-config";

export interface WebRuntimeConfig {
  apiBaseUrl: string;
}

export interface WebRuntimeEnv {
  VITE_API_BASE_URL?: string | undefined;
}

export type WebDevProxyConfig = DevProxyConfig;
export type WebDevProxyEnv = DevProxyEnv;

const runtimeEnvSchema = envSchema({
  VITE_API_BASE_URL: apiBaseUrl(),
});

export function loadWebRuntimeConfig(env: WebRuntimeEnv): WebRuntimeConfig {
  const parsed = parseAppEnv("web", runtimeEnvSchema, env);

  return {
    apiBaseUrl: parsed.VITE_API_BASE_URL,
  };
}

export function loadWebDevProxyConfig(env: WebDevProxyEnv): WebDevProxyConfig {
  return loadDevProxyConfig("web", env);
}
