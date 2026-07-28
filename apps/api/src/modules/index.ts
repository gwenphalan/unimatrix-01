import type { FastifyPluginAsync } from "fastify";

import { contentModule } from "./content/index.js";
import { healthModule } from "./health/index.js";
import { userDataModule } from "./user-data/index.js";

export const registerModules: FastifyPluginAsync = (app) => {
  app.register(healthModule);

  // Registered unconditionally: its public read routes back the public site's
  // blog and project pages, which must render whether or not Clerk is
  // configured. The module registers its own admin routes internally only
  // when Clerk is present.
  app.register(contentModule);

  // Only registered when Clerk is configured: requireAuth()/requirePermission()
  // need registerClerkAuth() to have run, and there is no auth surface to
  // expose in local dev without Clerk keys.
  if (app.runtimeConfig.clerk !== null) {
    app.register(userDataModule);
  }

  return Promise.resolve();
};
