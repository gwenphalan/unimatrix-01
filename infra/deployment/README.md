# Deployment

Dokploy plus Traefik is the primary production deployment target for the
current runtime surface. The repo-owned Dockerfiles and Compose workflow live
under `infra/docker/`; this document covers how those artifacts map onto a
production deployment.

## Build artifacts

- Web static output: `apps/web/dist/`
- API Node runtime entry: `apps/api/dist/server.js`
- Cube Trainer static output: `apps/cube-trainer/dist/`
- Auth app static output: `apps/auth/dist/`

`vite preview` is useful for local smoke testing of the built web app, but it
is not the production web server for `apps/web/dist/`,
`apps/cube-trainer/dist/`, or `apps/auth/dist/`.

## Default production topology

The default production shape is separate-origin:

- `https://site.example.com` -> web
- `https://api.example.com` -> api
- `https://cube.unimatrix-01.dev` -> cube-trainer
- `https://auth.unimatrix-01.dev` -> auth

In this shape:

- the web image is built with `VITE_API_BASE_URL=https://api.example.com`
- the API runtime allows the public web origin through `CORS_ALLOWED_ORIGINS`
- the cube-trainer image needs no build-time or runtime env; it has no API
  dependency
- the auth image is built with `VITE_API_BASE_URL=https://api.example.com` and
  `VITE_CLERK_PUBLISHABLE_KEY` for the shared Clerk application
- Traefik owns TLS termination and hostname routing

Same-origin deployment remains supported, but it is not the primary documented
path for now.

## Dokploy service layout

Create four Dokploy services from the same repository and the same `main`
branch, all using Dokploy's **Compose** application type (not the plain
Dockerfile application type).

### Web service

