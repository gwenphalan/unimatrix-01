import { clerkPlugin, getAuth } from "@clerk/fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AdminSection, AppSlug, Role, SessionPermissionsClaim } from "./permissions.js";
import { canAccessAdminSection, hasPermission } from "./permissions.js";

/**
 * The kinds of failures `requireAuth()` and `requirePermission()` can
 * raise. `"unauthorized"` means there is no authenticated Clerk session at
 * all; `"forbidden"` means there is a session, but it lacks the required
 * permission.
 */
export type AuthErrorKind = "unauthorized" | "forbidden";

/** Stable error codes paired with each {@link AuthErrorKind}. */
export type AuthErrorCode = "UNAUTHORIZED" | "FORBIDDEN";

const AUTH_ERROR_STATUS_CODES: Record<AuthErrorKind, number> = {
  unauthorized: 401,
  forbidden: 403,
};

const AUTH_ERROR_CODES: Record<AuthErrorKind, AuthErrorCode> = {
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
};

const DEFAULT_AUTH_ERROR_MESSAGES: Record<AuthErrorKind, string> = {
  unauthorized: "Authentication is required to access this resource.",
  forbidden: "You do not have permission to access this resource.",
};

interface AuthErrorOptions {
  kind: AuthErrorKind;
  message?: string;
}

/**
 * Thrown by `requireAuth()` and `requirePermission()` guards. Designed to
 * slot into `apps/api`'s error normalization
 * (`apps/api/src/lib/http/errors.ts`'s `ApiError`/`normalizeError` pattern):
 * a downstream handler can catch `AuthError` and map `statusCode`/`code`
 * onto an `ApiError`-shaped envelope. This package intentionally does not
 * import from `apps/api` to avoid a circular dependency.
 */
export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  readonly statusCode: number;
  readonly code: AuthErrorCode;

  constructor(options: AuthErrorOptions) {
    super(options.message ?? DEFAULT_AUTH_ERROR_MESSAGES[options.kind]);

    this.name = "AuthError";
    this.kind = options.kind;
    this.statusCode = AUTH_ERROR_STATUS_CODES[options.kind];
    this.code = AUTH_ERROR_CODES[options.kind];
  }
}

/**
 * Configuration for {@link registerClerkAuth}. The consuming app reads
 * these from its own environment (typically `CLERK_SECRET_KEY`,
 * `CLERK_PUBLISHABLE_KEY`, and `CLERK_JWT_KEY`) and passes them in — this
 * package never reads `process.env` itself. `jwtKey` enables networkless
 * session JWT verification (no round-trip to Clerk's API per request).
 */
export interface RegisterClerkAuthOptions {
  /** Clerk secret key for the backend API client. */
  secretKey: string;
  /** Clerk publishable key, used to derive the Frontend API URL. */
  publishableKey: string;
  /** Clerk JWT verification key, enabling networkless session verification. */
  jwtKey: string;
}

/**
 * Registers `@clerk/fastify`'s `clerkPlugin`, configured for networkless
 * JWT verification via `jwtKey`. Call this once during app setup, before
 * any route that uses `requireAuth()` or `requirePermission()`.
 *
 * @example
 * ```ts
 * await registerClerkAuth(app, {
 *   secretKey: env.CLERK_SECRET_KEY,
 *   publishableKey: env.CLERK_PUBLISHABLE_KEY,
 *   jwtKey: env.CLERK_JWT_KEY,
 * });
 * ```
 */
export async function registerClerkAuth(
  app: FastifyInstance,
  options: RegisterClerkAuthOptions,
): Promise<void> {
  await app.register(clerkPlugin, {
    secretKey: options.secretKey,
    publishableKey: options.publishableKey,
    jwtKey: options.jwtKey,
  });
}

/**
 * Returns the verified Clerk user id for the current request's session, or
 * `null` when there is no authenticated session. This is the ONLY sanctioned
 * way to determine "who is making this request" — callers must never trust
 * a user id supplied by client input (body/query/params). Requires
 * {@link registerClerkAuth} to have been registered first, and pairs with a
 * `requireAuth()`/`requirePermission()` preHandler that has already rejected
 * unauthenticated requests, so route handlers can treat a `null` result here
 * as an unexpected/defensive case.
 */
export function getAuthUserId(request: FastifyRequest): string | null {
  return getAuth(request).userId;
}

