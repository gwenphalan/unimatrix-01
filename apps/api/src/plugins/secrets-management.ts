import {
  createSecretsManagementClient,
  type SecretsManagementClient,
} from "@unimatrix/secrets/client";
import type { FastifyInstance } from "fastify";

/**
 * One client per tier, named for the scope its token holds, because that is
 * the question a reader of a call site needs answered: `integrations` cannot
 * touch a `platform/*` name, and `platform` holds a `write` capability that
 * cannot delete anything at all. A single client would make "which token went
 * out on the wire" a fact you had to trace back through configuration.
 */
export interface SecretsManagementClients {
  integrations: SecretsManagementClient;
  platform: SecretsManagementClient;
}

declare module "fastify" {
  interface FastifyInstance {
    secretsManagement: SecretsManagementClients;
  }
}

export interface SetupSecretsManagementOptions {
  /**
   * Shared with `setupIntegrationCredentials` — both plugins build a client
   * against the same secrets service, so this repo's test harness only needs
   * one fake `fetch` seam, threaded through `SetupCorePluginsOptions`.
   */
  fetch?: typeof globalThis.fetch;
}

/**
 * Registers `app.secretsManagement`, or logs and returns without decorating
 * when the store is unconfigured or either scoped token is missing — the same
 * no-op shape `setupIntegrationCredentials` uses for a missing
 * `secretsStore`. `secretsAdminModule` reads the same condition (via
 * `app.runtimeConfig.secretsStore`) to decide whether to register at all, so
 * an absent decoration and an absent module are the same fact checked in two
 * places.
 *
 * Both tokens or neither: a console holding only one would render the tier it
 * cannot reach as "this credential is not set", which is the one answer this
 * page must never give.
 *
 * Neither client is ever built with `secretsStore.serviceToken` — see
 * `apps/api/src/config.ts`'s three-way token guard for why the read token and
 * these two must all differ: the store answers a wrong-capability caller with
 * the same 404 it uses for a missing name.
 */
export function setupSecretsManagement(
  app: FastifyInstance,
  options: SetupSecretsManagementOptions = {},
): void {
  const { secretsStore } = app.runtimeConfig;

  if (
    secretsStore === null ||
    secretsStore.integrationsManageToken === null ||
    secretsStore.platformWriteToken === null
  ) {
    app.log.info(
      "Secrets management is disabled: SECRETS_BASE_URL/SECRETS_SERVICE_TOKEN/SECRETS_INTEGRATIONS_MANAGE_TOKEN/SECRETS_PLATFORM_WRITE_TOKEN are not fully configured.",
    );
    return;
  }

  // Never both: `createSecretsManagementClient` throws when a fetch
  // implementation and a pin arrive together, and the test seam has to win so
  // a test can run against a plain-HTTP fake.
  const transportOption =
    options.fetch === undefined
      ? secretsStore.caCertificatePem === null
        ? {}
        : { caCertificatePem: secretsStore.caCertificatePem }
      : { fetch: options.fetch };

  app.decorate("secretsManagement", {
    integrations: createSecretsManagementClient({
      baseUrl: secretsStore.baseUrl,
      serviceToken: secretsStore.integrationsManageToken,
      ...transportOption,
    }),
    platform: createSecretsManagementClient({
      baseUrl: secretsStore.baseUrl,
      serviceToken: secretsStore.platformWriteToken,
      ...transportOption,
    }),
  });
}
