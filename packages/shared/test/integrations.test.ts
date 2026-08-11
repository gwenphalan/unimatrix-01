import { describe, expect, it } from "vitest";

import {
  refreshIntegrationCredentialsContract,
  refreshIntegrationCredentialsResponseSchema,
} from "../src/index.js";

describe("refreshIntegrationCredentialsResponseSchema", () => {
  it("accepts a response naming loaded, denied and failed secrets", () => {
    expect(
      refreshIntegrationCredentialsResponseSchema.parse({
        loaded: ["github/token"],
        denied: ["discord/webhook"],
        failed: [],
      }),
    ).toEqual({
      loaded: ["github/token"],
      denied: ["discord/webhook"],
      failed: [],
    });
  });

  it("rejects a malformed name", () => {
    expect(
      refreshIntegrationCredentialsResponseSchema.safeParse({
        loaded: ["Not A Valid Name"],
        denied: [],
        failed: [],
      }).success,
    ).toBe(false);
  });

  it("rejects an unexpected top-level key — this shape never carries a value or a masked prefix", () => {
    expect(
      refreshIntegrationCredentialsResponseSchema.safeParse({
        loaded: [],
        denied: [],
        failed: [],
        value: "not allowed",
      }).success,
    ).toBe(false);
  });
});

describe("refreshIntegrationCredentialsContract", () => {
  it("is a body-less, query-less POST to the api service", () => {
    expect(refreshIntegrationCredentialsContract).toMatchObject({
      method: "POST",
      path: "/integrations/admin/credentials/refresh",
    });
    expect(refreshIntegrationCredentialsContract.responseSchema).toBe(
      refreshIntegrationCredentialsResponseSchema,
    );
    expect(refreshIntegrationCredentialsContract.bodySchema).toBeUndefined();
    expect(refreshIntegrationCredentialsContract.querySchema).toBeUndefined();
  });
});
