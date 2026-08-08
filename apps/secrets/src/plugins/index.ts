import type { FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";

import { setupDatabase } from "./database.js";

export function setupCorePlugins(app: FastifyInstance): void {
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setupDatabase(app);
}
