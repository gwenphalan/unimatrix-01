import { bulkResultSchema } from "../schemas/content.js";
import {
  createSecretBodySchema,
  deleteSecretsBodySchema,
  getSecretQuerySchema,
  listSecretsQuerySchema,
  listSecretsResponseSchema,
  rotateSecretBodySchema,
  secretMetadataSchema,
  secretValueResponseSchema,
} from "../schemas/secrets.js";
import { defineApiContract } from "./api-contract.js";

/**
 * These contracts target `apps/secrets`, a separate Fastify service from the
 * content API every other contract in this barrel describes, and are not for
 * `@unimatrix/api-client` — `client.ts` builds request URLs from a single
 * base URL, so a client method built from one of these paths would send it
 * to the wrong service.
 */
export const getSecretValueContract = defineApiContract({
  method: "GET",
  path: "/secrets/value",
  querySchema: getSecretQuerySchema,
  responseSchema: secretValueResponseSchema,
});

export type GetSecretValueContract = typeof getSecretValueContract;

export const listSecretsContract = defineApiContract({
  method: "GET",
  path: "/secrets",
  querySchema: listSecretsQuerySchema,
  responseSchema: listSecretsResponseSchema,
});

export type ListSecretsContract = typeof listSecretsContract;

export const createSecretContract = defineApiContract({
  method: "POST",
  path: "/secrets",
  bodySchema: createSecretBodySchema,
  responseSchema: secretMetadataSchema,
});

export type CreateSecretContract = typeof createSecretContract;

export const rotateSecretContract = defineApiContract({
  method: "POST",
  path: "/secrets/rotate",
  bodySchema: rotateSecretBodySchema,
  responseSchema: secretMetadataSchema,
});

export type RotateSecretContract = typeof rotateSecretContract;

export const deleteSecretsContract = defineApiContract({
  method: "DELETE",
  path: "/secrets",
  bodySchema: deleteSecretsBodySchema,
  responseSchema: bulkResultSchema,
});

export type DeleteSecretsContract = typeof deleteSecretsContract;
