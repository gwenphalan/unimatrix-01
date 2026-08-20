# AGENTS.md

## 1. Overview
`apps/deploy` is a Fastify service holding a typed Dokploy API client and a read-only reconcile
report (`src/reconcile/`, `pnpm --filter @unimatrix/deploy-app reconcile`): it diffs
`src/reconcile/desired-state.gen.ts` against what Dokploy actually holds and prints drift. It
performs no probing and applies nothing — see `README.md` for what still has to happen by hand
before this stack deploys, and for why an apply path is a separate PR.

## 2. Rules

- **The Dokploy key is unscoped and unexpiring, and can delete every application on the instance.**
  It comes only from container env (`DOKPLOY_API_KEY`), is read once by `loadDokployApiKey`
  (`src/dokploy/client.ts`) into a closure, and never lands on `runtimeConfig` — which is decorated
  onto the Fastify instance and therefore reachable from every handler and every log call. No log,
  error message, or derived value of it (including a length or a prefix) may exist.
- **`src/config.ts` imports no workspace package.** `infra/scripts/validate-deploy-config.mjs`
  imports it directly, before anything is built, and `@unimatrix/shared`'s exports map points at
  `dist` — the same reasoning as `apps/secrets/src/config.ts`.
- **`/health` is the only route, and adding a second one means adding caller authentication
  first.** This service is unrouted — no domain, no Traefik entry — but that is not what makes it
  private: it holds a manage-scoped Dokploy token and sits on `dokploy-network` alongside every app
  Traefik serves.
- **Dokploy is tRPC-derived: every call is `GET|POST /api/<router>.<procedure>`**, never a REST
  resource path, and `/api/openapi.json` 404s on v0.29.13, so schemas are hand-written rather than
  generated. Only add a procedure whose response has actually been observed —
  `docker.getContainers`, `settings.getDokployVersion`, `project.all`, and `compose.one` are the
  four this service carries. `DokployClientError` (`src/dokploy/client.ts`) never carries a
  response-body fragment, on any property: `project.all` returns every project's whole
  environment-variable blob and `compose.one` returns one service's, both in plaintext.
- **`callProcedure` hardcodes `method: "GET"`, and every procedure above is read-only.** Nothing in
  this service calls `compose.create`, `compose.update`, or `compose.deploy` — that is the apply
  path `README.md`'s "Reconcile report" section names as a deliberately separate PR, and it must
  refuse to apply against this service's own compose entry: `compose.update` + `compose.deploy`
  there would destroy the process performing the reconciliation mid-run, and Dokploy has no
  rollback for a Compose service (`docs/deployment.md`).
- **`src/reconcile/desired-state.gen.ts` is generated** — edit the relevant
  `apps/<app>/deploy.config.ts` and run `node ./infra/scripts/generate-deploy-config.mjs`, not this
  file. It carries no value from any source, only structure (env var names and whether they are
  required).
- **No env value crosses `src/reconcile/`'s boundary, ever — only a key and a closed state.**
  `readEnvKeyStates` (`src/dokploy/schemas.ts`) reduces Dokploy's plaintext `env` blob to
  `{key, blank}` inside its own schema transform, so the plaintext exists only as that function's
  parameter; nothing downstream — the diff, the report, the CLI — ever holds a field that could
  carry a value. This is `docs/deployment.md`'s "never print a response body" rule applied one layer
  deeper than the client.
