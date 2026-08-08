# Docker and Compose

Dokploy plus Traefik is the primary production target. The Dockerfiles and
Compose files here are the secondary, manual deployment path and the local
validation path for containerized builds.

## Generated — edit the config, not these files

Every `apps/*/Dockerfile` and every compose file in this directory is generated from
`apps/<app>/deploy.config.ts` by `infra/scripts/generate-deploy-config.mjs`. Edit the config and run
`node ./infra/scripts/generate-deploy-config.mjs` (or let the pre-commit hook do it), not the
generated file directly — `check:deploy-config` in `pnpm check`/`pnpm verify` reruns the generator in
`--check` mode and fails on drift. The one exception is each app's own `FROM` lines: the generator
reads those off the file already on disk and re-emits them verbatim, which is what lets a Dependabot
nginx digest bump land as a normal PR (see "Base image updates" below) without ever touching a
`deploy.config.ts` or reddening the drift check. `nginx.conf` is not generated at all.

## Monorepo build rules

Build all six images from the repo root, not from an individual app
directory.

Each app resolves workspace source aliases from its own `vite.config.ts` and
`tsconfig.json` and reads files outside its own directory, so an app-directory
build context cannot resolve them. `apps/api` and `apps/secrets` need the repo
root at runtime as well as at build time: the compiled output still imports
`@unimatrix/shared` by workspace name.

The checked-in images assume these repo-root build contexts:

```bash
docker build -f apps/web/Dockerfile .
docker build -f apps/api/Dockerfile .
docker build -f apps/cflop/Dockerfile .
docker build -f apps/auth/Dockerfile .
docker build -f apps/admin/Dockerfile .
docker build -f apps/secrets/Dockerfile .
```

## Dokploy watch-path convention

Dokploy services should watch only the repository paths that can affect their
image, rather than rebuilding every service for every `main` branch change.
Each live app README is the canonical service-specific list:

- `apps/web/README.md`
- `apps/api/README.md`
- `apps/cflop/README.md`
- `apps/auth/README.md`
- `apps/admin/README.md`
- `apps/secrets/README.md`

Every list includes the service directory, workspace source imported by its
build, root pnpm manifests, `.dockerignore`, and the service-specific Compose
file. Update the list and the matching Dokploy watch-path configuration when a
Docker build gains a workspace dependency or another repository input.

## Web image

The web image builds `apps/web/dist` and serves it from a small internal Nginx
container. Nginx is only the static file server inside the container. It is not
the public edge proxy; Traefik stays the edge router in Dokploy.

### Web runtime contract

- container port: `8080`
- build artifact: `apps/web/dist`
- required SPA fallback: unknown application routes must serve `index.html`
- build-time env: `VITE_API_BASE_URL`

This `VITE_*` value is compiled into the frontend bundle. Change it at image
build time, not after the container starts. The public site carries no Clerk
auth of its own — the CMS and its sign-in affordance moved to `apps/admin`.

Example build:

```bash
docker build \
  -f apps/web/Dockerfile \
  --build-arg VITE_API_BASE_URL=http://localhost:3001 \
  -t unimatrix-web:local \
  .
```

## API image

The API image builds `@unimatrix/shared`, compiles `apps/api`, then uses
`pnpm deploy` to package the runtime with production dependencies.

### API runtime contract

- entrypoint: `node dist/server.js`
- container port: `3001`
- healthcheck path: `/health`
- runtime env that has to be supplied: `TRUST_PROXY=1` behind a proxy, and
  `CORS_ALLOWED_ORIGINS` to override the built-in defaults (which include local
  development origins, so production logs a warning when it is unset).
  `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL` and `DATABASE_URL` have image
  defaults in `apps/api/Dockerfile`.

