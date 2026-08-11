import {
  createSecretsManagementClient,
  type SecretsManagementClient,
} from "@unimatrix/secrets/client";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    secretsManagement: SecretsManagementClient;
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
 * when the store is unconfigured or carries no manage token — the same
 * no-op shape `setupIntegrationCredentials` uses for a missing
 * `secretsStore`. `secretsAdminModule` reads this decoration's presence
 * (via `app.runtimeConfig.secretsStore`) to decide whether to register at
 * all, so an absent decoration and an absent module are the same fact
 * checked in two places.
 *
 * Always built with `secretsStore.manageToken`, never `.serviceToken` — see
 * `apps/api/src/config.ts`'s `SECRETS_MANAGE_TOKEN` guard for why the two
 * must never be interchangeable: the store answers a wrong-capability
 * caller with the same 404 it uses for a missing name.
 */
export function setupSecretsManagement(
  app: FastifyInstance,
  options: SetupSecretsManagementOptions = {},
): void {
  const { secretsStore } = app.runtimeConfig;

  if (secretsStore === null || secretsStore.manageToken === null) {
    app.log.info(
      "Secrets management is disabled: SECRETS_BASE_URL/SECRETS_SERVICE_TOKEN/SECRETS_MANAGE_TOKEN are not fully configured.",
    );
    return;
  }

  const client = createSecretsManagementClient({
    baseUrl: secretsStore.baseUrl,
    serviceToken: secretsStore.manageToken,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });

  app.decorate("secretsManagement", client);
}
