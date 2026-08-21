# AGENTS.md

## 1. Overview
`apps/deploy` is a Fastify service holding a typed Dokploy API client, a read-only reconcile report,
and a settings-only apply (`src/reconcile/`, `pnpm --filter @unimatrix/deploy-app reconcile`): it
diffs `src/reconcile/desired-state.gen.ts` against what Dokploy actually holds, prints drift, and can
write `composePath`/`branch`/`autoDeploy` for one app at a time. It performs no probing, writes no
env, and creates and deploys nothing — see `README.md` for what still has to happen by hand before
this stack deploys, and for apply's full refusal set.

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
  `docker.getContainers`, `settings.getDokployVersion`, `project.all`, `compose.one`, and
  `compose.update` are the five this service carries. `DokployClientError` (`src/dokploy/client.ts`)
  never carries a response-body fragment, on any property: `project.all` returns every project's
  whole environment-variable blob and `compose.one` returns one service's, both in plaintext.
- **`callProcedure` hardcodes `method: "GET"` and stays read-only; `compose.update` is the one
  mutation and goes through the separate `callMutation` instead.** `callMutation` never reads a 200
  body — the fork's `update` procedure returns the whole updated compose row, `env` plaintext
  included, and `void` on success is the only return shape that cannot carry it. A non-2xx body is
  reduced to the error `code` and the `zodError.fieldErrors` key names only — never the zod message,
  which can echo the offending value, and never the row.
- **The only mutation this service performs is `compose.update` with a closed
  `{composePath?, branch?, autoDeploy?}` payload** (`DokployComposeSettingsUpdate`) —
  `compose.create` and `compose.deploy` remain absent, because `compose.create` needs an
  `environmentId` nothing in this repo declares and nothing here triggers a deploy. `env` has no
  field on that type, so a caller cannot express an env write even by accident.
  `apps/deploy/src/reconcile/apply.ts`'s `applyAppSettings` refuses to write against this service's
  own compose entry (`RECONCILE_SELF_APP_DIR`, checked before any network call): `compose.update`
  there followed by any deploy would destroy the process performing the reconciliation mid-run, and
  Dokploy has no rollback for a Compose service (`docs/deployment.md`). It also refuses an app not in
  the manifest, a name that matches zero or more than one Dokploy compose service, a match anchored
  to a different GitHub owner/repository than this one's (`findComposeMatches` matches on service
  name alone, globally across the instance, and reads no `projectId`), and a `sourceType`
  disagreement (it selects which sibling column group drives the clone, and this repo declares none
  of them). `autoDeploy`'s written value always comes from the `RECONCILE_AUTO_DEPLOY` policy
  constant, never from the diff's `declared` string — the fork's `coerceSchema` treats `autoDeploy`
  as `z.coerce.boolean()`, under which the string `"false"` coerces to `true`.
- **`compose.update` is the only HTTP route on v0.29.13 that can write a compose service's `env`.**
  `compose.saveEnvironment` exists as a tRPC procedure but is absent from the exposed path map, so a
  future env-apply PR must widen this same procedure rather than reaching for a narrower one.
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
