import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { LightMyRequestResponse } from "fastify";

import { buildApp } from "../src/app.js";
import { loadApiRuntimeConfig, type ApiRuntimeEnv } from "../src/config.js";
import type { ApiErrorEnvelope } from "../src/lib/http/errors.js";

const MODULE_SOURCE_PATH = fileURLToPath(
  new URL("../src/modules/user-data/index.ts", import.meta.url),
);

/**
 * Clerk credentials that are structurally valid but belong to nobody.
 *
 * The publishable key uses the real format — `pk_test_` followed by the base64
 * of `<frontend-api-host>$` — because `@clerk/fastify` derives the frontend API
 * URL from it when the plugin registers. None of these reach the network:
 * `jwtKey` selects networkless verification, and every request in this file is
 * unauthenticated, so verification rejects before any Clerk API call could
 * happen.
 */
const DUMMY_CLERK_ENV: ApiRuntimeEnv = {
  CLERK_SECRET_KEY: "sk_test_dummy",
  CLERK_PUBLISHABLE_KEY: "pk_test_ZXhhbXBsZS5jbGVyay5hY2NvdW50cy5kZXYk",
  CLERK_JWT_KEY: "dummy-jwt-key",
};

/**
 * Narrower than Fastify's own `HTTPMethods`, which includes verbs
 * `light-my-request`'s `inject()` does not accept.
 */
type InjectableMethod = "DELETE" | "GET" | "HEAD" | "POST" | "PUT";

interface RouteCase {
  method: InjectableMethod;
  url: string;
  payload?: Record<string, unknown>;
}

/**
 * Every route `userDataModule` registers, each with input its schema accepts.
 *
 * Valid input matters: the contract-driven routes validate before the auth
 * preHandler runs (see the ordering test below), so invalid input would answer
 * 400 and the 401 assertion would pass or fail for the wrong reason.
 */
const USER_DATA_ROUTES: readonly RouteCase[] = [
  { method: "GET", url: "/me/data?namespace=cflop&key=settings" },
  {
    method: "PUT",
    url: "/me/data",
    payload: { namespace: "cflop", key: "settings", value: { theme: "dark" } },
  },
  { method: "DELETE", url: "/me/data", payload: { namespace: "cflop", key: "settings" } },
  { method: "GET", url: "/me/data/list?namespace=cflop" },
  { method: "GET", url: "/me/files?namespace=cflop" },
  { method: "DELETE", url: "/me/files", payload: { namespace: "cflop", key: "avatar" } },
  { method: "POST", url: "/me/files?namespace=cflop&key=avatar" },
  { method: "GET", url: "/me/files/content?namespace=cflop&key=avatar" },
];

function createAppWithClerk() {
  return buildApp(
    loadApiRuntimeConfig({ LOG_LEVEL: "error", NODE_ENV: "test", ...DUMMY_CLERK_ENV }),
  );
}

function createAppWithoutClerk() {
  return buildApp(loadApiRuntimeConfig({ LOG_LEVEL: "error", NODE_ENV: "test" }));
}

function inject(
  app: ReturnType<typeof buildApp>,
  route: RouteCase,
): Promise<LightMyRequestResponse> {
  return route.payload === undefined
    ? app.inject({ method: route.method, url: route.url })
    : app.inject({ method: route.method, url: route.url, payload: route.payload });
}

/**
 * Every route in this module answers with the shared error envelope, so the
 * response body is read through that type rather than `json()`'s `any`.
 */
async function injectError(
  app: ReturnType<typeof buildApp>,
  route: RouteCase,
): Promise<{ statusCode: number; body: ApiErrorEnvelope }> {
  const response = await inject(app, route);

  return { statusCode: response.statusCode, body: response.json<ApiErrorEnvelope>() };
}

/**
 * The property this file exists for: with Clerk configured, every user-data
 * route rejects an unauthenticated caller with a 401.
 *
 * These routes are the entire per-user storage surface — arbitrary JSON
 * documents and uploaded file blobs, keyed by the verified session's user id.
 * A route registered without `requireAuth()` would read or overwrite another
 * user's data, and before this test nothing in the suite would have noticed:
 * the module is only registered when `runtimeConfig.clerk !== null`, and no
 * other test configures Clerk, so all eight routes were unexercised.
 */
