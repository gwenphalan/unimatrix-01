import { z } from "zod";

import { secretNameSchema } from "./secrets.js";

/**
 * The result of `apps/api` re-fetching its declared integration credentials
 * from the secrets service. Names only — never a value, never a masked
 * prefix, since this crosses back to whoever called the admin route.
 *
 * `denied` cannot distinguish an absent secret from a mis-scoped or
 * wrong-capability service token: `apps/secrets` returns a byte-identical
 * 404 for all three (one construction site — see
 * `apps/secrets/src/modules/secrets/index.ts`). An operator reading a
 * `denied` name should check the configured service token's scope before
 * assuming the row does not exist.
 */
export const refreshIntegrationCredentialsResponseSchema = z.strictObject({
  loaded: z.array(secretNameSchema),
  denied: z.array(secretNameSchema),
  failed: z.array(secretNameSchema),
});

export type RefreshIntegrationCredentialsResponse = z.output<
  typeof refreshIntegrationCredentialsResponseSchema
>;
