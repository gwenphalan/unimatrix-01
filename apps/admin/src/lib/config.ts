export interface AdminAppRuntimeConfig {
  apiBaseUrl: string;
  authAppUrl: string;
  clerkPublishableKey: string;
}

export interface AdminAppDevProxyConfig {
  apiProxyTarget: string;
}

export interface AdminAppRuntimeEnv {
  VITE_API_BASE_URL?: string | undefined;
  VITE_AUTH_APP_URL?: string | undefined;
  VITE_CLERK_PUBLISHABLE_KEY?: string | undefined;
}

export interface AdminAppDevProxyEnv {
  VITE_API_TARGET?: string | undefined;
}

export const DEFAULT_API_BASE_URL = "/api";
export const DEFAULT_AUTH_APP_URL = "https://auth.unimatrix-01.dev";
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:3001";

function createAdminAppConfigError(message: string): Error {
  return new Error(`Invalid admin app configuration: ${message}`);
}

function readOptionalString(
  variableName: keyof (AdminAppRuntimeEnv & AdminAppDevProxyEnv),
  value: string | undefined,
  fallback: string,
): string {
  if (value === undefined) {
    return fallback;
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createAdminAppConfigError(`${variableName} must not be empty when it is set.`);
  }

  return trimmedValue;
}

function readRequiredString(
  variableName: keyof AdminAppRuntimeEnv,
  value: string | undefined,
): string {
  if (value === undefined) {
    throw createAdminAppConfigError(`${variableName} is required and was not set.`);
  }

  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw createAdminAppConfigError(`${variableName} must not be empty.`);
  }

  return trimmedValue;
}

function validateHttpUrl(
  variableName: keyof (AdminAppRuntimeEnv & AdminAppDevProxyEnv),
  value: string,
): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    throw createAdminAppConfigError(
      `${variableName} must be a valid http:// or https:// URL. Received ${JSON.stringify(value)}.`,
    );
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw createAdminAppConfigError(
      `${variableName} must be a valid http:// or https:// URL. Received ${JSON.stringify(value)}.`,
    );
  }

  return value;
}

function validateApiBaseUrl(value: string | undefined): string {
  const apiBaseUrl = readOptionalString("VITE_API_BASE_URL", value, DEFAULT_API_BASE_URL);

  if (apiBaseUrl.startsWith("/")) {
    if (apiBaseUrl.startsWith("//")) {
      throw createAdminAppConfigError(
        "VITE_API_BASE_URL must be a site-relative path beginning with a single / or a valid http:// or https:// URL.",
      );
    }

    return apiBaseUrl;
  }

  return validateHttpUrl("VITE_API_BASE_URL", apiBaseUrl);
}

function validateAuthAppUrl(value: string | undefined): string {
  return validateHttpUrl(
    "VITE_AUTH_APP_URL",
    readOptionalString("VITE_AUTH_APP_URL", value, DEFAULT_AUTH_APP_URL),
  );
}

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
export function loadAdminAppRuntimeConfig(env: AdminAppRuntimeEnv): AdminAppRuntimeConfig {
  return {
    apiBaseUrl: validateApiBaseUrl(env.VITE_API_BASE_URL),
    authAppUrl: validateAuthAppUrl(env.VITE_AUTH_APP_URL),
    clerkPublishableKey: readRequiredString(
      "VITE_CLERK_PUBLISHABLE_KEY",
      env.VITE_CLERK_PUBLISHABLE_KEY,
    ),
  };
}

export function loadAdminAppDevProxyConfig(env: AdminAppDevProxyEnv): AdminAppDevProxyConfig {
  return {
    apiProxyTarget: validateHttpUrl(
      "VITE_API_TARGET",
      readOptionalString("VITE_API_TARGET", env.VITE_API_TARGET, DEFAULT_API_PROXY_TARGET),
    ),
  };
}

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
