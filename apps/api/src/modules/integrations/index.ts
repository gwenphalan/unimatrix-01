import fastifyRateLimit from "@fastify/rate-limit";
import { requireAdminSection } from "@unimatrix/auth/server";
import { refreshIntegrationCredentialsContract } from "@unimatrix/shared";
import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import { INTEGRATION_CREDENTIALS_REFRESH_RATE_LIMIT_OPTIONS } from "../../plugins/rate-limit.js";

/**
 * Registered only when both Clerk and the secrets store are configured — see
 * `src/modules/index.ts`. `requireAdminSection` needs `registerClerkAuth` to
 * have run (same reason `userDataModule` is conditional), and a refresh route
 * with no store to refresh is better absent than 500ing on every call.
 */
export const integrationsModule: FastifyPluginAsync = async (app) => {
  // Registered here as well as globally in `src/plugins/rate-limit.ts`, same
  // reasoning as `contentModule`: this module is an encapsulated plugin, so
  // the root-scope ceiling is not visible from inside it — not to a reader of
  // this file and not to CodeQL, which would otherwise report this route as
  // unlimited.
  await app.register(fastifyRateLimit, INTEGRATION_CREDENTIALS_REFRESH_RATE_LIMIT_OPTIONS);

  app.withTypeProvider<ZodTypeProvider>().route({
    method: refreshIntegrationCredentialsContract.method,
    url: refreshIntegrationCredentialsContract.path,
    preHandler: requireAdminSection("secrets"),
    schema: {
      response: {
        200: refreshIntegrationCredentialsContract.responseSchema,
      },
    },
    handler: () => app.integrationCredentials.refresh(),
  });
};