Optional runtime env: `MAX_UPLOAD_BYTES` (per-request file upload size limit
for the user-data file endpoints; defaults to 5 MiB),
`MAX_USER_STORAGE_BYTES` (cumulative per-user cap across documents and files
together; defaults to 50 MiB), plus the Clerk
variables (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`),
required together in production.

Example build:

```bash
docker build -f apps/api/Dockerfile -t unimatrix-api:local .
```

Example run:

```bash
docker run --rm -p 3001:3001 \
  -e CORS_ALLOWED_ORIGINS=http://localhost:8080 \
  unimatrix-api:local
```

## CFLOP image

The cflop image builds `apps/cflop/dist` and serves it from a
small internal Nginx container, same pattern as the web image. It has no
backend dependency: algorithm data is bundled at build time and per-case
learning progress lives in the browser's `localStorage`, so there is no
build-time or runtime env to configure.

### CFLOP runtime contract

- container port: `8080`
- build artifact: `apps/cflop/dist`
- required SPA fallback: unknown application routes must serve `index.html`
- no build-time or runtime env required

Example build:

```bash
docker build \
  -f apps/cflop/Dockerfile \
  -t unimatrix-cflop:local \
  .
```

## Auth image

The auth image builds `apps/auth/dist` and serves it from a small internal
Nginx container, same pattern as the web and cflop images. It is the
central Clerk-backed accounts app (sign-in/sign-up and account management).

### Auth runtime contract

- container port: `8080`
- build artifact: `apps/auth/dist`
- required SPA fallback: unknown application routes must serve `index.html`
- build-time env: `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`

`VITE_CLERK_PUBLISHABLE_KEY` is a public key and safe to ship in a browser
bundle, but it must be the real key for the target Clerk instance.

Example build:

```bash
docker build \
  -f apps/auth/Dockerfile \
  --build-arg VITE_API_BASE_URL=http://localhost:3001 \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx \
  -t unimatrix-auth:local \
  .
```

## Admin image

The admin image builds `apps/admin/dist` and serves it from a small internal
Nginx container, same pattern as the other SPA images. It is the operator
console behind Cloudflare Access; the container itself carries no secrets.

### Admin runtime contract

- container port: `8080`
- build artifact: `apps/admin/dist`
- required SPA fallback: unknown application routes must serve `index.html`
- build-time env: `VITE_API_BASE_URL`, `VITE_CLERK_PUBLISHABLE_KEY`; optional
  `VITE_AUTH_APP_URL` (sign-in redirect target, defaults to
  `https://auth.unimatrix-01.dev`)

`VITE_CLERK_PUBLISHABLE_KEY` has no Dockerfile default on purpose:
`loadAdminAppRuntimeConfig` throws without it, so an image built without the
key fails loudly in the browser rather than rendering an admin console that
can never sign anyone in.

Example build:

```bash
docker build \
  -f apps/admin/Dockerfile \
  --build-arg VITE_API_BASE_URL=http://localhost:3001 \
  --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx \
  -t unimatrix-admin:local \
  .
```

## Secrets service image

The secrets image builds `@unimatrix/shared`, compiles `apps/secrets`, then
uses `pnpm deploy` to package the runtime with production dependencies — the
same shape as the API image, but with its own Drizzle schema and SQLite file
rather than `@unimatrix/db`.

### Secrets service runtime contract

- entrypoint: `node dist/server.js`
- container port: `3001`
- healthcheck path: `/health`
- runtime env that has to be supplied: `SECRETS_KEKS` — the service refuses to
  start without it. `NODE_ENV`, `HOST`, `PORT`, `LOG_LEVEL` and
  `SECRETS_DATABASE_URL` (default `/data/secrets.sqlite`) have image defaults
  in `apps/secrets/Dockerfile`; `DB_MIGRATE_ON_START` defaults to `"true"` in
  `secrets-compose.yaml`.
- **no domain**: this service is deliberately unrouted — see `docs/deployment.md`.

Example build:

```bash
docker build -f apps/secrets/Dockerfile -t unimatrix-secrets:local .
```

Example run:

```bash
docker run --rm -p 3002:3001 -e SECRETS_KEKS=1:<base64-32-bytes> unimatrix-secrets:local
```

## Compose workflow

`infra/docker/web-compose.yaml`, `infra/docker/api-compose.yaml`,
`infra/docker/cflop-compose.yaml`, `infra/docker/auth-compose.yaml`,
`infra/docker/admin-compose.yaml`, and `infra/docker/secrets-compose.yaml` are each
single-service files. Run them together from the repo root for local
combined validation:

```bash
VITE_API_BASE_URL=http://localhost:3001 \
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx \
VITE_AUTH_APP_URL=http://localhost:8082 \
CORS_ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:8080 \
SECRETS_KEKS=1:<base64-32-bytes> \
docker compose \
  -f infra/docker/api-compose.yaml \
  -f infra/docker/web-compose.yaml \
  -f infra/docker/cflop-compose.yaml \
  -f infra/docker/auth-compose.yaml \
  -f infra/docker/admin-compose.yaml \
  -f infra/docker/secrets-compose.yaml \
  up --build
```

None of the files publish host ports. That is intentional: the same files run
unmodified as Dokploy Compose apps, where Dokploy's Domains page owns port
exposure instead of a `ports:` block. Because of that, `curl`/browser checks
against `localhost` need containers run directly instead of through compose:

```bash
docker build -f apps/api/Dockerfile -t unimatrix-api:local .
docker run --rm -p 3001:3001 -e CORS_ALLOWED_ORIGINS=http://localhost:8080 unimatrix-api:local

docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3001 -t unimatrix-web:local .
docker run --rm -p 8080:8080 unimatrix-web:local

docker build -f apps/cflop/Dockerfile -t unimatrix-cflop:local .
docker run --rm -p 8081:8080 unimatrix-cflop:local

docker build -f apps/auth/Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3001 --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx -t unimatrix-auth:local .
docker run --rm -p 8082:8080 unimatrix-auth:local

docker build -f apps/admin/Dockerfile --build-arg VITE_API_BASE_URL=http://localhost:3001 --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx --build-arg VITE_AUTH_APP_URL=http://localhost:8082 -t unimatrix-admin:local .
docker run --rm -p 8083:8080 unimatrix-admin:local
```

## Verification

After startup, verify:

```bash
curl http://localhost:3001/health
curl -I http://localhost:8080/
curl -I http://localhost:8081/
curl -I http://localhost:8082/
curl -I http://localhost:8083/
```

Then confirm a deep route in each SPA renders after both a normal navigation
and a refresh — that is what exercises the nginx `index.html` fallback.

## Database posture

Two services store data in SQLite, each on its own volume — `apps/api` through
`@unimatrix/db`, `apps/secrets` through its own Drizzle schema
(`apps/secrets/src/db`). The container workflow persists both:

- **SQLite volumes**: the API Dockerfile defaults `DATABASE_URL` to
  `/data/unimatrix.sqlite` (`api-compose.yaml` mounts `api-data` there); the
  secrets Dockerfile defaults `SECRETS_DATABASE_URL` to `/data/secrets.sqlite`
  (`secrets-compose.yaml` mounts `secrets-data` there). Both Dockerfiles create
  `/data` owned by the non-root `node` user, so data survives container
  recreation once each volume is mapped to durable host storage.
- **Migrations**: both compose files set `DB_MIGRATE_ON_START=true`, so each
  service applies its own pending Drizzle migrations against its volume at
  startup (idempotent — a no-op when the schema is current). No separate
  migration service or one-off command is required in this workflow.

Remaining caveat: SQLite is single-writer, so each shape assumes a single
instance of its service. Horizontal scaling would need a different database or
a shared storage strategy.

## Dokploy Compose deployment

`infra/docker/web-compose.yaml`, `infra/docker/api-compose.yaml`,
`infra/docker/cflop-compose.yaml`, `infra/docker/auth-compose.yaml`,
`infra/docker/admin-compose.yaml`, and `infra/docker/secrets-compose.yaml` are single-service compose
files meant to be used as Dokploy's "Compose" application type, one Dokploy app per file. They
intentionally have:

- no `ports:` host publishing
- no Traefik labels

Dokploy's own Domains page handles routing: pick the service and the
container port (`8080` for web, `3001` for api, `8080` for cflop,
`8080` for auth, `8080` for admin) there, and Dokploy wires Traefik itself. Don't hand-add
Traefik labels to these files. Point the cflop Dokploy app's domain at
`cflop.unimatrix-01.dev` (plus `cube.unimatrix-01.dev` as a redirect-only entry —
see `docs/deployment.md`), the auth Dokploy app's domain at
`auth.unimatrix-01.dev`, and the admin Dokploy app's domain at
`admin.unimatrix-01.dev`. The secrets Dokploy app gets no Domains entry at all — it is
deliberately unrouted, reachable only from inside the Dokploy network by other services that need it.

`web-compose.yaml` and `api-compose.yaml` read their environment-dependent
values (`VITE_API_BASE_URL`, `CORS_ALLOWED_ORIGINS`) from compose variable
substitution, so set those in the Dokploy app's environment variables UI
rather than editing the file. `cflop-compose.yaml` has no
environment-dependent values to set. `auth-compose.yaml` reads
`VITE_API_BASE_URL` and `VITE_CLERK_PUBLISHABLE_KEY` the same way, and
`admin-compose.yaml` reads those two plus an optional `VITE_AUTH_APP_URL`.

Previews cannot be enabled on these apps — Dokploy supports them only on
Application-type services. See `docs/deployment.md` for the full
Dokploy service setup, including how previews are configured instead.

## Base image updates

Dependabot watches base images through the `docker` ecosystem, pointed at the
six `apps/*` directories — **not** at this one. The compose files here declare
no `image:` at all, only `build:` plus a Dockerfile path, and Dependabot's
`docker-compose` parser reads only `image:` (or an inline `dockerfile_inline`).
It never follows `build.dockerfile`, so a `docker-compose` block would scan
these files and find nothing. Don't add one.

Two consequences worth knowing before treating a quiet Dependabot as "nothing
to update":

- Only the `nginx` base-image pins are tracked. Every
  `FROM node:${NODE_VERSION}-alpine` is invisible: Dependabot does no ARG
  interpolation and its tag regex cannot match a leading `$`. That is
  deliberate — the Node version stays owned by `.node-version` and CI's
  `node-version-file` rather than gaining a second, competing owner.
- Base-image PRs auto-merge on the same terms as any other minor/patch: the
  required `Images` checks build every `apps/*/Dockerfile`.

That auto-merge is why base images are not a field in `deploy.config.ts` (see "Generated" above).
`dockerfileFor()` takes the `FROM` lines as an explicit argument and re-emits them verbatim instead
of deriving them, so a Dependabot digest bump touches only the Dockerfile it already targets. If the
digest were config-owned instead, every such PR would need a second commit syncing the config back —
and `.github/workflows/dependabot-auto-merge.yml` forbids exactly that: no checkout step and no PAT,
so nothing in that workflow could make the sync-back commit even if it wanted to.
