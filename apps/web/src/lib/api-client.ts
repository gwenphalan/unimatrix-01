import { createApiClient, type ApiClient } from "@unimatrix/api-client";

import { loadWebRuntimeConfig } from "./config.js";

const runtimeConfig = loadWebRuntimeConfig({
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
});

/**
 * Tokenless API client for the public site's reads (for example
 * `GET /content/posts`, `GET /health`). The public site carries no auth of
 * its own, so this is the only client this app constructs.
 */
export const apiClient: ApiClient = createApiClient({
  baseUrl: runtimeConfig.apiBaseUrl,
});
