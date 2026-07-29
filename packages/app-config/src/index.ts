import { z } from "zod";

/**
 * Zod-backed validation for the two external config boundaries every Vite app
 * in this repo has: the browser runtime env (`import.meta.env.VITE_*`, inlined
 * at build time) and the dev-proxy env read by `vite.config.ts`.
 *
 * The field builders exist because the validation rules are identical across
 * apps while the *shapes* legitimately differ (web's Clerk key is optional,
 * admin has an auth-hub URL, auth has neither). Each app composes its own
 * schema from these builders in its `src/lib/config.ts`; what lives here is
 * everything that used to be copied verbatim between those files.
 *
 * Every builder reports failures with the exact message format the app-local
 * validators used, so the apps' existing config tests keep asserting the same
 * user-facing errors.
 */

export const DEFAULT_API_BASE_URL = "/api";
export const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:3001";
export const DEFAULT_AUTH_APP_URL = "https://auth.unimatrix-01.dev";

/** The env key names the builders accept — purely for doc-value in app code. */
export type EnvVariableName = `VITE_${string}`;

function isHttpUrl(value: string): boolean {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value);
  } catch {
    return false;
  }

  return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
}

function httpUrlMessage(variableName: EnvVariableName, value: string): string {
  return `${variableName} must be a valid http:// or https:// URL. Received ${JSON.stringify(value)}.`;
}

/**
 * Required string: must be set, must be non-empty after trimming. Returns the
 * trimmed value.
 */
export function requiredEnvString(variableName: EnvVariableName): z.ZodType<string> {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${variableName} is required and was not set.`,
        });
        return z.NEVER;
      }

      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        ctx.addIssue({ code: "custom", message: `${variableName} must not be empty.` });
        return z.NEVER;
      }

      return trimmedValue;
    });
}

/**
 * Optional string with a fallback: unset means the fallback, but a value that
 * is present and blank is a configuration mistake, not an absence — it throws
 * instead of silently becoming the fallback.
 */
export function optionalEnvString(
  variableName: EnvVariableName,
  fallback: string,
): z.ZodType<string> {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return fallback;
      }

      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `${variableName} must not be empty when it is set.`,
        });
        return z.NEVER;
      }

      return trimmedValue;
    });
}

/**
 * Optional string with no fallback: unset stays `undefined` (the feature it
 * configures is simply disabled), while a present-but-blank value is still
 * rejected. This is how `apps/web` treats its Clerk key.
 */
export function optionalEnvStringWithoutFallback(
  variableName: EnvVariableName,
): z.ZodType<string | undefined> {
  return z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return undefined;
      }

      const trimmedValue = value.trim();

      if (trimmedValue.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `${variableName} must not be empty when it is set.`,
        });
        return z.NEVER;
      }

      return trimmedValue;
    });
}

/**
 * Optional absolute http(s) URL with a fallback. Used for cross-origin
 * targets (the auth hub, the dev-proxy backend) where a site-relative path
 * would be meaningless.
 */
export function optionalHttpUrl(
  variableName: EnvVariableName,
  fallback: string,
): z.ZodType<string> {
  return optionalEnvString(variableName, fallback).transform((value, ctx) => {
    if (!isHttpUrl(value)) {
      ctx.addIssue({ code: "custom", message: httpUrlMessage(variableName, value) });
      return z.NEVER;
    }

    return value;
  });
}

/**
 * The API base URL rule shared by every app: either a site-relative path
 * beginning with a single `/` (same-origin deployments behind the edge
 * router) or an absolute http(s) URL (cross-origin deployments like the
 * admin console calling `api.`). `//host` is rejected explicitly because it
 * is scheme-relative — it would silently target another origin.
 */
export function apiBaseUrl(
  variableName: EnvVariableName = "VITE_API_BASE_URL",
  fallback: string = DEFAULT_API_BASE_URL,
): z.ZodType<string> {
  return optionalEnvString(variableName, fallback).transform((value, ctx) => {
    if (value.startsWith("/")) {
      if (value.startsWith("//")) {
        ctx.addIssue({
          code: "custom",
          message: `${variableName} must be a site-relative path beginning with a single / or a valid http:// or https:// URL.`,
        });
        return z.NEVER;
      }

      return value;
    }

    if (!isHttpUrl(value)) {
      ctx.addIssue({ code: "custom", message: httpUrlMessage(variableName, value) });
      return z.NEVER;
    }

    return value;
  });
}

/**
 * `z.object` re-exported behind a name, so apps compose their env schema
 * without carrying their own `zod` dependency — the schema library stays this
 * package's implementation detail.
 */
export function envSchema<Shape extends z.ZodRawShape>(shape: Shape): z.ZodObject<Shape> {
  return z.object(shape);
}

/**
 * Parses `env` with `schema`, converting the first Zod issue into the same
 * `Error` shape the app-local validators threw: the app label names which
 * app's boot just failed, because the message surfaces in a browser console
 * where "which bundle is this" is not otherwise obvious.
 */
export function parseAppEnv<Schema extends z.ZodType>(
  appLabel: string,
  schema: Schema,
  env: unknown,
): z.output<Schema> {
  const result = schema.safeParse(env);

  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new Error(
      `Invalid ${appLabel} configuration: ${firstIssue?.message ?? "unknown configuration error"}`,
    );
  }

  return result.data;
}

export interface DevProxyConfig {
  apiProxyTarget: string;
}

export interface DevProxyEnv {
  VITE_API_TARGET?: string | undefined;
}

const devProxyEnvSchema = z.object({
  VITE_API_TARGET: optionalHttpUrl("VITE_API_TARGET", DEFAULT_API_PROXY_TARGET),
});

/**
 * The dev-proxy loader was byte-identical in every app, so unlike the runtime
 * schemas it lives here whole. `vite.config.ts` is its only caller.
 */
export function loadDevProxyConfig(appLabel: string, env: DevProxyEnv): DevProxyConfig {
  const parsed = parseAppEnv(appLabel, devProxyEnvSchema, env);

  return { apiProxyTarget: parsed.VITE_API_TARGET };
}
