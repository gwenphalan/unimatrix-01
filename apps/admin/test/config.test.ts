import { describe, expect, it } from "vitest";

import {
  buildSignInHref,
  loadAdminAppDevProxyConfig,
  loadAdminAppRuntimeConfig,
} from "../src/lib/config.js";

describe("admin app runtime config", () => {
  it("requires a Clerk publishable key", () => {
    expect(() => loadAdminAppRuntimeConfig({})).toThrow(/VITE_CLERK_PUBLISHABLE_KEY is required/);

    expect(() => loadAdminAppRuntimeConfig({ VITE_CLERK_PUBLISHABLE_KEY: "   " })).toThrow(
      /VITE_CLERK_PUBLISHABLE_KEY must not be empty/,
    );
  });

  it("loads a valid config with the documented defaults", () => {
    expect(loadAdminAppRuntimeConfig({ VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx" })).toEqual({
      apiBaseUrl: "/api",
      authAppUrl: "https://auth.unimatrix-01.dev",
      clerkPublishableKey: "pk_test_xxx",
    });
  });

  it("accepts absolute and relative api base urls", () => {
    expect(
      loadAdminAppRuntimeConfig({
        VITE_API_BASE_URL: "/api/v2",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }).apiBaseUrl,
    ).toBe("/api/v2");

    expect(
      loadAdminAppRuntimeConfig({
        VITE_API_BASE_URL: "https://api.example.test",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }).apiBaseUrl,
    ).toBe("https://api.example.test");
  });

  it("rejects unsupported api base url values", () => {
    expect(() =>
      loadAdminAppRuntimeConfig({
        VITE_API_BASE_URL: "api",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }),
    ).toThrow(/must be a valid http:\/\/ or https:\/\/ URL/);

    expect(() =>
      loadAdminAppRuntimeConfig({
        VITE_API_BASE_URL: "//example.test",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }),
    ).toThrow(
      /site-relative path beginning with a single \/ or a valid http:\/\/ or https:\/\/ URL/,
    );
  });

  it("accepts an overridden auth app url", () => {
    expect(
      loadAdminAppRuntimeConfig({
        VITE_AUTH_APP_URL: "http://localhost:5175",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }).authAppUrl,
    ).toBe("http://localhost:5175");
  });

  it("rejects an auth app url that is not an absolute http(s) URL", () => {
    // A site-relative value is the plausible mistake here, and it is exactly
    // the one that must not pass: `auth.` is a different origin, so a relative
    // sign-in href would point back into the admin app and dead-end.
    expect(() =>
      loadAdminAppRuntimeConfig({
        VITE_AUTH_APP_URL: "/sign-in",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }),
    ).toThrow(/VITE_AUTH_APP_URL must be a valid http:\/\/ or https:\/\/ URL/);

    expect(() =>
      loadAdminAppRuntimeConfig({
        VITE_AUTH_APP_URL: "javascript:alert(1)",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }),
    ).toThrow(/VITE_AUTH_APP_URL must be a valid http:\/\/ or https:\/\/ URL/);

    expect(() =>
      loadAdminAppRuntimeConfig({
        VITE_AUTH_APP_URL: "  ",
        VITE_CLERK_PUBLISHABLE_KEY: "pk_test_xxx",
      }),
    ).toThrow(/VITE_AUTH_APP_URL must not be empty when it is set/);
  });

  it("uses the documented default proxy target", () => {
    expect(loadAdminAppDevProxyConfig({})).toEqual({
      apiProxyTarget: "http://127.0.0.1:3001",
    });
  });

  it("rejects invalid proxy targets", () => {
    expect(() => loadAdminAppDevProxyConfig({ VITE_API_TARGET: "ws://127.0.0.1:3001" })).toThrow(
      /VITE_API_TARGET must be a valid http:\/\/ or https:\/\/ URL/,
    );
  });
});

describe("buildSignInHref", () => {
  it("percent-encodes the return address", () => {
    expect(
      buildSignInHref("https://auth.unimatrix-01.dev", "https://admin.unimatrix-01.dev/?a=1&b=2"),
    ).toBe(
      "https://auth.unimatrix-01.dev/sign-in?redirect_url=https%3A%2F%2Fadmin.unimatrix-01.dev%2F%3Fa%3D1%26b%3D2",
    );
  });
});
