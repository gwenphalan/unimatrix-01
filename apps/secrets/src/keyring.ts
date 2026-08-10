import {
  loadSecretsKeyring,
  SecretsError,
  SecretValue,
  type SecretContext,
  type SecretsErrorCode,
  type SecretsKeyring,
} from "@unimatrix/secrets";

import type { SecretsRuntimeConfigBase, SecretsRuntimeEnv } from "./config.js";

// Re-exported so the CLIs under `src/cli/` never need their own
// `@unimatrix/secrets` import — this file is the one place under `src/`
// allowed to have one (see `apps/secrets/AGENTS.md` §2).
export { SecretsError };
export type { SecretContext, SecretsErrorCode, SecretsKeyring };

/**
 * The full runtime config, `SecretsRuntimeConfigBase` plus the loaded keyring — never the raw
 * `SECRETS_KEKS` string. `SecretsKeyring` redacts itself on `toString`/`toJSON`/inspect
 * (`@unimatrix/secrets`); a raw string field here would be one `JSON.stringify(config)` away from a
 * log line. Composed in `src/server.ts` (and by tests) from `loadSecretsRuntimeConfig` plus
 * {@link loadSecretsKeyringFromEnv} — never returned by a single loader, so that `config.ts` can stay
 * free of this module's import. See this file's own doc comment for why that split exists.
 */
export type SecretsRuntimeConfig = SecretsRuntimeConfigBase & { keyring: SecretsKeyring };

/**
 * Split out of `config.ts` because `infra/scripts/validate-deploy-config.mjs` imports that module
 * directly, before anything in the workspace has been built — a `@unimatrix/secrets` import there
 * would resolve through its `dist` export map and fail with `ERR_MODULE_NOT_FOUND` in exactly that
 * probe. This module is never imported by that script, so it is the one place in this service
 * allowed to depend on a workspace package.
 *
 * Fails loud with no KEK — the same fail-loud shape as `loadApiRuntimeConfig` (`apps/api/src/config.ts`)
 * failing loud with no Clerk keys in production. `loadSecretsKeyring` throws its own `SecretsError`
 * (carrying a `SecretsErrorCode`) rather than the generic `Error` `config.ts`'s fields throw; that is
 * deliberate, not an inconsistency — wrapping it would discard a code a caller might want to branch on.
 */
export function loadSecretsKeyringFromEnv(env: SecretsRuntimeEnv = process.env): SecretsKeyring {
  return loadSecretsKeyring(env.SECRETS_KEKS);
}

export interface SealedSecretPlaintext {
  envelope: string;
  maskedPrefix: string;
  kekVersion: number;
}

/**
 * The only place under `src/` that constructs a `SecretValue` from request
 * input — everywhere else in the store and routes passes the sealed
 * envelope and masked prefix this returns, never the plaintext itself.
 */
export function sealSecretPlaintext(
  keyring: SecretsKeyring,
  context: SecretContext,
  plaintext: string,
): SealedSecretPlaintext {
  const value = new SecretValue(plaintext);

  return {
    envelope: keyring.seal({ context, value }),
    maskedPrefix: value.mask(),
    kekVersion: keyring.activeVersion,
  };
}

/** Unwraps the `SecretValue` `SecretsKeyring#open` returns to the plaintext string the read route sends. */
export function openSecretPlaintext(
  keyring: SecretsKeyring,
  context: SecretContext,
  envelope: string,
): string {
  return keyring.open({ context, envelope }).reveal();
}

/**
 * Opens `envelope` under whichever KEK version sealed it and immediately reseals the same
 * `SecretValue` under the keyring's active version — `kek rotate`'s one cryptographic step. Never
 * calls `.reveal()`, so a plaintext never exists as a variable in the rotation CLI at all.
 */
export function resealSecretEnvelope(
  keyring: SecretsKeyring,
  context: SecretContext,
  envelope: string,
): { envelope: string; kekVersion: number } {
  const value = keyring.open({ context, envelope });

  return {
    envelope: keyring.seal({ context, value }),
    kekVersion: keyring.activeVersion,
  };
}