/**
 * Extracts the typed {@link SessionPermissionsClaim} from the current
 * request's verified Clerk session claims. Returns an empty claim
 * (`{}`, which `hasPermission`/`isAdmin` treat as "no permissions") when
 * there is no authenticated session or the claim is malformed.
 *
 * Requires {@link registerClerkAuth} to have been registered first.
 */
export function getSessionPermissionsClaim(request: FastifyRequest): SessionPermissionsClaim {
  const { sessionClaims } = getAuth(request);
  const rawPermissions =
    sessionClaims === null ? undefined : (sessionClaims as { permissions?: unknown }).permissions;

  if (
    typeof rawPermissions !== "object" ||
    rawPermissions === null ||
    Array.isArray(rawPermissions)
  ) {
    return {};
  }

  return { permissions: rawPermissions };
}

/**
 * Returns a Fastify `preHandler` that requires an authenticated Clerk
 * session, throwing {@link AuthError} with `kind: "unauthorized"`
 * otherwise. Requires {@link registerClerkAuth} to have been registered
 * first.
 *
 * **The `async` is load-bearing — do not remove it.** Fastify's hook runner
 * advances the chain in exactly two ways: the hook calls the `next` callback
 * it is passed as a third argument, or it returns a thenable that Fastify
 * subscribes to (`lib/hooks.js`, `hookRunnerGenerator`). A *synchronous* hook
 * that takes only `request` therefore never advances anything: a thrown error
 * is caught and turned into a response, but a successful return value of
 * `undefined` leaves the request parked in the preHandler phase forever, with
 * the event loop free and nothing logged. The failure mode is inverted from
 * the usual one — rejected requests answer normally and *authorized* ones hang
 * — so it survives any test that only asserts 401/403.
 */
export function requireAuth() {
  // The rule is right in general and wrong here: the `async` is not sugar for
  // an awaited call, it is how Fastify is told this hook returns a thenable.
  // eslint-disable-next-line @typescript-eslint/require-await -- see the note above; removing `async` parks every authorized request forever.
  return async function requireAuthPreHandler(request: FastifyRequest): Promise<void> {
    const { userId } = getAuth(request);

    if (userId === null) {
      throw new AuthError({ kind: "unauthorized" });
    }
  };
}

/**
 * Returns a Fastify `preHandler` that requires an authenticated Clerk
 * session holding `role` for `appSlug`. Throws {@link AuthError} with
 * `kind: "unauthorized"` when there is no session, or `kind: "forbidden"`
 * when the session lacks the required permission. Requires
 * {@link registerClerkAuth} to have been registered first.
 *
 * `async` for the same load-bearing reason as {@link requireAuth} — read the
 * note there before changing this signature.
 */
export function requirePermission(appSlug: AppSlug, role: Role) {
  const requireAuthPreHandler = requireAuth();

  return async function requirePermissionPreHandler(request: FastifyRequest): Promise<void> {
    await requireAuthPreHandler(request);

    const claim = getSessionPermissionsClaim(request);

    if (!hasPermission(claim, appSlug, role)) {
      throw new AuthError({ kind: "forbidden" });
    }
  };
}

/**
 * Returns a Fastify `preHandler` that requires an authenticated Clerk session
 * allowed to access `section` of the admin app. Throws {@link AuthError} with
 * `kind: "unauthorized"` when there is no session, or `kind: "forbidden"` when
 * the session fails the section's gate. Requires {@link registerClerkAuth} to
 * have been registered first.
 *
 * This is a thin wrapper around `canAccessAdminSection` from this package's
 * `.` entry — the decision lives there, in one place, so the HTTP guard and
 * any UI check agree by construction. New admin API modules use this instead
 * of open-coding `requirePermission("auth", "admin")`.
 *
 * `async` for the same load-bearing reason as {@link requireAuth} — read the
 * note there before changing this signature.
 */
export function requireAdminSection(section: AdminSection) {
  const requireAuthPreHandler = requireAuth();

  return async function requireAdminSectionPreHandler(request: FastifyRequest): Promise<void> {
    await requireAuthPreHandler(request);

    const claim = getSessionPermissionsClaim(request);

    if (!canAccessAdminSection(claim, section)) {
      throw new AuthError({ kind: "forbidden" });
    }
  };
}
