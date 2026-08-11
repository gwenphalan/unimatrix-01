import fastifyRateLimit from "@fastify/rate-limit";
import { getAuthUserId, requireAdminSection } from "@unimatrix/auth/server";
import { SecretsClientError } from "@unimatrix/secrets/client";
import {
  adminCreateSecretBodySchema,
  adminCreateSecretContract,
  adminDeleteSecretBodySchema,
  adminDeleteSecretContract,
  adminListSecretsContract,
  adminRotateSecretBodySchema,
  adminRotateSecretContract,
} from "@unimatrix/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { ApiError } from "../../lib/http/errors.js";
import { SECRETS_ADMIN_RATE_LIMIT_OPTIONS } from "../../plugins/rate-limit.js";

/**
 * Mirrors `getRequiredAuthUserId` in `../user-data/index.ts`: every route in
 * this module runs behind `requireAdminSection("secrets")`, so a `null`
 * result here is the defensive case, not a normal control-flow path. Never
 * read the acting user from `request.body` instead — the admin body schemas
 * are `strictObject` and carry no such field, so a browser that sends one is
 * rejected by schema validation before a handler ever runs.
 */
function getRequiredAuthUserId(request: FastifyRequest): string {
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

/**
 * Maps a rejection from `app.secretsManagement` to the `ApiError` this
 * route should throw instead. Narrows on `instanceof SecretsClientError` and
 * rethrows everything else unchanged — a bug in a handler above this call
 * must still surface as the 500 it actually is, not get folded into "the
 * secrets store is unavailable".
 *
 * `notFoundMessage` differs by call site: `apps/secrets`' create route
 * returns 404 for a name outside the caller's configured scope prefix,
 * while rotate and delete return 404 for a name that is not there at all —
 * two different facts that deserve two different messages, even though the
 * store answers both with the same status.
 */
function toApiError(request: FastifyRequest, error: unknown, notFoundMessage: string): never {
  if (!(error instanceof SecretsClientError)) {
    throw error;
  }

  switch (error.status) {
    case 409:
      throw new ApiError({
        statusCode: 409,
        code: "CLIENT_ERROR",
        message: "A secret with that name already exists.",
        cause: error,
      });
    case 400:
      throw new ApiError({
        statusCode: 502,
        code: "INTERNAL_ERROR",
        message: "The secrets store rejected the request.",
        cause: error,
      });
    case 404:
      throw new ApiError({
        statusCode: 404,
        code: "NOT_FOUND",
        message: notFoundMessage,
        cause: error,
      });
    case 401:
    case 403:
      // The API's own manage token is the thing that's wrong here, not
      // anything the caller sent — never say that to the browser.
      request.log.error(
        { status: error.status },
        "the secrets store rejected the API's own manage token",
      );
      throw new ApiError({
        statusCode: 502,
        code: "INTERNAL_ERROR",
        message: "The secrets store is unavailable.",
        cause: error,
      });
    case 429:
      throw new ApiError({
        statusCode: 429,
        code: "RATE_LIMITED",
        message: "The secrets store is rate-limiting this request. Try again shortly.",
        cause: error,
      });
    default:
      throw new ApiError({
        statusCode: 502,
        code: "INTERNAL_ERROR",
        message: "The secrets store is unavailable.",
        cause: error,
      });
  }
}

/**
 * Registered only when Clerk, the secrets store, and a manage token are all
 * configured — see `src/modules/index.ts`. `requireAdminSection` needs
 * `registerClerkAuth` to have run (same reason `integrationsModule` is
 * conditional), and admin secrets routes with no manage-capability client to
 * call are better absent than 500ing on every request.
 *
 * `schema.body` on every mutation route takes the `admin*BodySchema`
 * constants directly rather than `contract.bodySchema` — that field is
 * optional on `ApiContract`, so reading it back types `request.body` as
 * `unknown` (see the comment in `apps/secrets/src/modules/secrets/index.ts`,
 * which hit the same gap first).
 */
export const secretsAdminModule: FastifyPluginAsync = async (app) => {
  // Registered here as well as globally in `src/plugins/rate-limit.ts`, same
  // reasoning as `integrationsModule`: this module is an encapsulated
  // plugin, so the root-scope ceiling is not visible from inside it. All
  // four routes below share this one bucket.
  await app.register(fastifyRateLimit, SECRETS_ADMIN_RATE_LIMIT_OPTIONS);

  app.withTypeProvider<ZodTypeProvider>().route({
    method: adminListSecretsContract.method,
    url: adminListSecretsContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      response: { 200: adminListSecretsContract.responseSchema },
    },
    handler: async (request) => {
      try {
        return await app.secretsManagement.listSecrets();
      } catch (error) {
        toApiError(request, error, "No secret with that name is reachable.");
      }
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: adminCreateSecretContract.method,
    url: adminCreateSecretContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      body: adminCreateSecretBodySchema,
      response: { 200: adminCreateSecretContract.responseSchema },
    },
    handler: async (request) => {
      const { name, value } = request.body;
      const actorUserId = getRequiredAuthUserId(request);

      try {
        return await app.secretsManagement.createSecret({ name, value, actorUserId });
      } catch (error) {
        toApiError(
          request,
          error,
          "That name is outside the namespace this console manages.",
        );
      }
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: adminRotateSecretContract.method,
    url: adminRotateSecretContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      body: adminRotateSecretBodySchema,
      response: { 200: adminRotateSecretContract.responseSchema },
    },
    handler: async (request) => {
      const { name, value } = request.body;
      const actorUserId = getRequiredAuthUserId(request);

      try {
        return await app.secretsManagement.rotateSecret({ name, value, actorUserId });
      } catch (error) {
        toApiError(request, error, "No secret with that name is reachable.");
      }
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: adminDeleteSecretContract.method,
    url: adminDeleteSecretContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      body: adminDeleteSecretBodySchema,
      response: { 200: adminDeleteSecretContract.responseSchema },
    },
    handler: async (request) => {
      const { name } = request.body;
      const actorUserId = getRequiredAuthUserId(request);

      try {
        const { affected } = await app.secretsManagement.deleteSecrets({
          names: [name],
          actorUserId,
        });

        return { deleted: affected > 0 };
      } catch (error) {
        toApiError(request, error, "No secret with that name is reachable.");
      }
    },
  });
};
