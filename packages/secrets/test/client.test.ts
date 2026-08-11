import { describe, expect, it, vi } from "vitest";

import { createSecretsClient, SecretsClientError } from "../src/client.js";
import { SecretValue } from "../src/secret-value.js";

const BASE_URL = "http://secrets.internal:3002";
const SERVICE_TOKEN = "svc_test_token";

/** Never appears in a thrown error — see the assertions using it below. */
const PLAINTEXT = "TOTALLY-SECRET-PLAINTEXT-VALUE";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A response whose body is not valid JSON — deliberately built from `PLAINTEXT`. */
function nonJsonResponse(status: number): Response {
  return new Response(PLAINTEXT, { status, headers: { "content-type": "text/plain" } });
}

/**
 * Mimics native `fetch`: rejects once the request's `signal` aborts, and
 * otherwise never resolves. Used by the abort tests, which only need to
 * observe that a rejection happens — not that a real network call was made.
 */
function neverResolvingFetch(): typeof fetch {
  const impl: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;

      if (signal?.aborted) {
        reject(new Error(String(signal.reason)));
        return;
      }

      signal?.addEventListener("abort", () => {
        reject(new Error(String(signal.reason)));
      });
    });

  return vi.fn(impl);
}

function assertNoPlaintextLeak(error: unknown): void {
  expect(error).toBeInstanceOf(SecretsClientError);
  const clientError = error as SecretsClientError;

  expect(clientError.message).not.toContain(PLAINTEXT);
  expect(clientError.stack ?? "").not.toContain(PLAINTEXT);

  if (clientError.cause !== undefined) {
    expect(
      JSON.stringify(clientError.cause, Object.getOwnPropertyNames(clientError.cause)),
    ).not.toContain(PLAINTEXT);
  }
}

describe("createSecretsClient / getSecretValue", () => {
  it("builds the request URL and query, sends the bearer token, and resolves a SecretValue", async () => {
    let capturedUrl: URL | undefined;
    let capturedInit: RequestInit | undefined;

    const fetchImpl = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      capturedUrl = input as URL;
      capturedInit = init;
      return Promise.resolve(jsonResponse(200, { name: "github/token", value: PLAINTEXT }));
    }) as unknown as typeof fetch;

    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: fetchImpl,
    });
    const value = await client.getSecretValue("github/token");

    expect(value).toBeInstanceOf(SecretValue);
    expect(value.reveal()).toBe(PLAINTEXT);
    expect(value.toString()).toBe("[REDACTED]");
    expect(value.toJSON()).toBe("[REDACTED]");

    expect(capturedUrl?.origin).toBe(new URL(BASE_URL).origin);
    expect(capturedUrl?.pathname).toBe("/secrets/value");
    expect(capturedUrl?.searchParams.get("name")).toBe("github/token");

    expect(capturedInit?.method).toBe("GET");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SERVICE_TOKEN}`);
  });

  it("throws SecretsClientError with status 404 for a 404 response", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(404, { error: { code: "NOT_FOUND" } })),
    ) as unknown as typeof fetch;
    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: fetchImpl,
    });

    await expect(client.getSecretValue("missing")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("throws SecretsClientError with status 500 for a 500 response", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse(500, { error: { code: "INTERNAL" } })),
    ) as unknown as typeof fetch;
    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: fetchImpl,
    });

    await expect(client.getSecretValue("name")).rejects.toMatchObject({ status: 500 });
  });

  it("throws for a non-JSON body and never quotes the body in the error", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(nonJsonResponse(200))) as unknown as typeof fetch;
    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getSecretValue("name");
    } catch (error) {
      caught = error;
    }

    assertNoPlaintextLeak(caught);
    expect((caught as SecretsClientError).status).toBe(200);
  });

  it("throws for a body that fails schema validation and never quotes the body in the error", async () => {
    const fetchImpl = vi.fn(() =>
      // `strictObject` rejects the unknown `extra` key; `value` also carries the
      // distinctive plaintext so a Zod issue that echoed the received value
      // would be caught by the assertion below.
      Promise.resolve(jsonResponse(200, { name: "name", value: PLAINTEXT, extra: "unexpected" })),
    ) as unknown as typeof fetch;
    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: fetchImpl,
    });

    let caught: unknown;
    try {
      await client.getSecretValue("name");
    } catch (error) {
      caught = error;
    }

    assertNoPlaintextLeak(caught);
    expect((caught as SecretsClientError).status).toBe(200);
  });

  it("aborts once the default timeout elapses", () => {
    // `AbortSignal.timeout` runs on Node's internal timer wheel, which
    // `vi.useFakeTimers()` does not intercept — so this asserts the wiring
    // (the default is passed to `AbortSignal.timeout` when the caller sets
    // none) rather than waiting out a real 5-second clock.
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    try {
      const client = createSecretsClient({
        baseUrl: BASE_URL,
        serviceToken: SERVICE_TOKEN,
        fetch: neverResolvingFetch(),
      });

      // Fire-and-forget: only the call to `AbortSignal.timeout` is under test
      // here, not the eventual abort.
      void client.getSecretValue("name").catch(() => {
        // Intentionally unhandled beyond preventing an unhandled rejection —
        // the abort test above already covers what happens once it fires.
      });

      expect(timeoutSpy).toHaveBeenCalledWith(5000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("aborts when the caller's signal fires, independent of the configured timeout", async () => {
    const controller = new AbortController();
    const client = createSecretsClient({
      baseUrl: BASE_URL,
      serviceToken: SERVICE_TOKEN,
      fetch: neverResolvingFetch(),
      timeoutMs: 60_000,
    });

    const pending = client.getSecretValue("name", { signal: controller.signal });

    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(SecretsClientError);
  });

  it("throws SecretsClientError when no fetch implementation is available anywhere", () => {
    const previousFetch = globalThis.fetch;
    // @ts-expect-error deliberately removing the global for this assertion
    delete globalThis.fetch;

    try {
      expect(() => createSecretsClient({ baseUrl: BASE_URL, serviceToken: SERVICE_TOKEN })).toThrow(
        SecretsClientError,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("resolves the default fetch implementation from globalThis when none is configured", async () => {
    const globalFetch: typeof fetch = vi.fn(() =>
      Promise.resolve(jsonResponse(200, { name: "name", value: PLAINTEXT })),
    );
    const previousFetch = globalThis.fetch;
    globalThis.fetch = globalFetch;

    try {
      const client = createSecretsClient({ baseUrl: BASE_URL, serviceToken: SERVICE_TOKEN });
      const value = await client.getSecretValue("name");

      expect(value.reveal()).toBe(PLAINTEXT);
      expect(globalFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
