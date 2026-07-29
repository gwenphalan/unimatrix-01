import Fastify, { type FastifyInstance, type preHandlerAsyncHookHandler } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthMock = vi.fn();

vi.mock("@clerk/fastify", () => ({
  clerkPlugin: () => undefined,
  getAuth: (request: unknown): unknown => getAuthMock(request),
}));

const { AuthError, requireAuth, requirePermission } = await import("../src/server.js");

/**
 * Mounts a guard on a real Fastify instance.
 *
 * The guards are only ever *used* as Fastify hooks, and the behaviour that
 * broke — a hook that neither calls `next` nor returns a thenable stalls the
 * request forever — is invisible when the guard is called as a plain function.
 * So these tests drive it through the hook runner rather than invoking it
 * directly.
 */
async function buildApp(preHandler: preHandlerAsyncHookHandler): Promise<FastifyInstance> {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) =>
    error instanceof AuthError
      ? reply.status(error.statusCode).send({ code: error.code })
      : reply.status(500).send({ code: "INTERNAL" }),
  );

  app.get("/guarded", { preHandler }, () => ({ ok: true }));

  await app.ready();

  return app;
}

/**
 * A stalled request produces no response at all, so an un-raced `inject()`
 * would surface as a bare test-runner timeout with nothing naming the cause.
 */
async function inject(app: FastifyInstance): Promise<{ statusCode: number; body: string }> {
  const response = await Promise.race([
    app.inject({ method: "GET", url: "/guarded" }),
    new Promise<"STALLED">((resolve) => {
      setTimeout(() => {
        resolve("STALLED");
      }, 1000);
    }),
  ]);

  if (response === "STALLED") {
    throw new Error("the guard never completed the request: it stalled the Fastify hook chain");
  }

  return { statusCode: response.statusCode, body: response.body };
}

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets an authenticated request through to the handler", async () => {
    getAuthMock.mockReturnValue({ userId: "user_1", sessionClaims: {} });

    const app = await buildApp(requireAuth());

    // The regression this exists for: the rejection paths below answered
    // correctly even while every *authorized* request hung forever, so a
    // suite that only asserted 401/403 stayed green against a dead API.
    expect(await inject(app)).toStrictEqual({ statusCode: 200, body: '{"ok":true}' });
  });

  it("rejects a request with no session", async () => {
    getAuthMock.mockReturnValue({ userId: null, sessionClaims: null });

    const app = await buildApp(requireAuth());

    expect(await inject(app)).toStrictEqual({ statusCode: 401, body: '{"code":"UNAUTHORIZED"}' });
  });
});

describe("requirePermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lets a session holding the permission through to the handler", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_1",
      sessionClaims: { permissions: { auth: ["admin"] } },
    });

    const app = await buildApp(requirePermission("auth", "admin"));

    expect(await inject(app)).toStrictEqual({ statusCode: 200, body: '{"ok":true}' });
  });

  it("rejects a session without the permission", async () => {
    getAuthMock.mockReturnValue({
      userId: "user_1",
      sessionClaims: { permissions: { auth: ["member"] } },
    });

    const app = await buildApp(requirePermission("auth", "admin"));

    expect(await inject(app)).toStrictEqual({ statusCode: 403, body: '{"code":"FORBIDDEN"}' });
  });

  it("rejects an unauthenticated request before checking permissions", async () => {
    getAuthMock.mockReturnValue({ userId: null, sessionClaims: null });

    const app = await buildApp(requirePermission("auth", "admin"));

    expect(await inject(app)).toStrictEqual({ statusCode: 401, body: '{"code":"UNAUTHORIZED"}' });
  });
});
