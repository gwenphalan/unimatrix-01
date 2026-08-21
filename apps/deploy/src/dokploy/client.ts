import {
  dokployComposeSchema,
  dokployContainersSchema,
  dokployMutationErrorSchema,
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

/**
 * The only three `compose.update` settings this service can write. Closed on purpose: `env` has no
 * field here to hold it, so a caller cannot express an env write even by accident — the type itself
 * is the guarantee, the primary structural one this whole apply path rests on.
 */
export interface DokployComposeSettingsUpdate {
  composePath?: string;
  branch?: string;
  autoDeploy?: boolean;
}

export interface DokployClient {
  getDokployVersion: () => Promise<DokployVersion>;
  getContainers: () => Promise<DokployContainer[]>;
  getProjects: () => Promise<DokployProject[]>;
  getCompose: (composeId: string) => Promise<DokployCompose>;
  updateComposeSettings: (
    composeId: string,
    settings: DokployComposeSettingsUpdate,
  ) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Dokploy is tRPC-derived: every call is `GET|POST /api/<router>.<procedure>`, never a REST
 * resource path. `/api/openapi.json` 404s on the running v0.29.13, so there is no spec to generate
 * a client from — this hand-writes the procedures whose response has actually been observed. See
 * `apps/deploy/AGENTS.md` before adding another. Every read goes through `callProcedure`, which
 * hardcodes `GET` and must stay that way; the one mutation this service performs,
 * `compose.update`, goes through the separate `callMutation` below instead.
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

  /**
   * The one mutation path this service has. Never `await response.json()`/`.text()` on a 200: the
   * fork's `update` procedure does `db.update(compose).set(...).where(...)` and returns the whole
   * updated row, `env` plaintext included — reading it would put a secret blob in a value this
   * function returns, the exact thing `callProcedure` above is built to avoid on the read side.
   * `void` on success is the only shape that cannot carry one.
   *
   * On a non-2xx, the body is `{code, message, data: {zodError}, issues}` — field names and zod
   * messages, never the row — so reducing it to key names only is safe in a way reading the 200
   * body never is. Parsed defensively: a body that is not JSON, or does not have the expected
   * shape, degrades to the bare status instead of throwing inside the error path.
   */
  async function callMutation(
    procedurePath: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    const url = new URL(`${baseUrl}/api/${procedurePath}`);

    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "x-api-key": options.apiKey, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) {
      return;
    }

    let code: string | undefined;
    let fieldNames: string[] = [];

    try {
      const body: unknown = await response.json();
      const parsed = dokployMutationErrorSchema.safeParse(body);

      if (parsed.success) {
        code = parsed.data.code;
        fieldNames = Object.keys(parsed.data.data?.zodError?.fieldErrors ?? {});
      }
    } catch {
      // Falls through to the bare-status message below — never throws inside the error path.
    }

    const codeSuffix = code !== undefined ? ` (code: ${code})` : "";
    const fieldSuffix = fieldNames.length > 0 ? ` (fields: ${fieldNames.join(", ")})` : "";

    throw new DokployClientError(
      `Dokploy procedure ${procedurePath} responded with status ${response.status}${codeSuffix}${fieldSuffix}.`,
      response.status,
    );
  }

  return {
    getDokployVersion: () => callProcedure("settings.getDokployVersion", dokployVersionSchema),
    getContainers: () => callProcedure("docker.getContainers", dokployContainersSchema),
    getProjects: () => callProcedure("project.all", dokployProjectsSchema),
    getCompose: (composeId) => callProcedure("compose.one", dokployComposeSchema, { composeId }),
    // Named fields, never a spread: TypeScript's excess-property check only fires on an object
    // literal, so a wider `settings` object — one carrying a stray `env`, say — would otherwise
    // ride the spread onto the wire with no compile-time or runtime check catching it.
    updateComposeSettings: (composeId, settings) =>
      callMutation("compose.update", {
        composeId,
        composePath: settings.composePath,
        branch: settings.branch,
        autoDeploy: settings.autoDeploy,
      }),
  };
}