void test("every user-data route rejects an unauthenticated request with 401", async () => {
  const app = createAppWithClerk();

  try {
    for (const route of USER_DATA_ROUTES) {
      const label = `${route.method} ${route.url}`;
      const { statusCode, body } = await injectError(app, route);

      assert.equal(statusCode, 401, `${label} should reject with 401`);
      assert.deepEqual(
        body.error,
        {
          code: "UNAUTHORIZED",
          message: "Authentication is required to access this resource.",
          statusCode: 401,
        },
        `${label} should return the normalized UNAUTHORIZED envelope`,
      );
      assert.match(String(body.requestId), /^req-\d+$/u);
    }

    // The HEAD routes Fastify synthesises from each GET share that GET's
    // preHandler chain. Asserted rather than assumed, because a HEAD that
    // bypassed `requireAuth()` would confirm the existence of a document or
    // file to an unauthenticated caller through the status code alone.
    for (const url of ["/me/data?namespace=cflop&key=settings", "/me/files?namespace=cflop"]) {
      const response = await app.inject({ method: "HEAD", url });

      assert.equal(response.statusCode, 401, `HEAD ${url} should reject with 401`);
    }
  } finally {
    await app.close();
  }
});

/**
 * Pins the observed ordering rather than the assumed one.
 *
 * The contract-driven routes go through `fastify-type-provider-zod`, whose
 * validation runs *before* the `requireAuth()` preHandler — so an
 * unauthenticated request carrying invalid input answers 400, not 401. The two
 * binary routes validate inside their handlers instead, so auth decides first
 * and they answer 401 regardless of input.
 *
 * This is not a hole: a 400 means Fastify short-circuited and no handler ran,
 * so no user data is reached either way, and the schemas themselves are public
 * source in `@unimatrix/shared`. It is asserted because it is surprising, and
 * because a future change that moved auth ahead of validation would otherwise
 * silently alter what unauthenticated callers can distinguish.
 */
void test("schema validation precedes auth on contract routes, but not on binary routes", async () => {
  const app = createAppWithClerk();

  try {
    const validatedFirst: readonly RouteCase[] = [
      { method: "GET", url: "/me/data" },
      { method: "PUT", url: "/me/data", payload: { nonsense: true } },
      { method: "DELETE", url: "/me/data", payload: {} },
      { method: "GET", url: "/me/data/list" },
      { method: "GET", url: "/me/files" },
      { method: "DELETE", url: "/me/files", payload: { nonsense: true } },
    ];

    for (const route of validatedFirst) {
      const { statusCode, body } = await injectError(app, route);

      assert.equal(
        statusCode,
        400,
        `${route.method} ${route.url} is expected to fail validation before auth`,
      );
      assert.equal(body.error.code, "VALIDATION_ERROR");
    }

    const authedFirst: readonly RouteCase[] = [
      { method: "POST", url: "/me/files" },
      { method: "GET", url: "/me/files/content" },
    ];

    for (const route of authedFirst) {
      const { statusCode, body } = await injectError(app, route);

      assert.equal(
        statusCode,
        401,
        `${route.method} ${route.url} validates in its handler, so auth must decide first`,
      );
      assert.equal(body.error.code, "UNAUTHORIZED");
    }
  } finally {
    await app.close();
  }
});

/**
 * The complement: without Clerk configured the module is never registered, so
 * the routes are absent rather than open. A regression that registered them
 * unconditionally would expose them with no auth plugin behind them at all,
 * which is the worst available failure — so assert 404 rather than trusting the
 * `if` in `src/modules/index.ts` to keep saying what it says today.
 */
void test("user-data routes are absent when Clerk is not configured", async () => {
  const app = createAppWithoutClerk();

  try {
    assert.equal(app.runtimeConfig.clerk, null);

    for (const route of USER_DATA_ROUTES) {
      const { statusCode, body } = await injectError(app, route);

      assert.equal(statusCode, 404, `${route.method} ${route.url} should not exist without Clerk`);
      assert.equal(body.error.code, "NOT_FOUND");
    }
  } finally {
    await app.close();
  }
});

/**
 * Guards `USER_DATA_ROUTES` against drift. Fastify's own route tree is the
 * source of truth; a route added to the module but not listed above would
 * otherwise be silently exempt from every assertion in this file.
 */
void test("the route list covers every /me route the module registers", async () => {
  const app = createAppWithClerk();

  try {
    await app.ready();

    const registered = new Set<string>();

    // `printRoutes` renders a tree whose child lines carry only their own path
    // segment (`└── /list`), so the full URL has to be rebuilt from the
    // ancestors. Depth is the number of four-character indent units before the
    // branch marker.
    const segments: string[] = [];

    for (const line of app.printRoutes({ commonPrefix: false }).split("\n")) {
      const match = /^(?<indent>[\s│]*)[├└]── (?<segment>\S+) \((?<methods>[A-Z, ]+)\)/u.exec(line);

      if (match?.groups === undefined) {
        continue;
      }

      const { indent, segment, methods } = match.groups;

      if (indent === undefined || segment === undefined || methods === undefined) {
        continue;
      }

      const depth = Math.floor(indent.length / 4);

      segments.length = depth;
      segments[depth] = segment;

      const url = segments.join("").replace(/\/$/u, "");

      if (!url.startsWith("/me")) {
        continue;
      }

      for (const method of methods.split(", ")) {
        // Fastify's `exposeHeadRoutes` synthesises a HEAD for every GET. Those
        // are not separately declared in the module and share the GET's
        // preHandler chain, so they are covered by the GET entry rather than
        // needing one of their own. The assertion below checks that sharing
        // actually holds instead of taking it on trust.
        if (method === "HEAD") {
          continue;
        }

        registered.add(`${method} ${url}`);
      }
    }

    const listed = new Set(
      USER_DATA_ROUTES.map((route) => `${route.method} ${route.url.split("?")[0]}`),
    );

    assert.ok(registered.size > 0, "expected printRoutes to report /me routes");
    assert.deepEqual(
      [...registered].filter((route) => !listed.has(route)).sort(),
      [],
      "every registered /me route must appear in USER_DATA_ROUTES",
    );
    assert.deepEqual(
      [...listed].filter((route) => !registered.has(route)).sort(),
      [],
      "every route in USER_DATA_ROUTES must actually be registered",
    );
  } finally {
    await app.close();
  }
});

