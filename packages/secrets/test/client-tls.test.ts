import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSecretsClient, SecretsClientError } from "../src/client.js";

/**
 * Proves the pin fails closed against a live TLS listener, which is the whole
 * reason `caCertificatePem` exists — a unit test with a fake `fetch` would
 * assert the option was passed along and nothing about whether it is enforced.
 *
 * The certificates are generated per run rather than committed: a checked-in
 * private key is a finding for every secret scanner that reads this repo, and
 * one that never expires is worse. `openssl` is required rather than skipped
 * when missing, so a machine without it reports a gap instead of a pass.
 */
const CERTIFICATE_VALIDITY_DAYS = "1";
/** Matches the certificate's SAN, so hostname verification has something to succeed against. */
const SERVER_HOSTNAME = "localhost";

interface KeyPair {
  certificatePem: string;
  keyPem: string;
}

let workingDirectory: string;
let server: Server;
let serverKeyPair: KeyPair;
let otherKeyPair: KeyPair;
let baseUrl: string;

function generateSelfSignedCertificate(directory: string, name: string): KeyPair {
  const keyPath = join(directory, `${name}-key.pem`);
  const certificatePath = join(directory, `${name}-cert.pem`);

  // stderr piped rather than inherited: openssl narrates key generation with
  // several hundred progress characters, and a failure still reaches the
  // thrown error's `stderr`.
  const opensslArguments = [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-days",
    CERTIFICATE_VALIDITY_DAYS,
    "-subj",
    `/CN=${SERVER_HOSTNAME}`,
    "-addext",
    `subjectAltName=DNS:${SERVER_HOSTNAME}`,
  ];

  execFileSync("openssl", opensslArguments, { stdio: ["ignore", "ignore", "pipe"] });

  return {
    keyPem: readFileSync(keyPath, "utf8"),
    certificatePem: readFileSync(certificatePath, "utf8"),
  };
}

beforeAll(async () => {
  workingDirectory = mkdtempSync(join(tmpdir(), "secrets-client-tls-"));
  serverKeyPair = generateSelfSignedCertificate(workingDirectory, "server");
  otherKeyPair = generateSelfSignedCertificate(workingDirectory, "other");

  server = createServer(
    { cert: serverKeyPair.certificatePem, key: serverKeyPair.keyPem },
    (_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ name: "integrations/example", value: "pinned-plaintext" }));
    },
  );

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  baseUrl = `https://${SERVER_HOSTNAME}:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  rmSync(workingDirectory, { recursive: true, force: true });
});

describe("createSecretsClient with caCertificatePem", () => {
  it("rejects a self-signed certificate with no pin", async () => {
    const client = createSecretsClient({ baseUrl, serviceToken: "svc_test" });

    await expect(client.getSecretValue("integrations/example")).rejects.toBeInstanceOf(
      SecretsClientError,
    );
  });

  it("accepts the pinned certificate", async () => {
    const client = createSecretsClient({
      baseUrl,
      serviceToken: "svc_test",
      caCertificatePem: serverKeyPair.certificatePem,
    });

    const value = await client.getSecretValue("integrations/example");

    expect(value.reveal()).toBe("pinned-plaintext");
  });

  it("rejects a different certificate — the pin replaces the trust store, it does not widen it", async () => {
    const client = createSecretsClient({
      baseUrl,
      serviceToken: "svc_test",
      caCertificatePem: otherKeyPair.certificatePem,
    });

    await expect(client.getSecretValue("integrations/example")).rejects.toBeInstanceOf(
      SecretsClientError,
    );
  });

  it("throws at factory time when both a fetch implementation and a pin are supplied", () => {
    expect(() =>
      createSecretsClient({
        baseUrl,
        serviceToken: "svc_test",
        caCertificatePem: serverKeyPair.certificatePem,
        fetch: globalThis.fetch,
      }),
    ).toThrow(/not both/u);
  });
});
