import { refreshIntegrationCredentialsResponseSchema } from "../schemas/integrations.js";
import { defineApiContract } from "./api-contract.js";

/**
 * Targets `apps/api`, not `apps/secrets` — a file of its own rather than an
 * addition to `contracts/secrets.ts`, whose header comment scopes that file
 * to the secrets service. No body, no query: the path stays static and the
 * route re-fetches every configured name.
 */
export const refreshIntegrationCredentialsContract = defineApiContract({
  method: "POST",
  path: "/integrations/admin/credentials/refresh",
  responseSchema: refreshIntegrationCredentialsResponseSchema,
});

export type RefreshIntegrationCredentialsContract = typeof refreshIntegrationCredentialsContract;
