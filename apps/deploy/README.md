# Deploy service

A Fastify service deployed from `apps/deploy/Dockerfile` through
`infra/docker/deploy-compose.yaml`. It is unrouted — no domain, no Traefik
entry — and `GET /health` is the only route it answers.

## The irreducible bootstrap set

Three credentials can never come from the secrets store this service will
eventually manage, and this service cannot be what creates itself in Dokploy
the first time:

- **The Dokploy API key** (`DOKPLOY_API_KEY`) — it is what the store-side
  materialization work (a later change) would use to reach Dokploy in the
  first place, so it cannot itself be fetched from the store.
- **This service's own secrets-store service token** — issuing it needs the
  secrets service already running and reachable, which this service's own
  deploy cannot depend on.
- **`SECRETS_KEKS`** — never held by this service at all; named here only
  because it is the same root-set reasoning. See `packages/secrets/AGENTS.md`
  §4 for the store-side floor these three sit beside.

## Before this stack can deploy

Nothing here is gated before a merge. Step 1 is the only one any check reports
on at all, and it reports **after** the merge, in a job that cannot block one:

1. Create a Dokploy Compose service named `deploy` **before merging** the PR
   that adds `infra/docker/deploy-compose.yaml`. CI's `Deploy` job runs on push
   to `main` only, resolves every generated compose file against Dokploy's
   project list, and fails by name — not just skips — when one is missing. It
   is not an armed required check, so a missing service is a red job on `main`
   rather than a blocked PR.
2. Set `IMAGE_TAG=${{project.IMAGE_TAG}}` in that service's own environment
   variables. Dokploy does not inherit project-level variables into a Compose
   stack, so without this line `${IMAGE_TAG}` resolves empty and the deploy
   fails on `invalid reference format` (`docs/deployment.md`).
3. Make the GHCR package public by hand after the first `Publish` run
   creates it (`docs/deployment.md`'s "A new app's package is private until
   someone makes it public by hand").
4. Arm `Images (deploy)` as a required check on the `main` branch ruleset —
   a repository-ruleset write outside this repo's files, tracked as its own
   task in `.notes/01-todo/deploy.todo.md`.
5. Set `DOKPLOY_BASE_URL` and `DOKPLOY_API_KEY` in Dokploy's environment-variable
   UI before deploying. `DOKPLOY_BASE_URL` is `http://dokploy:3000`: the swarm
   service is named `dokploy`, publishes target port 3000, and is attached to
   `dokploy-network` (`docker service inspect dokploy` and
   `docker network inspect dokploy-network` on the host, 2026-08-14). That the
   name resolves from an attached Compose container is inferred from swarm's
   embedded DNS, **not measured** — nothing has run in a container on that
   network yet. Never the public hostname: that path measures Cloudflare and
   Traefik as much as Dokploy, and costs two Access service-token secrets.

## Reconcile report

`pnpm --filter @unimatrix/deploy-app reconcile report` diffs
`src/reconcile/desired-state.gen.ts` — generated from every `apps/<app>/deploy.config.ts` — against
what Dokploy actually holds, and prints the result. Read-only: it calls only `project.all` and
`compose.one`, never `compose.create`, `compose.update`, or `compose.deploy`. Applying a
reconciliation is a separate, later PR — see `AGENTS.md`.

For each declared app it reports one of `MISSING` (no Dokploy compose service of that name),
`AMBIGUOUS` (more than one, matched globally across every Dokploy project the same way CI's
`Deploy` job does), `IN SYNC`, or `DRIFT` naming which env keys and which of `composePath`,
`sourceType`, `branch`, `autoDeploy` disagree. An env finding is always a key and a state — `set`,
`blank`, `missing`, `optional-absent`, or `undeclared` — never a value; Dokploy's `env` blob is
reduced to that before it exists anywhere in this service (`readEnvKeyStates`,
`src/dokploy/schemas.ts`). `image` and `containerPort` ride along in the manifest for the apply PR
and are not part of this diff.

It deliberately does not check a service's Domains entry (out of scope — `packages/deploy-config`
holds no domain data at all) or its `watchPaths`/`composeFile` (inert while `autoDeploy` is off, and
the inline-source field of a source type this repo does not use).

Same env requirement as `pnpm --filter @unimatrix/deploy-app dev` — `DOKPLOY_BASE_URL` and
`DOKPLOY_API_KEY` on the command line, locally or in production:

    DOKPLOY_BASE_URL=http://localhost:3000 DOKPLOY_API_KEY=<your-key> \
      pnpm --filter @unimatrix/deploy-app reconcile report

## Local development

No `.env` file support and no `dotenv` dependency, same reasoning as
`apps/secrets`: loading one would put the Dokploy API key on a developer's
disk. Supply both variables on the command line:

    DOKPLOY_BASE_URL=http://localhost:3000 DOKPLOY_API_KEY=<your-key> \
      pnpm --filter @unimatrix/deploy-app dev
