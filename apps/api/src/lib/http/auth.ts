import { getAuthUserId } from "@unimatrix/auth/server";
import type { FastifyRequest } from "fastify";

import { ApiError } from "./errors.js";

/**
 * The acting user, read only from the verified Clerk session — never from a
 * client-supplied id or body field.
 *
 * Every caller sits behind a guard that already rejects an unauthenticated
 * request (`requireAuth()` in `modules/user-data`, `requireAdminSection()` in
 * `modules/secrets`), so a `null` here is defensive rather than a normal
 * control-flow path. It becomes a 401 instead of flowing on as `undefined`,
 * which downstream would either write an unattributed row or fail somewhere
 * that no longer names the cause.
 */
export function getRequiredAuthUserId(request: FastifyRequest): string {
  const userId = getAuthUserId(request);

  if (userId === null) {
    throw new ApiError({
      statusCode: 401,
      code: "UNAUTHORIZED",
      message: "Authentication is required to access this resource.",
    });
  }

  return userId;
}
