import fastifyRateLimit from "@fastify/rate-limit";
import { requireAdminSection } from "@unimatrix/auth/server";
import { SecretsClientError, type SecretsManagementClient } from "@unimatrix/secrets/client";
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

import { getRequiredAuthUserId } from "../../lib/http/auth.js";
import { ApiError } from "../../lib/http/errors.js";
import { SECRETS_ADMIN_RATE_LIMIT_OPTIONS } from "../../plugins/rate-limit.js";
import { mergeAdminSecretRows, tierForName } from "./rows.js";

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
 *
 * Pass `null` from a route that names no secret. There, an upstream 404 can
 * only mean the store's own route is missing or the token this API sent
 * cannot list — both faults on our side of the call, so it falls
 * through to the 502 branch rather than telling the browser a client-side
 * "not found" about a resource it never asked for.
 */
function toApiError(
  request: FastifyRequest,
  error: unknown,
  notFoundMessage: string | null,
): never {
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
      if (notFoundMessage !== null) {
        throw new ApiError({
          statusCode: 404,
          code: "NOT_FOUND",
          message: notFoundMessage,
          cause: error,
        });
      }

      request.log.error(
        { status: error.status },
        "the secrets store answered 404 for a route that names no secret",
      );
      throw new ApiError({
        statusCode: 502,
        code: "INTERNAL_ERROR",
        message: "The secrets store is unavailable.",
        cause: error,
      });
    case 401:
    case 403:
      // One of the API's own scoped tokens is the thing that's wrong here,
      // not anything the caller sent — never say that to the browser.
      request.log.error(
        { status: error.status },
        "the secrets store rejected one of the API's own scoped tokens",
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
 * Registered only when Clerk, the secrets store, and both scoped tokens are
 * configured — see `src/modules/index.ts`. `requireAdminSection` needs
 * `registerClerkAuth` to have run (same reason `integrationsModule` is
 * conditional), and admin secrets routes with no client to call are better
 * absent than 500ing on every request.
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

  /**
   * A service token carries one scope prefix and no wildcard, so create and
   * rotate have to go out on the token whose scope covers the name. The
   * platform client's `write` capability can do both and nothing else.
   */
  function clientForName(name: string): SecretsManagementClient {
    return tierForName(name) === "platform"
      ? app.secretsManagement.platform
      : app.secretsManagement.integrations;
  }

  app.withTypeProvider<ZodTypeProvider>().route({
    method: adminListSecretsContract.method,
    url: adminListSecretsContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      response: { 200: adminListSecretsContract.responseSchema },
    },
    handler: async (request) => {
      try {
        // Both lists or none. A partial answer would render the unreachable
        // tier's names as "not set" — telling an operator the system lacks a
        // credential it actually holds, which is the one wrong answer this
        // route exists to prevent. `Promise.all` rejecting on the first
        // failure is what makes that a 502 rather than a half-truth.
        const [platform, integrations] = await Promise.all([
          app.secretsManagement.platform.listSecrets(),
          app.secretsManagement.integrations.listSecrets(),
        ]);

        return {
          secrets: mergeAdminSecretRows({
            platform: platform.secrets,
            integration: integrations.secrets,
          }),
          // Both calls hit the same store and therefore the same keyring, so
          // these agree except when a rotation lands between two concurrent
          // requests. Taking the higher one keeps a row sealed under the older
          // key showing as behind, which is the direction that cannot mislead.
          activeKekVersion: Math.max(platform.activeKekVersion, integrations.activeKekVersion),
        };
      } catch (error) {
        toApiError(request, error, null);
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
        return await clientForName(name).createSecret({ name, value, actorUserId });
      } catch (error) {
        toApiError(request, error, "That name is outside the namespace this console manages.");
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
        return await clientForName(name).rotateSecret({ name, value, actorUserId });
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

      // The second of two guards, and the only one that can explain itself:
      // the platform token holds `write`, so the store would refuse this
      // anyway — with the same 404 it uses for a missing name, which would
      // send an operator hunting a credential that is sitting right there.
      if (tierForName(name) === "platform") {
        throw new ApiError({
          statusCode: 403,
          code: "FORBIDDEN",
          message:
            "Platform credentials cannot be deleted here. Rotate it instead, or remove it with the secrets service's host CLI.",
        });
      }

      try {
        // Always the integrations client, never a tier-dependent one: the
        // request is then impossible to make against `platform/*` even if the
        // guard above were removed.
        const { affected } = await app.secretsManagement.integrations.deleteSecrets({
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
