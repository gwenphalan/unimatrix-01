import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  DEFAULT_API_BASE_URL,
  DEFAULT_API_PROXY_TARGET,
  apiBaseUrl,
  loadDevProxyConfig,
  optionalEnvString,
  optionalEnvStringWithoutFallback,
  optionalHttpUrl,
  parseAppEnv,
  requiredEnvString,
} from "../src/index.js";

function parseField<Output>(schema: z.ZodType<Output>, value: string | undefined): Output {
  return parseAppEnv("test app", z.object({ FIELD: schema }), { FIELD: value }).FIELD;
}

describe("requiredEnvString", () => {
  const schema = requiredEnvString("VITE_CLERK_PUBLISHABLE_KEY");

  it("trims and returns a set value", () => {
    expect(parseField(schema, "  pk_test_xxx  ")).toBe("pk_test_xxx");
  });

  it("rejects an unset value with the variable name in the message", () => {
    expect(() => parseField(schema, undefined)).toThrow(
      "Invalid test app configuration: VITE_CLERK_PUBLISHABLE_KEY is required and was not set.",
    );
  });

  it("rejects a blank value", () => {
    expect(() => parseField(schema, "   ")).toThrow(
      "Invalid test app configuration: VITE_CLERK_PUBLISHABLE_KEY must not be empty.",
    );
  });
});

describe("optionalEnvString", () => {
  const schema = optionalEnvString("VITE_AUTH_APP_URL", "https://fallback.example");

  it("returns the fallback when unset", () => {
    expect(parseField(schema, undefined)).toBe("https://fallback.example");
  });

  it("rejects a blank value instead of silently using the fallback", () => {
    expect(() => parseField(schema, " ")).toThrow(
      "Invalid test app configuration: VITE_AUTH_APP_URL must not be empty when it is set.",
    );
  });

  it("trims a set value", () => {
    expect(parseField(schema, " https://set.example ")).toBe("https://set.example");
  });
});

describe("optionalEnvStringWithoutFallback", () => {
  const schema = optionalEnvStringWithoutFallback("VITE_CLERK_PUBLISHABLE_KEY");

  it("stays undefined when unset", () => {
    expect(parseField(schema, undefined)).toBeUndefined();
  });

  it("still rejects a blank value", () => {
    expect(() => parseField(schema, "")).toThrow(
      "Invalid test app configuration: VITE_CLERK_PUBLISHABLE_KEY must not be empty when it is set.",
    );
  });
});

describe("optionalHttpUrl", () => {
  const schema = optionalHttpUrl("VITE_API_TARGET", DEFAULT_API_PROXY_TARGET);

  it("accepts http and https URLs", () => {
    expect(parseField(schema, "http://127.0.0.1:3001")).toBe("http://127.0.0.1:3001");
    expect(parseField(schema, "https://api.example.dev")).toBe("https://api.example.dev");
  });

  it("rejects other protocols and non-URLs, echoing the received value", () => {
    expect(() => parseField(schema, "ftp://files.example")).toThrow(
      'Invalid test app configuration: VITE_API_TARGET must be a valid http:// or https:// URL. Received "ftp://files.example".',
    );
    expect(() => parseField(schema, "not a url")).toThrow(
      /VITE_API_TARGET must be a valid http:\/\/ or https:\/\/ URL/,
    );
  });
});

describe("apiBaseUrl", () => {
  const schema = apiBaseUrl();

  it("defaults to /api", () => {
    expect(parseField(schema, undefined)).toBe(DEFAULT_API_BASE_URL);
  });

  it("accepts a site-relative path", () => {
    expect(parseField(schema, "/backend")).toBe("/backend");
  });

  it("rejects a scheme-relative path", () => {
    expect(() => parseField(schema, "//evil.example/api")).toThrow(
      "Invalid test app configuration: VITE_API_BASE_URL must be a site-relative path beginning with a single / or a valid http:// or https:// URL.",
    );
  });

  it("accepts an absolute http(s) URL", () => {
    expect(parseField(schema, "https://api.unimatrix-01.dev")).toBe("https://api.unimatrix-01.dev");
  });

  it("rejects a bare hostname", () => {
    expect(() => parseField(schema, "api.unimatrix-01.dev")).toThrow(
      /VITE_API_BASE_URL must be a valid http:\/\/ or https:\/\/ URL/,
    );
  });
});

describe("parseAppEnv", () => {
  it("throws only the first issue, prefixed with the app label", () => {
    const schema = z.object({
      VITE_API_BASE_URL: apiBaseUrl(),
      VITE_CLERK_PUBLISHABLE_KEY: requiredEnvString("VITE_CLERK_PUBLISHABLE_KEY"),
    });

    expect(() => parseAppEnv("admin app", schema, { VITE_API_BASE_URL: "//x" })).toThrow(
      /^Invalid admin app configuration: VITE_API_BASE_URL/,
    );
  });
});

describe("loadDevProxyConfig", () => {
  it("defaults to the local API", () => {
    expect(loadDevProxyConfig("web", {})).toEqual({
      apiProxyTarget: DEFAULT_API_PROXY_TARGET,
    });
  });

  it("validates an override", () => {
    expect(() => loadDevProxyConfig("web", { VITE_API_TARGET: "nope" })).toThrow(
      /^Invalid web configuration: VITE_API_TARGET/,
    );
  });
});
