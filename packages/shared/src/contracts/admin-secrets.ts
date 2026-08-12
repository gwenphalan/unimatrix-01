import {
  adminCreateSecretBodySchema,
  adminDeleteSecretBodySchema,
  adminDeleteSecretResponseSchema,
  adminRotateSecretBodySchema,
  listSecretsResponseSchema,
  secretMetadataSchema,
} from "../schemas/secrets.js";
import { defineApiContract } from "./api-contract.js";

/**
 * Targets `apps/api`, not `apps/secrets` — a file of its own rather than an
 * addition to `contracts/secrets.ts`, whose header comment scopes that file
 * to the secrets service (see `contracts/integrations.ts` for the same
 * split). These are browser-facing: every body schema here omits
 * `actorUserId`, which the API attaches from the verified session rather
 * than trusting from the request. None of these contracts ever returns a
 * decrypted value — that stays on `getSecretValueContract`, reachable only
 * with a `read`-capability service token no admin surface holds.
 */
export const adminListSecretsContract = defineApiContract({
  method: "GET",
  path: "/secrets/admin",
  responseSchema: listSecretsResponseSchema,
});

export type AdminListSecretsContract = typeof adminListSecretsContract;

export const adminCreateSecretContract = defineApiContract({
  method: "POST",
  path: "/secrets/admin",
  bodySchema: adminCreateSecretBodySchema,
  responseSchema: secretMetadataSchema,
});

export type AdminCreateSecretContract = typeof adminCreateSecretContract;

export const adminRotateSecretContract = defineApiContract({
  method: "POST",
  path: "/secrets/admin/rotate",
  bodySchema: adminRotateSecretBodySchema,
  responseSchema: secretMetadataSchema,
});

export type AdminRotateSecretContract = typeof adminRotateSecretContract;

export const adminDeleteSecretContract = defineApiContract({
  method: "DELETE",
  path: "/secrets/admin",
  bodySchema: adminDeleteSecretBodySchema,
  responseSchema: adminDeleteSecretResponseSchema,
});

export type AdminDeleteSecretContract = typeof adminDeleteSecretContract;
