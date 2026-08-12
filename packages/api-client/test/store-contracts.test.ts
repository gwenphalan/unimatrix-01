import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const CLIENT_SOURCE_PATH = fileURLToPath(new URL("../src/client.ts", import.meta.url));

/**
 * `contracts/secrets.ts` targets `apps/secrets` directly and warns in its own
 * header that its contracts are not for this package — a client method built
 * from one of those paths would send the request to the wrong service, since
 * `request()` joins every contract's path onto this client's single
 * `baseUrl`. Nothing in the type system stops an import from that file, so
 * this test reads the source directly rather than trusting the barrel.
 */
describe("store-path contracts", () => {
  it("are never referenced from the api-client source", () => {
    const source = readFileSync(CLIENT_SOURCE_PATH, "utf-8");

    for (const storeContractName of [
      "getSecretValueContract",
      "listSecretsContract",
      "createSecretContract",
      "rotateSecretContract",
      "deleteSecretsContract",
    ]) {
      expect(source).not.toContain(storeContractName);
    }
  });
});
