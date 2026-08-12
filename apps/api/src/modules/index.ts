import type { FastifyPluginAsync } from "fastify";

import { contentModule } from "./content/index.js";
import { healthModule } from "./health/index.js";
import { integrationsModule } from "./integrations/index.js";
import { secretsAdminModule } from "./secrets/index.js";
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

  // Needs both: requireAdminSection() needs registerClerkAuth() to have run
  // (same reason as userDataModule above), and a refresh route with no
  // configured secrets store is better absent than 500ing on every call.
  if (app.runtimeConfig.clerk !== null && app.runtimeConfig.secretsStore !== null) {
    app.register(integrationsModule);
  }

  // Needs Clerk (same reason as integrationsModule above) plus a manage
  // token specifically, not just a configured store: `setupSecretsManagement`
  // only decorates `app.secretsManagement` when `secretsStore.manageToken`
  // is set, and admin secrets routes with no client to call are better
  // absent than 500ing on every request.
  if (
    app.runtimeConfig.clerk !== null &&
    app.runtimeConfig.secretsStore !== null &&
    app.runtimeConfig.secretsStore.manageToken !== null
  ) {
    app.register(secretsAdminModule);
  }

  return Promise.resolve();
};
