import {
  createSecretContract,
  deleteSecretsContract,
  getSecretQuerySchema,
  getSecretValueContract,
  listSecretsContract,
  rotateSecretContract,
  type ApiContract,
  type ApiContractResponse,
  type BulkResult,
  type CreateSecretBody,
  type DeleteSecretsBody,
  type ListSecretsResponse,
  type RotateSecretBody,
  type SecretMetadata,
} from "@unimatrix/shared";

import { SecretValue } from "./secret-value.js";

/** 5 seconds. See {@link SecretsClientConfig.timeoutMs} for why this is one shared knob. */
const DEFAULT_TIMEOUT_MS = 5000;

export interface SecretsClientConfig {
  /** Origin of the secrets service, e.g. `http://secrets:3002`. */
  baseUrl: string;
  serviceToken: string;
  fetch?: typeof globalThis.fetch;
  /** Milliseconds before a request is aborted. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface GetSecretValueOptions {
  /**
   * Aborts the request when it fires, independent of the timeout — whichever
   * of the two fires first wins (`AbortSignal.any`).
   */
  signal?: AbortSignal;
}

export interface SecretsClient {
  getSecretValue(name: string, options?: GetSecretValueOptions): Promise<SecretValue>;
}

export interface SecretsClientErrorOptions {
  status: number | null;
  cause?: unknown;
}

/**
 * Thrown for every failure either factory in this file can produce — both
 * `createSecretsClient` and `createSecretsManagementClient` — a non-2xx
 * response, a non-JSON body, and a body that fails to parse against the
 * relevant contract's `responseSchema`. `status` is `null` when no HTTP
 * response was ever received (a network failure or an abort).
 *
 * `getSecretValueContract`'s 200 body is the plaintext credential
 * (`secretValueResponseSchema.value`), and the management contracts' bodies
 * carry `secretMetadataSchema.maskedPrefix` — the literal first four code
 * points of that same plaintext (`mask()` in `./secret-value.ts`). Either
 * way, `message` and every other property on this error — including
 * `cause` — must never carry any part of a response body. A "failed to
 * parse" error that quotes the payload would put a secret fragment in a log
 * line the moment this error is logged. `test/client.test.ts` asserts this
 * for every throwing branch of every method on both clients, including the
 * ones whose native failure (a `JSON.parse` `SyntaxError`, a Zod issue)
 * would otherwise quote a body fragment — which is why those branches build
 * their own message rather than forwarding the native error's.
 */
export class SecretsClientError extends Error {
  readonly status: number | null;

  constructor(message: string, options: SecretsClientErrorOptions) {
    super(message);
    this.name = "SecretsClientError";
    this.status = options.status;

    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}

function resolveFetch(fetchImpl: typeof globalThis.fetch | undefined): typeof globalThis.fetch {
  if (fetchImpl) {
    return fetchImpl;
  }

  if (!globalThis.fetch) {
    throw new SecretsClientError("No fetch implementation is available for the secrets client.", {
      status: null,
    });
  }

  return globalThis.fetch.bind(globalThis);
}

function buildRequestUrl(baseUrl: string, name: string): URL {
  const query = getSecretQuerySchema.parse({ name });
  const url = new URL(getSecretValueContract.path, baseUrl);

  url.searchParams.set("name", query.name);

  return url;
}

/**
 * One shared deadline, combined with the caller's own signal when given.
 * `AbortSignal.any` aborts as soon as either input does, so passing a signal
 * never widens the timeout.
 */
function buildAbortSignal(timeoutMs: number, callerSignal: AbortSignal | undefined): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  if (callerSignal === undefined) {
    return timeoutSignal;
  }

  return AbortSignal.any([timeoutSignal, callerSignal]);
}

export interface SecretsManagementRequestOptions {
  /**
   * Aborts the request when it fires, independent of the timeout — whichever
   * of the two fires first wins (`AbortSignal.any`).
   */
  signal?: AbortSignal;
}

/**
 * The store's write surface: create, rotate, list metadata and bulk-delete by
 * name. A `write`-capability token reaches everything here except
 * `deleteSecrets`, which needs `manage` — the store answers the difference
 * with the same 404 it uses for a missing name, so the caller decides which
 * methods it may use by which token it hands this factory.
 *
 * Deliberately has **no `getSecretValue`** — that stays
 * on {@link SecretsClient}, which authenticates with a `read`-capability
 * token instead. This split is the type-level expression of the store's own
 * capability asymmetry (`apps/secrets/src/service-tokens/capability.ts`):
 * nothing holding only a manage token can compile a call to the one method
 * that returns a decrypted value, so "no plaintext reaches a manage-token
 * caller" is a property `tsc` checks rather than one review has to.
 */
export interface SecretsManagementClient {
  listSecrets(options?: SecretsManagementRequestOptions): Promise<ListSecretsResponse>;
  createSecret(
    body: CreateSecretBody,
    options?: SecretsManagementRequestOptions,
  ): Promise<SecretMetadata>;
  rotateSecret(
    body: RotateSecretBody,
    options?: SecretsManagementRequestOptions,
  ): Promise<SecretMetadata>;
  /**
   * Speaks the store's own bulk contract (`names: string[]`), not a
   * single-name shape — the single-name narrowing for a browser-facing
   * delete lives at `apps/api`'s admin routes, one layer up from this
   * client.
   */
  deleteSecrets(
    body: DeleteSecretsBody,
    options?: SecretsManagementRequestOptions,
  ): Promise<BulkResult>;
}

