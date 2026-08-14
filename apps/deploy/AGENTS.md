# AGENTS.md

## 1. Overview
`apps/deploy` is a Fastify service scaffold holding a typed Dokploy API client. It performs no
reconciliation and no probing — see `README.md` for what still has to happen by hand before this
stack deploys.

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
  `docker.getContainers` and `settings.getDokployVersion` are the two this scaffold carries.
  `DokployClientError` (`src/dokploy/client.ts`) never carries a response-body fragment, on any
  property; a later procedure such as `project.all` returns a whole project's environment-variable
  blob, and the class has to refuse that before that call exists, not after.
