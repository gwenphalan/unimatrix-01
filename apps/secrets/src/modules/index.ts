import type { FastifyPluginAsync } from "fastify";

import { healthModule } from "./health/index.js";
import { secretsModule } from "./secrets/index.js";

export const registerModules: FastifyPluginAsync = (app) => {
  app.register(healthModule);
  app.register(secretsModule);

  return Promise.resolve();
};