/** Strips line and block comments so commented-out code cannot satisfy a check. */
function stripComments(source: string): string {
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/^[ \t]*\/\/.*$/gmu, "");
}

/**
 * Splits the module source into one chunk per `.route({ ... })` call.
 *
 * Deliberately text-based rather than a real parse: this needs to answer
 * "does the source say `requireAuth()` here", which is exactly the question a
 * behavioural test cannot answer — see the comment on the test below.
 */
/**
 * One chunk per route declaration, covering both forms the modules use: the
 * `.route({ ... })` object and the `.post(url, opts, handler)` shorthand. The
 * shorthand is not cosmetic — CodeQL's per-route rate-limit rule only sees a
 * ceiling declared that way — so a structural check that knew only about the
 * object form would silently stop counting the route that carries one.
 *
 * The shorthand's URL is either a string literal (the binary routes, which are
 * not contract-driven) or a `<name>Contract.path` reference (the JSON routes,
 * which are). Matching only the literal form silently undercounted by one the
 * moment `PUT /me/data` moved onto the shorthand to carry its rate limit —
 * which is the failure mode this whole test exists to prevent, so the
 * alternation is spelled out rather than loosened to "any expression". A bare
 * `\w+` there would also match ordinary `.get(`/`.delete(` method calls on
 * non-route objects.
 */
function splitRouteDefinitions(source: string): string[] {
  return stripComments(source)
    .split(/\.route\(\{|\.(?:get|post|put|patch|delete)\(\s*(?:"|\w+Contract\.path)/u)
    .slice(1);
}

/**
 * The structural counterpart to the 401 test above, and the reason both exist.
 *
 * Removing `preHandler: requireAuth()` from a route does NOT change any status
 * code, so every behavioural test in this file stays green. Verified by
 * mutation rather than reasoned about: deleting it from `GET /me/data/list`
 * left all four passing. The cause is `getRequiredAuthUserId()`, which throws
 * its own 401 when `getAuthUserId()` returns null — defence in depth that also
 * hides the missing guard.
 *
 * That defence is real but thinner than `requireAuth()`. It only fires where a
 * handler actually calls it, so a future route that reads the session some
 * other way, or returns before reaching that call, would serve unauthenticated
 * requests with nothing to stop it. This test pins the guard itself.
 */
void test("every route in the user-data module declares requireAuth()", async () => {
  const source = await readFile(MODULE_SOURCE_PATH, "utf8");
  const definitions = splitRouteDefinitions(source);

  assert.equal(
    definitions.length,
    USER_DATA_ROUTES.length,
    "expected one route declaration per entry in USER_DATA_ROUTES",
  );

  for (const [index, definition] of definitions.entries()) {
    assert.ok(
      definition.includes("preHandler: requireAuth(),"),
      `route definition #${index + 1} in src/modules/user-data/index.ts is missing preHandler: requireAuth()`,
    );
  }
});

/**
 * Self-check for the check. If `stripComments` ever stopped working, a
 * commented-out `preHandler: requireAuth()` would satisfy the test above and it
 * would pass while enforcing nothing.
 */
void test("stripComments hides commented-out guards from the structural check", () => {
  const commented =
    'app.route({\n  method: "GET",\n  // preHandler: requireAuth(),\n  handler: noop,\n});';

  const [commentedDefinition, ...commentedRest] = splitRouteDefinitions(commented);

  assert.equal(commentedRest.length, 0);
  assert.ok(commentedDefinition !== undefined);
  assert.ok(!commentedDefinition.includes("preHandler: requireAuth(),"));

  const real = 'app.route({\n  method: "GET",\n  preHandler: requireAuth(),\n  handler: noop,\n});';

  const [realDefinition] = splitRouteDefinitions(real);

  assert.ok(realDefinition !== undefined);
  assert.ok(realDefinition.includes("preHandler: requireAuth(),"));
});
