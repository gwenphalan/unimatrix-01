import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createDatabase } from "@unimatrix/db";
import type {
  DeleteResult,
  ListDocumentsResponse,
  ListFilesResponse,
  UserDocument,
  UserFileMetadata,
} from "@unimatrix/shared";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { LightMyRequestResponse } from "fastify";

import { buildApp } from "../src/app.js";
import { loadApiRuntimeConfig, type ApiRuntimeEnv } from "../src/config.js";
import type { ApiErrorEnvelope } from "../src/lib/http/errors.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));

/**
 * The host `pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk` encodes — a
 * publishable key is `pk_test_` plus the base64 of `<frontend-api-host>$`.
 */
const FRONTEND_API_HOST = "example.clerk.accounts.dev";

/**
 * One RSA keypair for the whole file, under one `kid`.
 *
 * `@clerk/backend`'s `loadClerkJwkFromPem` caches the derived JWK under
 * `local-<kid>` in a module-level map with `shouldExpire: false`, so the first
 * key seen for a given `kid` is the only one that will ever be used in this
 * process. A second keypair reusing the same `kid` would silently verify
 * against the first one's public key — which is why the two users below are
 * distinguished by their `sub` claim rather than by separate signing keys.
 *
 * No `publicExponent` override: the PEM-to-JWK slicing this depends on assumes
 * Node's default of 65537.
 */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const SIGNING_KEY_ID = "unimatrix-test-key";

const CLERK_JWT_KEY = publicKey.export({ format: "pem", type: "spki" }).toString();

/**
 * Clerk credentials that verify tokens signed by {@link privateKey} and nothing
 * else.
 *
 * `CLERK_JWT_KEY` is what makes this file possible: it selects networkless
 * verification, so `verifyToken` builds the JWK straight from this PEM and
 * never reaches Clerk's JWKS endpoint. The secret key is only asserted to be a
 * non-empty string on the bearer-token path; nothing dereferences it unless a
 * handler asks the Backend API for something, and none of these do.
 */
const CLERK_ENV: ApiRuntimeEnv = {
  CLERK_SECRET_KEY: "sk_test_dummy",
  CLERK_PUBLISHABLE_KEY: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
  CLERK_JWT_KEY,
};

const USER_ONE = "user_2aaaaaaaaaaaaaaaaaaaaaaaaaaa";
const USER_TWO = "user_2bbbbbbbbbbbbbbbbbbbbbbbbbbb";

const NAMESPACE = "cube-trainer";
const OTHER_NAMESPACE = "other-namespace";

const PNG_KEY = "avatar.png";
const PNG_BYTES = Buffer.from("not really a png, but the bytes are what is compared", "utf8");

const SVG_KEY = "diagram.svg";
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', "utf8");

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mints a Clerk-shaped session JWT for `userId`.
 *
 * The claim set is exactly what `@clerk/backend`'s `verifyJwt` inspects on the
 * bearer-token path: `typ`/`alg`/`kid` in the header, then `sub` — which
 * becomes the auth object's `userId`, and so the storage key every route below
 * partitions on — plus `exp`, `nbf`, and `iat`. `aud` and `azp` go unchecked
 * because `registerClerkAuth` passes no `audience`/`authorizedParties`, and
 * `iss` is consulted only on the cookie path; both are set to realistic values
 * anyway so this token is not quietly narrower than the real thing.
 *
 * `sts` is deliberately absent. `signedIn()` defaults `treatPendingAsSignedOut`
 * to true, so `sts: "pending"` would turn a perfectly valid signature into a
 * signed-*out* auth object.
 */
