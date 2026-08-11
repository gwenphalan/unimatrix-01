import type { FastifyInstance } from "fastify";

import { setupHttpValidation } from "../lib/http/validation.js";
import { setupAuth } from "./auth.js";
import { setupCors } from "./cors.js";
import { setupDatabase } from "./database.js";
import { setupIntegrationCredentials } from "./integration-credentials.js";
import { setupObservability } from "./observability.js";
import { setupRateLimit } from "./rate-limit.js";
import { setupSecurity } from "./security.js";

export interface SetupCorePluginsOptions {
  secretsFetch?: typeof globalThis.fetch;
}

export function setupCorePlugins(
  app: FastifyInstance,
  options: SetupCorePluginsOptions = {},
): void {
  setupHttpValidation(app);
  setupObservability(app);
  setupSecurity(app);
  // Before the routes and outside every module, so a route cannot be added
  // without a ceiling by being added somewhere this was not thought about.
  setupRateLimit(app);
  setupCors(app);
  setupAuth(app);
  // Registered unconditionally: it is cheap (a single SQLite connection) and
  // independent of Clerk configuration, unlike setupAuth().
  setupDatabase(app);
  setupIntegrationCredentials(
    app,
    options.secretsFetch === undefined ? {} : { fetch: options.secretsFetch },
  );
}
