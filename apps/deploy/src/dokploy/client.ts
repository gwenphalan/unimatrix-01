import {
  dokployContainersSchema,
  dokployVersionSchema,
  type DokployContainer,
  type DokployVersion,
} from "./schemas.js";

export interface DeployDokployEnv {
  DOKPLOY_API_KEY?: string | undefined;
}

/**
 * Throws on an absent or empty key rather than returning `undefined` — a caller that forgets to
 * check a nullable return is exactly how a key silently never reaches the client. The key itself is
 * read once here and lives only in the closure `createDokployClient` builds; it never reaches
 * `runtimeConfig` (`src/config.ts`) or any log line — see `apps/deploy/AGENTS.md`.
 */
export function loadDokployApiKey(env: DeployDokployEnv = process.env): string {
  const value = env.DOKPLOY_API_KEY;

  if (value === undefined || value.trim().length === 0) {
    throw new Error("DOKPLOY_API_KEY must be set.");
  }

  return value.trim();
}

/**
 * Never carries a response-body fragment on `message`, `cause`, or any other property — even
 * though neither procedure this scaffold calls returns anything sensitive. `project.all`, which a
 * later Dokploy client method will need, "returns every project's whole environment-variable blob"
 * (`.github/workflows/ci.yml`'s own comment on why its `Deploy` job never prints one). Writing the
 * rule into the class now, with a test, is what stops the first procedure that does return env
 * blobs from leaking them into a log line — the same `SecretsClientError` precedent in
 * `packages/secrets/AGENTS.md` §5, for a different reason.
 */
export class DokployClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "DokployClientError";
    this.status = status;
  }
}

export interface CreateDokployClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export interface DokployClient {
  getDokployVersion: () => Promise<DokployVersion>;
  getContainers: () => Promise<DokployContainer[]>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Dokploy is tRPC-derived: every call is `GET|POST /api/<router>.<procedure>`, never a REST
 * resource path. `/api/openapi.json` 404s on the running v0.29.13, so there is no spec to generate
 * a client from — this hand-writes the two procedures whose 200 response has actually been
 * observed. See `apps/deploy/AGENTS.md` before adding a third.
 */
export function createDokployClient(options: CreateDokployClientOptions): DokployClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;

  async function callProcedure<T>(
    procedurePath: string,
    schema: { parse: (value: unknown) => T },
  ): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/api/${procedurePath}`, {
      method: "GET",
      headers: { "x-api-key": options.apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // Never `await response.text()` here: the caller of `project.all` (a later change) would
      // otherwise put a project's whole env blob into this error's message.
      throw new DokployClientError(
        `Dokploy procedure ${procedurePath} responded with status ${response.status}.`,
        response.status,
      );
    }

    let body: unknown;

    try {
      body = await response.json();
    } catch {
      throw new DokployClientError(
        `Dokploy procedure ${procedurePath} did not return a JSON body.`,
        response.status,
      );
    }

    try {
      return schema.parse(body);
    } catch {
      // Never the zod error itself: its `.message` can echo back the offending value, and this
      // class's whole point is never carrying a response-body fragment.
      throw new DokployClientError(
        `Dokploy procedure ${procedurePath} returned a body that failed schema validation.`,
        response.status,
      );
    }
  }

  return {
    getDokployVersion: () => callProcedure("settings.getDokployVersion", dokployVersionSchema),
    getContainers: () => callProcedure("docker.getContainers", dokployContainersSchema),
  };
}
