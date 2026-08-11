import { getSecretQuerySchema, getSecretValueContract } from "@unimatrix/shared";

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
 * Thrown for every failure this client can produce: a non-2xx response, a
 * non-JSON body, and a body that fails to parse against
 * `getSecretValueContract.responseSchema`. `status` is `null` when no HTTP
 * response was ever received (a network failure or an abort).
 *
 * The 200 response body for this route is the plaintext credential
 * (`secretValueResponseSchema.value`), so `message` and every other property
 * on this error — including `cause` — must never carry any part of a
 * response body. A "failed to parse" error that quotes the payload would put
 * a secret in a log line the moment this error is logged. `test/client.test.ts`
 * asserts this for every throwing branch, including the ones whose native
 * failure (a `JSON.parse` `SyntaxError`, a Zod issue) would otherwise quote a
 * body fragment — which is why those branches build their own message rather
 * than forwarding the native error's.
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