function signSessionToken(userId: string): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", kid: SIGNING_KEY_ID, typ: "JWT" };
  const payload = {
    azp: "http://localhost",
    exp: issuedAt + 60,
    iat: issuedAt,
    iss: `https://${FRONTEND_API_HOST}`,
    nbf: issuedAt - 5,
    sid: `sess_${userId}`,
    sub: userId,
    // Clerk's current session tokens carry `v: 2`, which switches
    // `__experimental_JWTPayloadToAuthObjectProperties` onto the nested `o`
    // organization claim. There is no `o` here, so every org field resolves to
    // undefined — what an unaffiliated personal session looks like.
    v: 2,
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

function authHeaders(userId: string): Record<string, string> {
  return { authorization: `Bearer ${signSessionToken(userId)}` };
}

interface TestContext {
  app: ReturnType<typeof buildApp>;
  cleanup: () => void;
}

/**
 * Builds an app against a throwaway SQLite file, mirroring
 * `content-routes.test.ts`. The database plugin resolves its path from
 * `DATABASE_URL` during `buildApp()`, so pointing that at a temp directory for
 * the duration of the call keeps these tests off the repository's local
 * database — and gives every test a database of its own.
 */
function createTestApp(envOverrides: Partial<ApiRuntimeEnv> = {}): TestContext {
  const directory = mkdtempSync(join(tmpdir(), "unimatrix-user-data-"));
  const filePath = join(directory, "user-data.sqlite");
  const previousDatabaseUrl = process.env.DATABASE_URL;

  const instance = createDatabase({ filePath });

  migrate(instance.db, { migrationsFolder: MIGRATIONS_FOLDER });
  instance.client.close();

  process.env.DATABASE_URL = filePath;

  const app = buildApp(
    loadApiRuntimeConfig({ LOG_LEVEL: "error", NODE_ENV: "test", ...CLERK_ENV, ...envOverrides }),
  );

  if (previousDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = previousDatabaseUrl;
  }

  return {
    app,
    cleanup: () => {
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

/**
 * Asserts a status code and, on mismatch, reports Clerk's own rejection reason.
 *
 * `signedOut()` wraps its result in `withDebugHeaders()`, which the Fastify
 * plugin copies onto the reply, so a 401 caused by the *token* rather than by
 * the route carries `x-clerk-auth-reason`/`x-clerk-auth-message`. Surfacing
 * those turns "expected 401 to equal 200" into something that names the claim
 * at fault. Their absence on a 2xx is itself a signal: `signedIn()` does not
 * wrap.
 */
function assertStatus(response: LightMyRequestResponse, expected: number, label: string): void {
  const clerkReason = response.headers["x-clerk-auth-reason"];
  const detail =
    clerkReason === undefined
      ? response.payload.slice(0, 400)
      : `clerk reason=${String(clerkReason)} message=${String(response.headers["x-clerk-auth-message"])}`;

  assert.equal(response.statusCode, expected, `${label}: ${detail}`);
}

interface MultipartUpload {
  contentType: string;
  payload: Buffer;
}

/**
 * Encodes a single file part the way a browser would.
 *
 * Built through the platform's own `FormData`/`File`/`Request` rather than by
 * hand, so the boundary, part headers, and CRLF placement come from the same
 * code a real client uses. The part must be a `File` and not a string field:
 * `@fastify/multipart`'s `request.file()` returns the first part carrying a
 * filename, and `file.mimetype` — which decides `inline` versus `attachment`
 * downstream — comes from the part's own type.
 */
async function encodeMultipartUpload(
  fileName: string,
  contentType: string,
  bytes: Buffer,
): Promise<MultipartUpload> {
  const form = new FormData();

  form.set("file", new File([bytes], fileName, { type: contentType }));

  const encoded = new Request("http://localhost/", { body: form, method: "POST" });
  const encodedContentType = encoded.headers.get("content-type");

  assert.ok(encodedContentType !== null, "FormData encoding must produce a boundary");

  return { contentType: encodedContentType, payload: Buffer.from(await encoded.arrayBuffer()) };
}

async function uploadFile(
  app: ReturnType<typeof buildApp>,
  userId: string,
  key: string,
  contentType: string,
  bytes: Buffer,
): Promise<LightMyRequestResponse> {
  const upload = await encodeMultipartUpload(key, contentType, bytes);

  return app.inject({
    method: "POST",
    url: `/me/files?namespace=${NAMESPACE}&key=${key}`,
    headers: { ...authHeaders(userId), "content-type": upload.contentType },
    payload: upload.payload,
  });
}

function putDocument(
  app: ReturnType<typeof buildApp>,
  userId: string,
  key: string,
  value: unknown,
  namespace: string = NAMESPACE,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: "PUT",
    url: "/me/data",
    headers: authHeaders(userId),
    payload: { namespace, key, value },
  });
}

/**
 * The premise the rest of this file rests on: `@clerk/backend` does not parse
 * the PEM, it string-slices it.
 *
 * `loadClerkJwkFromPem` strips the PEM armour, then a hard-coded
 * `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA` prefix and `IDAQAB` suffix,
 * and treats whatever is left as the base64url modulus. That is only correct
 * for a 2048-bit RSA SPKI with exponent 65537 — which is what
 * `generateKeyPairSync` produces above, and what Clerk's dashboard hands out.
 * Were Node's SPKI encoding ever to change, every other test here would fail as
 * an inscrutable 401; this one names the reason instead.
 */
void test("the generated PEM matches the shape @clerk/backend slices a JWK out of", () => {
  const RSA_PREFIX = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA";
  const RSA_SUFFIX = "IDAQAB";

  const body = CLERK_JWT_KEY.replaceAll(/\r\n|\n|\r/gu, "")
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "");

  assert.ok(body.startsWith(RSA_PREFIX), "expected the standard RSA-2048 SPKI prefix");
  assert.ok(body.endsWith(RSA_SUFFIX), "expected the 65537 public exponent suffix");

  const slicedModulus = body
    .slice(RSA_PREFIX.length, body.length - RSA_SUFFIX.length)
    .replaceAll("+", "-")
    .replaceAll("/", "_");

  const { n } = publicKey.export({ format: "jwk" });

  assert.equal(slicedModulus, n, "Clerk's slice must reproduce Node's own JWK modulus");
});

/**
 * The happy path these routes have never had: a request carrying a session
 * Clerk actually verifies. Everything below this point would answer 401 if the
 * token were rejected, so each test doubles as a check that verification is
 * still networkless and still working.
 */
void test("PUT then GET /me/data round-trips the stored value", async () => {
  const { app, cleanup } = createTestApp();

  try {
    const put = await putDocument(app, USER_ONE, "settings", {
      steps: [1, "two", null],
      theme: "dark",
    });

    assertStatus(put, 200, "PUT /me/data");

    const created = put.json<UserDocument>();

    assert.equal(created.namespace, NAMESPACE);
    assert.equal(created.key, "settings");
    assert.deepEqual(created.value, { steps: [1, "two", null], theme: "dark" });
    assert.match(created.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);

    const get = await app.inject({
      method: "GET",
      url: `/me/data?namespace=${NAMESPACE}&key=settings`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(get, 200, "GET /me/data");
    assert.deepEqual(get.json<UserDocument>(), created);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("GET /me/data/list returns the session's documents for one namespace only", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(await putDocument(app, USER_ONE, "settings", { theme: "dark" }), 200, "PUT a");
    assertStatus(await putDocument(app, USER_ONE, "progress", { solved: 12 }), 200, "PUT b");
    assertStatus(
      await putDocument(app, USER_ONE, "elsewhere", { unrelated: true }, OTHER_NAMESPACE),
      200,
      "PUT c",
    );

    const list = await app.inject({
      method: "GET",
      url: `/me/data/list?namespace=${NAMESPACE}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(list, 200, "GET /me/data/list");

    const { documents } = list.json<ListDocumentsResponse>();

    assert.deepEqual(
      documents.map((document) => document.key).sort(),
      ["progress", "settings"],
      "the other namespace's document must not leak into this listing",
    );
    assert.deepEqual(
      documents.find((document) => document.key === "settings")?.value,
      { theme: "dark" },
      "the listing carries values, not just keys",
    );
  } finally {
    await app.close();
    cleanup();
  }
});

void test("DELETE /me/data reports the deletion and the document is then gone", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(await putDocument(app, USER_ONE, "settings", { theme: "dark" }), 200, "PUT");

    const deleted = await app.inject({
      method: "DELETE",
      url: "/me/data",
      headers: authHeaders(USER_ONE),
      payload: { namespace: NAMESPACE, key: "settings" },
    });

    assertStatus(deleted, 200, "DELETE /me/data");
    assert.deepEqual(deleted.json<DeleteResult>(), { deleted: true });

    const get = await app.inject({
      method: "GET",
      url: `/me/data?namespace=${NAMESPACE}&key=settings`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(get, 404, "GET /me/data after delete");
    assert.equal(get.json<ApiErrorEnvelope>().error.code, "NOT_FOUND");

    // A second delete is not an error, it just deleted nothing. Asserted so the
    // `deleted: true` above is known to mean "a row was removed" rather than
    // "the route always says true".
    const repeated = await app.inject({
      method: "DELETE",
      url: "/me/data",
      headers: authHeaders(USER_ONE),
      payload: { namespace: NAMESPACE, key: "settings" },
    });

    assertStatus(repeated, 200, "repeated DELETE /me/data");
    assert.deepEqual(repeated.json<DeleteResult>(), { deleted: false });
  } finally {
    await app.close();
    cleanup();
  }
});

void test("POST /me/files accepts a multipart upload and returns its metadata", async () => {
  const { app, cleanup } = createTestApp();

  try {
    const upload = await uploadFile(app, USER_ONE, PNG_KEY, "image/png", PNG_BYTES);

    assertStatus(upload, 200, "POST /me/files");

    const metadata = upload.json<UserFileMetadata>();

    assert.deepEqual(metadata, {
      namespace: NAMESPACE,
      key: PNG_KEY,
      contentType: "image/png",
      size: PNG_BYTES.length,
      updatedAt: metadata.updatedAt,
    });
    assert.match(metadata.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("GET /me/files lists the uploaded file as metadata without its bytes", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(
      await uploadFile(app, USER_ONE, PNG_KEY, "image/png", PNG_BYTES),
      200,
      "POST /me/files",
    );

    const list = await app.inject({
      method: "GET",
      url: `/me/files?namespace=${NAMESPACE}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(list, 200, "GET /me/files");

    const { files } = list.json<ListFilesResponse>();

    assert.equal(files.length, 1);
    assert.deepEqual(files[0], {
      namespace: NAMESPACE,
      key: PNG_KEY,
      contentType: "image/png",
      size: PNG_BYTES.length,
      updatedAt: files[0]?.updatedAt,
    });
    // `listFilesResponseSchema` is a strict object, so a blob smuggled into the
    // listing would already fail serialization — but the point of the endpoint
    // is that it never loads one, so say it out loud.
    assert.equal("data" in (files[0] ?? {}), false);
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * Both halves of `resolveContentDisposition`, because one upload only tests
 * one of them. The SVG is the case the security comment on the handler exists
 * for: scripted SVG served `inline` from an app origin is stored XSS, so it has
 * to come back as a download even though it is nominally an image.
 */
void test("GET /me/files/content returns the exact bytes with hardened headers", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(await uploadFile(app, USER_ONE, PNG_KEY, "image/png", PNG_BYTES), 200, "POST png");
    assertStatus(
      await uploadFile(app, USER_ONE, SVG_KEY, "image/svg+xml", SVG_BYTES),
      200,
      "POST svg",
    );

    const png = await app.inject({
      method: "GET",
      url: `/me/files/content?namespace=${NAMESPACE}&key=${PNG_KEY}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(png, 200, "GET /me/files/content (png)");
    assert.equal(Buffer.compare(png.rawPayload, PNG_BYTES), 0, "the stored bytes come back intact");
    assert.equal(png.headers["content-type"], "image/png");
    assert.equal(png.headers["x-content-type-options"], "nosniff");
    assert.equal(png.headers["content-disposition"], `inline; filename="${PNG_KEY}"`);

    const svg = await app.inject({
      method: "GET",
      url: `/me/files/content?namespace=${NAMESPACE}&key=${SVG_KEY}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(svg, 200, "GET /me/files/content (svg)");
    assert.equal(Buffer.compare(svg.rawPayload, SVG_BYTES), 0);
    assert.equal(svg.headers["content-type"], "image/svg+xml");
    assert.equal(svg.headers["x-content-type-options"], "nosniff");
    assert.equal(
      svg.headers["content-disposition"],
      `attachment; filename="${SVG_KEY}"`,
      "SVG can carry script, so it must never be served inline",
    );
  } finally {
    await app.close();
    cleanup();
  }
});

void test("DELETE /me/files removes the blob and its content 404s afterwards", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(
      await uploadFile(app, USER_ONE, PNG_KEY, "image/png", PNG_BYTES),
      200,
      "POST /me/files",
    );

    const deleted = await app.inject({
      method: "DELETE",
      url: "/me/files",
      headers: authHeaders(USER_ONE),
      payload: { namespace: NAMESPACE, key: PNG_KEY },
    });

    assertStatus(deleted, 200, "DELETE /me/files");
    assert.deepEqual(deleted.json<DeleteResult>(), { deleted: true });

    const content = await app.inject({
      method: "GET",
      url: `/me/files/content?namespace=${NAMESPACE}&key=${PNG_KEY}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(content, 404, "GET /me/files/content after delete");
    assert.equal(content.json<ApiErrorEnvelope>().error.code, "NOT_FOUND");

    const list = await app.inject({
      method: "GET",
      url: `/me/files?namespace=${NAMESPACE}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(list, 200, "GET /me/files after delete");
    assert.deepEqual(list.json<ListFilesResponse>().files, []);
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * The property that matters most here, and the one a per-route 401 test cannot
 * reach: every route keys on the verified session's `sub`, so one user's data
 * is invisible to another's session even though both are authenticated and both
 * name the same namespace and key.
 *
 * Deliberately one app and one database shared by both sessions — separate
 * databases would make this pass for a reason that has nothing to do with the
 * code under test.
 *
 * The delete assertions come in pairs. `deleteDocument`/`deleteFile` answer
 * `{deleted: false}` for a non-matching user rather than 404, and `false` alone
 * would also be the answer if the row *had* been removed and the flag were
 * wrong — so each attempted cross-user delete is followed by re-reading the
 * owner's data.
 */
void test("one session's data is invisible to another session", async () => {
  const { app, cleanup } = createTestApp();

  try {
    assertStatus(await putDocument(app, USER_ONE, "settings", { theme: "dark" }), 200, "PUT");
    assertStatus(
      await uploadFile(app, USER_ONE, PNG_KEY, "image/png", PNG_BYTES),
      200,
      "POST /me/files",
    );

    const intruder = authHeaders(USER_TWO);

    const readDocument = await app.inject({
      method: "GET",
      url: `/me/data?namespace=${NAMESPACE}&key=settings`,
      headers: intruder,
    });

    assertStatus(readDocument, 404, "second session GET /me/data");
    assert.equal(readDocument.json<ApiErrorEnvelope>().error.code, "NOT_FOUND");

    const listDocuments = await app.inject({
      method: "GET",
      url: `/me/data/list?namespace=${NAMESPACE}`,
      headers: intruder,
    });

    assertStatus(listDocuments, 200, "second session GET /me/data/list");
    assert.deepEqual(listDocuments.json<ListDocumentsResponse>().documents, []);

    const listFiles = await app.inject({
      method: "GET",
      url: `/me/files?namespace=${NAMESPACE}`,
      headers: intruder,
    });

    assertStatus(listFiles, 200, "second session GET /me/files");
    assert.deepEqual(listFiles.json<ListFilesResponse>().files, []);

    const readContent = await app.inject({
      method: "GET",
      url: `/me/files/content?namespace=${NAMESPACE}&key=${PNG_KEY}`,
      headers: intruder,
    });

    assertStatus(readContent, 404, "second session GET /me/files/content");
    assert.equal(readContent.json<ApiErrorEnvelope>().error.code, "NOT_FOUND");

    const deleteDocument = await app.inject({
      method: "DELETE",
      url: "/me/data",
      headers: intruder,
      payload: { namespace: NAMESPACE, key: "settings" },
    });

    assertStatus(deleteDocument, 200, "second session DELETE /me/data");
    assert.deepEqual(deleteDocument.json<DeleteResult>(), { deleted: false });

    const deleteFile = await app.inject({
      method: "DELETE",
      url: "/me/files",
      headers: intruder,
      payload: { namespace: NAMESPACE, key: PNG_KEY },
    });

    assertStatus(deleteFile, 200, "second session DELETE /me/files");
    assert.deepEqual(deleteFile.json<DeleteResult>(), { deleted: false });

    // Writing to the same namespace and key under the second session must
    // create a second, separate row rather than overwrite the first.
    assertStatus(await putDocument(app, USER_TWO, "settings", { theme: "light" }), 200, "PUT two");
    assertStatus(await uploadFile(app, USER_TWO, PNG_KEY, "image/png", SVG_BYTES), 200, "POST two");

    const ownerDocument = await app.inject({
      method: "GET",
      url: `/me/data?namespace=${NAMESPACE}&key=settings`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(ownerDocument, 200, "owner GET /me/data after the second session's writes");
    assert.deepEqual(
      ownerDocument.json<UserDocument>().value,
      { theme: "dark" },
      "the second session must not have deleted or overwritten the first's document",
    );

    const ownerContent = await app.inject({
      method: "GET",
      url: `/me/files/content?namespace=${NAMESPACE}&key=${PNG_KEY}`,
      headers: authHeaders(USER_ONE),
    });

    assertStatus(
      ownerContent,
      200,
      "owner GET /me/files/content after the second session's writes",
    );
    assert.equal(
      Buffer.compare(ownerContent.rawPayload, PNG_BYTES),
      0,
      "the second session must not have deleted or overwritten the first's blob",
    );
  } finally {
    await app.close();
    cleanup();
  }
});

/**
 * A cumulative storage cap small enough to reach in a couple of writes, but
 * comfortably above the framing of the payloads below.
 */
const SMALL_STORAGE_CAP = "400";

void test("PUT /me/data returns 413 QUOTA_EXCEEDED once the cumulative cap is reached", async () => {
  const { app, cleanup } = createTestApp({ MAX_USER_STORAGE_BYTES: SMALL_STORAGE_CAP });

  try {
    assertStatus(await putDocument(app, USER_ONE, "a", "x".repeat(200)), 200, "PUT under cap");

    const overCap = await putDocument(app, USER_ONE, "b", "x".repeat(300));

    assert.equal(overCap.statusCode, 413);

    const body: { error: { code: string; message: string; statusCode: number } } = overCap.json();

    // The centralized envelope, not an ad-hoc response.
    assert.equal(body.error.code, "QUOTA_EXCEEDED");
    assert.equal(body.error.statusCode, 413);
    assert.match(body.error.message, /Storage quota exceeded/u);

    // The rejected write left nothing behind.
    const get = await app.inject({
      method: "GET",
      url: `/me/data?namespace=${NAMESPACE}&key=b`,
      headers: authHeaders(USER_ONE),
    });

    assert.equal(get.statusCode, 404);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("the cumulative cap counts uploaded files alongside documents", async () => {
  const { app, cleanup } = createTestApp({ MAX_USER_STORAGE_BYTES: SMALL_STORAGE_CAP });

  try {
    assertStatus(await putDocument(app, USER_ONE, "a", "x".repeat(300)), 200, "PUT under cap");

    const boundary = "----unimatrixtest";
    const fileBytes = "y".repeat(200);
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="blob.bin"',
      "Content-Type: application/octet-stream",
      "",
      fileBytes,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const upload = await app.inject({
      method: "POST",
      url: `/me/files?namespace=${NAMESPACE}&key=blob.bin`,
      headers: {
        ...authHeaders(USER_ONE),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    assert.equal(upload.statusCode, 413);
    assert.equal(upload.json<{ error: { code: string } }>().error.code, "QUOTA_EXCEEDED");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("the cumulative cap is per user, not global", async () => {
  const { app, cleanup } = createTestApp({ MAX_USER_STORAGE_BYTES: SMALL_STORAGE_CAP });

  try {
    assertStatus(await putDocument(app, USER_ONE, "a", "x".repeat(300)), 200, "user one");
    assertStatus(await putDocument(app, USER_TWO, "a", "x".repeat(300)), 200, "user two");
  } finally {
    await app.close();
    cleanup();
  }
});

void test("PUT /me/data carries its own per-route rate limit below the global ceiling", async () => {
  const { app, cleanup } = createTestApp();

  try {
    // `inject` presents every request as one IP, so this is the whole window.
    // 60 writes are allowed; the 61st is refused. That is well under the
    // global 300/min, so a 429 here can only come from the per-route limiter
    // this change added.
    let last = await putDocument(app, USER_ONE, "settings", { theme: "dark" });

    for (let sent = 1; sent < 60; sent += 1) {
      last = await putDocument(app, USER_ONE, "settings", { theme: "dark" });
    }

    assertStatus(last, 200, "the 60th write");

    const refused = await putDocument(app, USER_ONE, "settings", { theme: "dark" });

    assert.equal(refused.statusCode, 429);

    const body: { error: { code: string; statusCode: number } } = refused.json();

    assert.equal(body.error.code, "RATE_LIMITED");
    assert.equal(body.error.statusCode, 429);
  } finally {
    await app.close();
    cleanup();
  }
});

void test("an over-cap document value is refused by the schema before it reaches the store", async () => {
  const { app, cleanup } = createTestApp();

  try {
    const response = await putDocument(app, USER_ONE, "big", { v: "x".repeat(300_000) });

    assert.equal(response.statusCode, 400);
    assert.equal(response.json<{ error: { code: string } }>().error.code, "VALIDATION_ERROR");
  } finally {
    await app.close();
    cleanup();
  }
});
