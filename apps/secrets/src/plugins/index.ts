import type { FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { setupServiceTokenAuth } from "./auth.js";
import { setupDatabase } from "./database.js";
import { setupRateLimit } from "./rate-limit.js";

/**
 * The order of these two lines does not decide which of the limiter and the
 * guard runs first — hook *phase* does, and `setupServiceTokenAuth` explains
 * which phase it picked and why. Reordering them changes nothing.
 */
export function setupCorePlugins(app: FastifyInstance): void {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setupDatabase(app);
  setupRateLimit(app);
  setupServiceTokenAuth(app);
}
