import {
  dokployComposeSchema,
  dokployContainersSchema,
  dokployProjectsSchema,
  dokployVersionSchema,
  type DokployCompose,
  type DokployContainer,
  type DokployProject,
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
 * Never carries a response-body fragment on `message`, `cause`, or any other property.
 * `project.all` "returns every project's whole environment-variable blob"
 * (`.github/workflows/ci.yml`'s own comment on why its `Deploy` job never prints one), and
 * `compose.one` returns a single service's env blob in plaintext — the same
 * `SecretsClientError` precedent in `packages/secrets/AGENTS.md` §5, for a different reason.
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
  getProjects: () => Promise<DokployProject[]>;
  getCompose: (composeId: string) => Promise<DokployCompose>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Dokploy is tRPC-derived: every call is `GET|POST /api/<router>.<procedure>`, never a REST
 * resource path. `/api/openapi.json` 404s on the running v0.29.13, so there is no spec to generate
 * a client from — this hand-writes the four procedures whose 200 response has actually been
 * observed. See `apps/deploy/AGENTS.md` before adding a fifth. All four are `GET` — `callProcedure`
 * hardcodes the method, and it must stay that way until a mutation path is deliberately added.
 */
export function createDokployClient(options: CreateDokployClientOptions): DokployClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl.endsWith("/") ? options.baseUrl.slice(0, -1) : options.baseUrl;

  async function callProcedure<T>(
    procedurePath: string,
    schema: { parse: (value: unknown) => T },
    query?: Readonly<Record<string, string>>,
  ): Promise<T> {
    // Built through URL/URLSearchParams rather than string concatenation, so a query value
    // containing `&` or `#` (a composeId is Dokploy-generated, not user input, but nothing here
    // depends on that staying true) cannot reshape the request past what was intended.
    const url = new URL(`${baseUrl}/api/${procedurePath}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      url.searchParams.set(key, value);
    }

    const response = await fetchImpl(url, {
      method: "GET",
      headers: { "x-api-key": options.apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      // Never `await response.text()` here: `project.all` and `compose.one` both return an env
      // blob, and reading the body into this error's message would put it there.
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
    getProjects: () => callProcedure("project.all", dokployProjectsSchema),
    getCompose: (composeId) => callProcedure("compose.one", dokployComposeSchema, { composeId }),
  };
}