/**
 * Shared by every `SecretsManagementClient` method. Builds the request,
 * parses the response against `contract.responseSchema`, and — matching
 * {@link SecretsClientError}'s rule — never lets a response-body fragment
 * reach a thrown error's `message` or `cause`. That rule binds here even
 * though these are metadata responses, not `getSecretValueContract`'s
 * plaintext one: `secretMetadataSchema.maskedPrefix` is the literal first
 * four code points of the plaintext (`mask()` in `./secret-value.ts`), so a
 * Zod error quoting a malformed metadata body would still put a fragment of
 * a credential in a log line.
 */
async function performManagementRequest<TContract extends ApiContract, TBody = undefined>(config: {
  baseUrl: string;
  contract: TContract;
  fetchImpl: typeof globalThis.fetch;
  body?: TBody;
  signal: AbortSignal;
  token: string;
}): Promise<ApiContractResponse<TContract>> {
  const { baseUrl, contract, fetchImpl, body, signal, token } = config;
  const url = new URL(contract.path, baseUrl);
  const hasBody = body !== undefined;

  let response: Response;

  try {
    response = await fetchImpl(url, {
      method: contract.method,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(body) } : {}),
      signal,
    });
  } catch (error) {
    // A network failure or an abort. Neither carries a response body, so
    // the native error is safe to forward as `cause`.
    throw new SecretsClientError(
      `${contract.method} ${contract.path} could not be completed (network failure or abort).`,
      { status: null, cause: error },
    );
  }

  if (!response.ok) {
    throw new SecretsClientError(
      `${contract.method} ${contract.path} failed with status ${response.status}.`,
      {
        status: response.status,
      },
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    // No `cause`: `JSON.parse`'s `SyntaxError` can quote a fragment of the
    // malformed body — see `SecretsClientError`'s docstring.
    throw new SecretsClientError(
      `${contract.method} ${contract.path} returned a non-JSON response.`,
      {
        status: response.status,
      },
    );
  }

  const parsed = contract.responseSchema.safeParse(payload);

  if (!parsed.success) {
    // No `cause` and no `parsed.error` on the message: a Zod issue can quote
    // the received value, which here is (or contains) response metadata
    // derived from a plaintext credential (`maskedPrefix`).
    throw new SecretsClientError(
      `${contract.method} ${contract.path} returned a response that did not match the expected shape.`,
      { status: response.status },
    );
  }

  return parsed.data as ApiContractResponse<TContract>;
}

/**
 * Config shape reused from {@link SecretsClientConfig}: `serviceToken` here
 * is whichever token the caller authenticates with, which for this client
 * must carry `write` or `manage` — see the three-way token guard in
 * `apps/api/src/config.ts` for what happens when it is a read token instead.
 */
export function createSecretsManagementClient(
  config: SecretsClientConfig,
): SecretsManagementClient {
  const fetchImpl = resolveFetch(config.fetch);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    listSecrets: (options = {}) =>
      performManagementRequest({
        baseUrl: config.baseUrl,
        contract: listSecretsContract,
        fetchImpl,
        signal: buildAbortSignal(timeoutMs, options.signal),
        token: config.serviceToken,
      }),
    createSecret: (body, options = {}) =>
      performManagementRequest({
        baseUrl: config.baseUrl,
        contract: createSecretContract,
        fetchImpl,
        body,
        signal: buildAbortSignal(timeoutMs, options.signal),
        token: config.serviceToken,
      }),
    rotateSecret: (body, options = {}) =>
      performManagementRequest({
        baseUrl: config.baseUrl,
        contract: rotateSecretContract,
        fetchImpl,
        body,
        signal: buildAbortSignal(timeoutMs, options.signal),
        token: config.serviceToken,
      }),
    deleteSecrets: (body, options = {}) =>
      performManagementRequest({
        baseUrl: config.baseUrl,
        contract: deleteSecretsContract,
        fetchImpl,
        body,
        signal: buildAbortSignal(timeoutMs, options.signal),
        token: config.serviceToken,
      }),
  };
}

export function createSecretsClient(config: SecretsClientConfig): SecretsClient {
  const fetchImpl = resolveFetch(config.fetch);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async getSecretValue(name, options = {}) {
      const url = buildRequestUrl(config.baseUrl, name);
      const signal = buildAbortSignal(timeoutMs, options.signal);

      let response: Response;

      try {
        response = await fetchImpl(url, {
          method: getSecretValueContract.method,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${config.serviceToken}`,
          },
          signal,
        });
      } catch (error) {
        // A network failure or an abort. Neither carries a response body, so
        // the native error is safe to forward as `cause`.
        throw new SecretsClientError(
          `${getSecretValueContract.method} ${getSecretValueContract.path} could not be completed (network failure or abort).`,
          { status: null, cause: error },
        );
      }

      if (!response.ok) {
        throw new SecretsClientError(
          `${getSecretValueContract.method} ${getSecretValueContract.path} failed with status ${response.status}.`,
          { status: response.status },
        );
      }

      let payload: unknown;

      try {
        payload = await response.json();
      } catch {
        // No `cause`: `JSON.parse`'s `SyntaxError` can quote a fragment of the
        // malformed body — see the class docstring.
        throw new SecretsClientError(
          `${getSecretValueContract.method} ${getSecretValueContract.path} returned a non-JSON response.`,
          { status: response.status },
        );
      }

      const parsed = getSecretValueContract.responseSchema.safeParse(payload);

      if (!parsed.success) {
        // No `cause` and no `parsed.error` on the message: a Zod issue can
        // quote the received value, which here is (or contains) the
        // plaintext credential.
        throw new SecretsClientError(
          `${getSecretValueContract.method} ${getSecretValueContract.path} returned a response that did not match the expected shape.`,
          { status: response.status },
        );
      }

      return new SecretValue(parsed.data.value);
    },
  };
}
