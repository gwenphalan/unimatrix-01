import { randomUUID } from "node:crypto";

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  createSecretBodySchema,
  createSecretContract,
  deleteSecretsBodySchema,
  deleteSecretsContract,
  getSecretQuerySchema,
  getSecretValueContract,
  rotateSecretBodySchema,
  rotateSecretContract,
} from "@unimatrix/shared";

import { recordAuditEntry } from "../../audit/index.js";
import type { SecretsDatabaseWriter } from "../../db/client.js";
import { openSecretPlaintext, sealSecretPlaintext } from "../../keyring.js";
import { SecretsHttpError } from "../../lib/http/errors.js";
import type { AuthenticatedServiceToken } from "../../plugins/auth.js";
import { scopeCoversName } from "../../service-tokens/scope.js";
import type { ServiceTokenCapability } from "../../service-tokens/index.js";

import {
  createSecret,
  deleteSecrets,
  getLiveSecretVersion,
  listExistingSecretNames,
  rotateSecret,
  type SecretMetadataRow,
} from "./store.js";

/**
 * The one construction site for the 404 every in-handler denial throws.
 * Mirrors `denyRequest` in `../../plugins/auth.ts`, which already solved the
 * identical problem for its four 401 reasons: a wrong-capability caller, an
 * out-of-scope name and an absent one must read as the same response, so
 * only the log — never the body — carries which one happened.
 */
function denySecretAccess(request: FastifyRequest, reason: string): never {
  request.log.warn(
    {
      requestId: String(request.id),
      route: request.routeOptions.url ?? null,
      reason,
    },
    "secret access denied",
  );

  throw new SecretsHttpError({ statusCode: 404, code: "NOT_FOUND", message: "Route not found" });
}

/**
 * Every route here runs behind the instance-level auth guard, but
 * `request.serviceToken` is still typed `AuthenticatedServiceToken | null` —
 * a bare property access would let a gap in that guard throw a TypeError
 * into a 500 instead of the 404 this service denies everything else with.
 * Exported so `test/secrets-routes.test.ts` can exercise the null branch
 * directly: the auth guard denies an unauthenticated request before any
 * route-level hook here runs, so no real request reaches it.
 */
export function getServiceToken(request: FastifyRequest): AuthenticatedServiceToken {
  const token = request.serviceToken;

  if (token === null) {
    denySecretAccess(request, "missing_token");
  }

  return token;
}

/**
 * A route-level `preValidation` hook, which Fastify runs after the
 * instance-level auth guard and before schema validation — so a wrong-
 * capability caller with a malformed body still gets the 404 rather than a
 * 400 that discloses the route exists.
 *
 * Returns a `Promise`, not a plain synchronous function: Fastify's hook
 * runner only advances the chain when a hook either calls the `done`
 * callback it never declares here or returns something thenable
 * (`lib/hooks.js`'s `hookRunnerGenerator` — `result && typeof result.then
 * === "function"`). A synchronous function returning `undefined` satisfies
 * neither, so the request hangs forever with no error (measured — every
 * route below stalled silently until this returned a `Promise`).
 */
function requireCapability(
  capability: ServiceTokenCapability,
): (request: FastifyRequest) => Promise<void> {
  return (request) => {
    const token = getServiceToken(request);

    if (token.capability !== capability) {
      denySecretAccess(request, "wrong_capability");
    }

    return Promise.resolve();
  };
}

/**
 * Runs a mutation and the audit row recording it as one transaction, same
 * pattern as `writeAtomically` in `../../cli/service-token.ts`. `better-sqlite3`
 * is synchronous, so nothing else can interleave between the writes, and
 * `behavior: "immediate"` takes the write lock up front rather than on the
 * transaction's first statement.
 */
function writeAtomically<T>(
  app: FastifyInstance,
  write: (tx: SecretsDatabaseWriter) => T,
): T {
  return app.db.transaction(write, { behavior: "immediate" });
}