- application type: Compose
- compose path: `infra/docker/web-compose.yaml`
- environment variables (set in Dokploy's UI, not in the file):
  - `VITE_API_BASE_URL=https://api.example.com`
  - `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...` (optional) — enables the header
    sign-in affordance on the public site; leave unset to ship the site with no
    auth UI
  - `VITE_AUTH_APP_URL=https://auth.unimatrix-01.dev` (optional; this is the
    default) — where the "Sign in" link points
- Domains page: route `site.example.com` to the `web` service, container port
  `8080`

These `VITE_*` values are inlined into the bundle at **build** time, so they
must be present before the image builds (the compose file passes them as build
args). Setting `VITE_CLERK_PUBLISHABLE_KEY` only after the container is running
has no effect — the built bundle already decided whether auth is enabled, so a
rebuild/redeploy is required for the sign-in button to appear.

The web container is a static SPA container. Preserve SPA fallback behavior
inside the web container regardless of routing.

### API service

- application type: Compose
- compose path: `infra/docker/api-compose.yaml`
- Domains page: route `api.example.com` to the `api` service, container port
  `3001`
- health endpoint: `/health`

Required environment variable (set in Dokploy's UI):

```env
CORS_ALLOWED_ORIGINS=https://site.example.com,https://www.site.example.com
```

`HOST`, `PORT`, `NODE_ENV`, `LOG_LEVEL`, and `TRUST_PROXY=1` are already fixed
in `infra/docker/api-compose.yaml` for this deployment shape and don't need to
be set again in Dokploy.

**Persistent storage:** user settings and uploaded files are stored in SQLite,
so the API needs a durable volume or all user data is lost on redeploy.
`api-compose.yaml` already declares an `api-data` volume mounted at `/data`
(where the DB defaults to `/data/unimatrix.sqlite`) and sets
`DB_MIGRATE_ON_START=true`, so pending migrations are applied against that
volume automatically at container startup — no manual `db:migrate` step is
required in production. In Dokploy, confirm the volume is attached and mapped to
persistent host storage (Advanced → Volumes) so it survives redeploys.

Clerk auth is required in production: set `CLERK_SECRET_KEY`,
`CLERK_PUBLISHABLE_KEY`, and `CLERK_JWT_KEY` in Dokploy's UI (all three, never
just some). See "Clerk setup" below.

### Cube Trainer service

- application type: Compose
- compose path: `infra/docker/cube-trainer-compose.yaml`
- no environment variables required
- Domains page: route `cube.unimatrix-01.dev` to the `cube-trainer` service,
  container port `8080`

The cube-trainer container is a static SPA container, same shape as the web
service. Preserve SPA fallback behavior inside the container regardless of
routing. It has no API dependency, so it does not need an entry in
`CORS_ALLOWED_ORIGINS`.

### Auth service

- application type: Compose
- compose path: `infra/docker/auth-compose.yaml`
- environment variables (set in Dokploy's UI, not in the file):
  `VITE_API_BASE_URL=https://api.example.com`,
  `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`
- Domains page: route `auth.unimatrix-01.dev` to the `auth` service,
  container port `8080`

The auth container is a static SPA container, same shape as the web and
cube-trainer services. Preserve SPA fallback behavior inside the container
regardless of routing. It is the central Clerk-backed accounts app (landing,
sign-in/sign-up, and account management), so it needs `CORS_ALLOWED_ORIGINS` on
the API service to include
`https://auth.unimatrix-01.dev` if it calls the API directly from the browser.

## Traefik expectations

Traefik is the public edge proxy in Dokploy, and Dokploy's Domains page is the
source of truth for routing — it configures Traefik itself once you point a
service at a hostname and container port there. The repo does not ship
Traefik labels or a Traefik stack, and the compose files intentionally leave
Traefik config out for this reason.

Production routing still needs to satisfy:

- the public site hostname routes to the web service
- the API hostname routes to the API service
- the `cube.unimatrix-01.dev` hostname routes to the cube-trainer service
- the `auth.unimatrix-01.dev` hostname routes to the auth service
- TLS terminates at Traefik
- standard proxy headers are forwarded so the API can run with
  `TRUST_PROXY=1`

Because separate-origin is the default deployment shape, Traefik does not need
to rewrite `/api` paths in the primary production setup.

## Web configuration

- `apps/web/.env.production.example` shows the checked-in separate-origin
  example: `https://api.unimatrix-01.dev`
- if `omnimatrix.dev` becomes the public hostname later, replace that example
  with the new public API origin
- same-origin deployments can keep the default relative `/api` value, but that
  path is secondary to the separate-origin deployment described here

## Clerk setup

Clerk is a single shared application across every Unimatrix service, with
primary domain `unimatrix-01.dev`. Sessions are shared across all subdomains
(`auth.`, `api.`, `cube.`, and the apex), so **no satellite domains are
needed**.

A human needs to do the following once in the Clerk Dashboard:

1. Under **Configure → Sessions → "Customize session token"**, add a claim
   `"permissions": "{{user.public_metadata.permissions}}"` so the API can
   verify permissions networklessly from the session token.
2. Set the backend env (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
   `CLERK_JWT_KEY`) on the API service, and the frontend env
   (`VITE_CLERK_PUBLISHABLE_KEY`) on the web and auth services.
3. Bootstrap the first platform administrator by setting that user's
   `publicMetadata` to `{ "permissions": { "auth": ["admin"] } }` directly in
   the Dashboard — there is no public "become admin" flow.

See `packages/auth/README.md` for the exact steps and the full permission
scheme.

## API configuration

- Start the compiled runtime with `node apps/api/dist/server.js`
- `CORS_ALLOWED_ORIGINS` accepts a comma-separated list of exact origins such
  as `https://site.example.com` and wildcard subdomain origins such as
  `https://*.example.com`
- wildcard rules match subdomains only; they do not match the apex domain, so
  the apex must also be listed explicitly
- if `CORS_ALLOWED_ORIGINS` is unset, the API uses repo defaults:
  - `https://unimatrix-01.dev`
  - `https://*.unimatrix-01.dev`
  - `https://omnimatrix.dev`
  - `https://*.omnimatrix.dev`
  - `http://localhost:5173`
  - `http://127.0.0.1:5173`
  - `http://localhost:4173`
  - `http://127.0.0.1:4173`
- if `CORS_ALLOWED_ORIGINS` is set, it fully replaces those defaults
- API CORS stays intentionally narrow: no credentials; browser methods are
  `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, and `DELETE` (the writes are needed by
  the user-data endpoints); the `authorization` header is allowed
  (needed for Clerk-authenticated requests); and `x-request-id` is exposed to
  browser clients
- `apps/api/.env.production.example` shows the checked-in production env
  template, including `MAX_UPLOAD_BYTES` (per-request file upload size limit
  for the user-data file endpoints; defaults to 5 MiB when unset)

## Auto-updates from `main`

Enable automatic Dokploy redeploys from the repository `main` branch for all
four services, using service-specific watch paths. This avoids rebuilding every
service for an unrelated monorepo change while still rebuilding when its image
inputs change.

Each live app owns the canonical list for its Dokploy service:

- `apps/web/README.md`
- `apps/api/README.md`
- `apps/cube-trainer/README.md`
- `apps/auth/README.md`

Copy each list exactly into that service's Dokploy watch-path configuration.
The lists include the app directory, directly imported workspace packages,
shared root pnpm manifests, and the service-specific Compose file. When an app
adds a workspace dependency, new bundled content, or another Docker build
input, update its README and Dokploy configuration in the same change.

Traefik continues to route to the latest healthy service revision managed by
Dokploy.

## Pull request preview deployments

Previews are entirely Dokploy-side. **Nothing in this repository is required**
— no workflow, no secret, no token, no permission change. The Dokploy GitHub
App's installation token drives the webhook, the build, the PR comment, and
the teardown.

Nothing here has been verified against the live Dokploy instance; every claim
below is read from Dokploy's schema and handlers, and the current values of
these settings live in Dokploy's database rather than in this repo.

### Previews need Application services, not the existing Compose apps

The four `infra/docker/*-compose.yaml` files run as Dokploy **Compose** apps,
and Dokploy has no preview support for that service type: all thirteen
`preview*` columns live on `applications`, and `compose` has none of them.
This is not a configuration gap that can be filled in — the fields do not
exist on the record.

So a previewable app needs a **second** Dokploy service alongside its
production Compose app, of type Application, reusing the same Dockerfile
unchanged:

- Build type: `Dockerfile`
- Dockerfile path: `apps/web/Dockerfile` / `apps/cube-trainer/Dockerfile`
- Docker context path: `.` — the repo root, matching the build rule in
  `infra/docker/README.md`
- Preview port: **8080**

### Settings whose defaults are wrong for this repo

| Setting | Dokploy default | Needs to be | Why |
| --- | --- | --- | --- |
| `previewPort` | `3000` | `8080` | Both previewable images serve on 8080. Leaving the default produces a domain that resolves and then dead-ends. |
| `previewHttps` | `false` | `true` | An `http://` preview origin is rejected by the API's CORS rule, and `safe-redirect.ts` requires `protocol === "https:"`. With HTTPS on, the existing `https://*.unimatrix-01.dev` CORS entry already matches preview hosts, so no repo change is needed. |
| `previewCertificateType` | `"none"` | issue certs | TLS is not automatic. Needs either per-host Let's Encrypt or a wildcard cert covering the preview domain. |
| `isPreviewDeploymentsActive` | `false` | `true` | Off until switched on per application. |

### Two behaviours that are invisible from the UI

- **Watch paths do not apply to pull requests.** The `push` handler filters by
  watch path; the `pull_request` handler does not. Every PR against `main`
  rebuilds every previewable app — a docs-only PR triggers two full repo-root
  `pnpm install --frozen-lockfile` plus workspace builds and posts two bot
  comments. If that is too much load, the throttle is the preview **label**
  gate. Note its sharp edge: labels gate creation and rebuild only. Removing
  the label does **not** tear an existing preview down, so it is not a kill
  switch.
- **`previewLimit` (default 3) fails silently.** Exceeding it skips the
  deployment with no PR comment and no error, so a missing preview is not
  evidence that something broke.

Preview target-branch matching uses `pull_request.base.ref`, so only PRs
targeting `main` produce previews. Teardown is automatic on PR `closed`, which
covers merges.

### Fork PRs

Two independent barriers, which matters because this repo is public:

1. `previewRequireCollaboratorPermissions` defaults to `true`, so only
   write/maintain/admin actors pass.
2. The clone runs `git clone --branch <pull_request.head.ref>` against the
   **base** repo, where a fork's head branch does not exist — so a fork
   preview would fail at clone even with the gate disabled.

Dokploy's own documentation still recommends against preview deployments on
public repositories, on the grounds that external contributors can trigger
builds on your server. The gate above is what makes that recommendation
survivable here, so do not disable it.

### Which apps to preview

- **`apps/cube-trainer`** — the clean case. No build args, no backend, no env;
  progress lives in `localStorage`.
- **`apps/web`** — point previews at the production API and leave
  `VITE_CLERK_PUBLISHABLE_KEY` unset so previews stay anonymous.
- **`apps/auth`** — **do not preview.** Not for secret exposure:
  `VITE_CLERK_PUBLISHABLE_KEY` is public by design and `CLERK_SECRET_KEY`
  never enters the auth image (it is API-only). The real reason is that
  previewing auth means adding ephemeral hostnames to the production Clerk
  instance's allowed origins and redirect URLs — and any HTTPS preview host
  under `unimatrix-01.dev` then becomes a valid post-authentication redirect
  target for real user sessions.

### What to click in Dokploy

1. Install the Dokploy GitHub App on the `unimatrixcore` org and grant it
   access to `unimatrix-01`.
2. Create a new **Application** service for `apps/web` (alongside, not
   replacing, the existing Compose app). Set build type Dockerfile, Dockerfile
   path `apps/web/Dockerfile`, context path `.`.
3. Repeat for `apps/cube-trainer` with `apps/cube-trainer/Dockerfile`.
4. On each, open Preview Settings and enable preview deployments.
5. Set Preview Port to `8080` on both — the default of 3000 is wrong here.
6. Enable Preview HTTPS and choose a certificate type. This is required, not
   cosmetic: an `http://` preview origin fails the API's CORS check.
7. Set the preview wildcard domain, and confirm DNS resolves it to the server
   (a wildcard `A`/`CNAME` under `unimatrix-01.dev`).
8. Leave "require collaborator permissions" enabled.
9. Set `previewLimit` deliberately — the default of 3 skips silently once
   exceeded.
10. For `apps/web`, set preview build args to the production
    `VITE_API_BASE_URL` and leave `VITE_CLERK_PUBLISHABLE_KEY` unset.
11. Optionally add a `preview` label gate if per-PR build load is a problem.

## Verification after deploy

Verify these URLs after each production rollout:

- `https://site.example.com/`
- `https://site.example.com/about`
- `https://site.example.com/blog`
- `https://site.example.com/projects`
- `https://api.example.com/health`
- `https://cube.unimatrix-01.dev/`
- `https://cube.unimatrix-01.dev/learn`
- `https://cube.unimatrix-01.dev/drill`
- `https://auth.unimatrix-01.dev/`
- `https://auth.unimatrix-01.dev/sign-in`
- `https://auth.unimatrix-01.dev/account`

Also verify that refreshing a deep route on the public site, cube-trainer, or
the auth app still renders the SPA instead of returning a proxy or
static-host 404.

## SPA routing

The production web host must fall back to `index.html` for unknown application
routes so the client-side router can resolve SPA paths after the initial
request.

## Troubleshooting

- **`Nixpacks build failed` / `Failed to read app source directory / Not a directory`**:
  the Dokploy service was created as the default **Application** type, which
  auto-detects a builder (Nixpacks) and cannot build this pnpm monorepo. Every
  service here must be a **Compose** application pointing at its
  `infra/docker/*-compose.yaml` file (see the per-service sections above), which
  builds the app's `Dockerfile` with the repo root as the build context. Recreate
  the service as a Compose application rather than editing the Nixpacks one.
- **Build args resolve to empty** (e.g. a blank `VITE_CLERK_PUBLISHABLE_KEY` or
  `VITE_API_BASE_URL` baked into the bundle): the compose files pass these through
  as `${VAR}` build args, so they must be set in the Dokploy service's environment
  before the build runs — Vite inlines them at build time, not runtime.
- **New service has no compose file / app on the deploy branch**: `apps/auth` and
  `infra/docker/auth-compose.yaml` only exist once the auth feature branch is
  merged to `main`. Point the service at the feature branch to deploy before merge.

## Related docs

- `infra/docker/README.md`: Dockerfiles, Compose, and manual container workflow
- `infra/deployment/README.md`: Dokploy plus Traefik production guidance