// `schema.body`/`schema.querystring` take the schema constants directly
// rather than `someContract.bodySchema`/`.querySchema` — those `ApiContract`
// fields are optional (`bodySchema?:`), so reading them back always types as
// `ZodType | undefined`, which `ZodTypeProvider` cannot infer a request type
// from; `request.body` typechecks as `unknown` (measured). `responseSchema`
// is a required field and has no such gap, so every route below reads it
// straight off the contract.
export const secretsModule: FastifyPluginAsync = (app) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: createSecretContract.method,
    url: createSecretContract.path,
    preValidation: requireCapability("manage"),
    schema: {
      body: createSecretBodySchema,
      response: { 200: createSecretContract.responseSchema },
    },
    handler: (request) => {
      const { name, value } = request.body;
      const token = getServiceToken(request);

      if (!scopeCoversName(token.scopePrefix, name)) {
        denySecretAccess(request, "out_of_scope");
      }

      if (getLiveSecretVersion(app.db, name) !== undefined) {
        throw new SecretsHttpError({
          statusCode: 400,
          code: "VALIDATION_ERROR",
          message: "A secret with this name already exists.",
        });
      }

      const versionId = randomUUID();
      const sealed = sealSecretPlaintext(app.runtimeConfig.keyring, { name, versionId }, value);

      return writeAtomically<SecretMetadataRow>(app, (tx) => {
        const metadata = createSecret(tx, {
          name,
          versionId,
          envelope: sealed.envelope,
          maskedPrefix: sealed.maskedPrefix,
          kekVersion: sealed.kekVersion,
        });

        recordAuditEntry(tx, {
          action: "secret.created",
          actorKind: "service-token",
          outcome: "success",
          actorTokenId: token.id,
          secretName: name,
          secretVersionId: versionId,
        });

        return metadata;
      });
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: rotateSecretContract.method,
    url: rotateSecretContract.path,
    preValidation: requireCapability("manage"),
    schema: {
      body: rotateSecretBodySchema,
      response: { 200: rotateSecretContract.responseSchema },
    },
    handler: (request) => {
      const { name, value } = request.body;
      const token = getServiceToken(request);

      if (!scopeCoversName(token.scopePrefix, name)) {
        denySecretAccess(request, "out_of_scope");
      }

      if (getLiveSecretVersion(app.db, name) === undefined) {
        denySecretAccess(request, "not_found");
      }

      const versionId = randomUUID();
      const sealed = sealSecretPlaintext(app.runtimeConfig.keyring, { name, versionId }, value);

      return writeAtomically<SecretMetadataRow>(app, (tx) => {
        const metadata = rotateSecret(tx, {
          name,
          versionId,
          envelope: sealed.envelope,
          maskedPrefix: sealed.maskedPrefix,
          kekVersion: sealed.kekVersion,
        });

        recordAuditEntry(tx, {
          action: "secret.rotated",
          actorKind: "service-token",
          outcome: "success",
          actorTokenId: token.id,
          secretName: name,
          secretVersionId: versionId,
        });

        return metadata;
      });
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: deleteSecretsContract.method,
    url: deleteSecretsContract.path,
    preValidation: requireCapability("manage"),
    schema: {
      body: deleteSecretsBodySchema,
      response: { 200: deleteSecretsContract.responseSchema },
    },
    handler: (request) => {
      const { names } = request.body;
      const token = getServiceToken(request);

      for (const name of names) {
        if (!scopeCoversName(token.scopePrefix, name)) {
          denySecretAccess(request, "out_of_scope");
        }
      }

      // The whole request is denied if any name is unreachable — checked
      // before anything is deleted, so a partly-out-of-scope or partly-
      // nonexistent selection deletes nothing rather than deleting the
      // reachable subset.
      const existing = listExistingSecretNames(app.db, names);

      for (const name of names) {
        if (!existing.has(name)) {
          denySecretAccess(request, "not_found");
        }
      }

      const affected = writeAtomically<number>(app, (tx) => {
        const count = deleteSecrets(tx, names);

        for (const name of names) {
          recordAuditEntry(tx, {
            action: "secret.deleted",
            actorKind: "service-token",
            outcome: "success",
            actorTokenId: token.id,
            secretName: name,
          });
        }

        return count;
      });

      return { affected };
    },
  });

  app.withTypeProvider<ZodTypeProvider>().route({
    method: getSecretValueContract.method,
    url: getSecretValueContract.path,
    preValidation: requireCapability("read"),
    schema: {
      querystring: getSecretQuerySchema,
      response: { 200: getSecretValueContract.responseSchema },
    },
    // Every branch below — out of scope, absent, decrypt failure, success —
    // records exactly one `secret.read` audit row and denies or returns.
    // Each `recordAuditEntry` call runs on `app.db` directly rather than
    // inside `writeAtomically`: a denial's audit row has to survive the
    // `SecretsHttpError` thrown right after it, and a transaction wrapping
    // both would roll the row back along with the throw.
    handler: (request) => {
      const { name } = request.query;
      const token = getServiceToken(request);

      if (!scopeCoversName(token.scopePrefix, name)) {
        recordAuditEntry(app.db, {
          action: "secret.read",
          actorKind: "service-token",
          outcome: "failure",
          actorTokenId: token.id,
          secretName: name,
        });
        denySecretAccess(request, "out_of_scope");
      }

      const live = getLiveSecretVersion(app.db, name);

      if (live === undefined) {
        recordAuditEntry(app.db, {
          action: "secret.read",
          actorKind: "service-token",
          outcome: "failure",
          actorTokenId: token.id,
          secretName: name,
        });
        denySecretAccess(request, "not_found");
      }

      try {
        const value = openSecretPlaintext(
          app.runtimeConfig.keyring,
          { name, versionId: live.versionId },
          live.envelope,
        );

        recordAuditEntry(app.db, {
          action: "secret.read",
          actorKind: "service-token",
          outcome: "success",
          actorTokenId: token.id,
          secretName: name,
          secretVersionId: live.versionId,
        });

        return { name, value };
      } catch (error) {
        // Never becomes a 404: `SecretsError` (`@unimatrix/secrets`) carries
        // no `statusCode`, so `normalizeSecretsError` already turns it into
        // a bare 500. Reporting an unreadable credential as absent sends the
        // operator hunting a row that is right there.
        recordAuditEntry(app.db, {
          action: "secret.read",
          actorKind: "service-token",
          outcome: "failure",
          actorTokenId: token.id,
          secretName: name,
          secretVersionId: live.versionId,
        });

        throw error;
      }
    },
  });

  return Promise.resolve();
};
