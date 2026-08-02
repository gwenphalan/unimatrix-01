# Deployment

Dokploy plus Traefik is the primary production deployment target for the
current runtime surface. The repo-owned Dockerfiles and Compose workflow live
under `infra/docker/`; this document covers how those artifacts map onto a
production deployment.

`vite preview` is useful for local smoke testing of the built web app, but it
is not the production web server for `apps/web/dist/`,
`apps/cflop/dist/`, or `apps/auth/dist/`.

## Default production topology

The default production shape is separate-origin:

- `https://site.example.com` -> web
- `https://api.example.com` -> api
- `https://cflop.unimatrix-01.dev` -> cflop
- `https://cube.unimatrix-01.dev` -> 301 to `cflop.unimatrix-01.dev`
  (pre-rebrand hostname; see "CFLOP service" below)
- `https://auth.unimatrix-01.dev` -> auth

In this shape:

- the web image is built with `VITE_API_BASE_URL=https://api.example.com`
- the API runtime allows the public web origin through `CORS_ALLOWED_ORIGINS`
- the cflop image needs no build-time or runtime env; it has no API
  dependency
- the auth image is built with `VITE_API_BASE_URL=https://api.example.com` and
  `VITE_CLERK_PUBLISHABLE_KEY` for the shared Clerk application
- Traefik owns TLS termination and hostname routing

## Dokploy service layout

Create one Dokploy service per `infra/docker/*-compose.yaml`, all from the same
repository and the same `main` branch, all using Dokploy's **Compose**
application type (not the plain Dockerfile application type).

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

### CFLOP service

- application type: Compose
- compose path: `infra/docker/cflop-compose.yaml`
- no environment variables required
- Domains page: route `cflop.unimatrix-01.dev` to the `cflop` service,
  container port `8080`

Unlike the web service, the cflop container serves one HTML file per route and
answers an unknown path with a real 404. Do not add a catch-all in Dokploy or
Traefik that routes every path to the app: it would reinstate the soft 404 from
outside the container, where `infra/scripts/check-cflop-serving.sh` cannot see
it and the only symptom is unknown URLs quietly returning 200 again. The web
service keeps its SPA fallback (`apps/web/nginx.conf`) and is right to — it has
no per-route files to serve instead.

cflop has no API dependency, so it does not need an entry in
`CORS_ALLOWED_ORIGINS`.

#### The pre-rebrand `cube.` hostname

`cube.unimatrix-01.dev` is the tool's pre-rebrand hostname and still has users
and links pointing at it. It permanently 301s to `cflop.unimatrix-01.dev` with
the path and query string preserved.

The redirect lives in Traefik on the Dokploy host, across two surfaces. Nothing
in this repository configures either one, so if the Dokploy service is recreated
from scratch both have to be re-added by hand — neither CI nor the image will
notice they are gone, and the only symptom is `cube.` quietly serving the app
again:

- `/etc/dokploy/traefik/dynamic/middlewares.yml` defines `cube-to-cflop`, a
  `redirectRegex` with `permanent: true`, alongside the `redirect-to-https` that
  Dokploy ships.
- the Dokploy domain record for `cube.unimatrix-01.dev` carries
  `middlewares: ["cube-to-cflop@file"]`. The `@file` suffix is load-bearing: the
  router is generated by Dokploy's docker provider, and an unqualified middleware
  name resolves inside the router's own provider, where this one does not exist.
  Dokploy appends `@file` itself only to the `redirect-to-https` it injects.

That domain record also has to keep pointing at a live service and terminating
TLS, or the redirect is never reached — a hostname Traefik has no router for
answers `526` through the proxy, indistinguishable from one that does not exist.
The middleware is attached to the websecure router only, so `http://cube.…`
takes two hops: `redirect-to-https@file`, then the redirect.

A Cloudflare Redirect Rule would also work, and was not chosen. There is no
per-host `cube.` or `cflop.` DNS record — both are served by the proxied
`*.unimatrix-01.dev` wildcard, and Redirect Rules only execute on proxied
traffic. Flipping that one wildcard to DNS-only would stop the rule firing with
no error anywhere. Traefik sits below that switch. Nginx-in-the-container was the
other candidate and would have been repo-owned, which is a real advantage; the
trade accepted here is that the redirect lives on the host instead, invisible to
anyone reading this repository.

#### Progress saved under the old hostname is unreachable

`localStorage` is partitioned by origin, so whatever a visitor accumulated under
`https://cube.unimatrix-01.dev` cannot be read from `https://cflop.unimatrix-01.dev`.
`apps/cflop/src/lib/local-storage.ts` falls back from the `cflop:` key prefix to
`cube-trainer:`, which covers the key rename within one origin and does nothing
across two. The old data is not deleted — a one-time hand-off page served at
`cube.` could still recover it — but until something does that, a redirected
visitor arrives with an empty profile.

### Auth service

- application type: Compose
- compose path: `infra/docker/auth-compose.yaml`
- environment variables (set in Dokploy's UI, not in the file):
  `VITE_API_BASE_URL=https://api.example.com`,
  `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...`
- Domains page: route `auth.unimatrix-01.dev` to the `auth` service,
  container port `8080`

The auth container is a static SPA container, same shape as the web and
cflop services. Preserve SPA fallback behavior inside the container
regardless of routing. It is the central Clerk-backed accounts app (landing,
sign-in/sign-up, and account management), so it needs `CORS_ALLOWED_ORIGINS` on
the API service to include
`https://auth.unimatrix-01.dev` if it calls the API directly from the browser.

### Admin service

- application type: Compose
- compose path: `infra/docker/admin-compose.yaml`
- environment variables (set in Dokploy's UI, not in the file):
  `VITE_CLERK_PUBLISHABLE_KEY=pk_live_...` (required — `loadAdminAppRuntimeConfig`
  throws without it, so a keyless image fails loudly in the browser),
  `VITE_API_BASE_URL=https://api.example.com`, and optionally
  `VITE_AUTH_APP_URL` (defaults to `https://auth.unimatrix-01.dev`)
- Domains page: route `admin.unimatrix-01.dev` to the `admin` service,
  container port `8080`

Access control is Cloudflare Access on the proxied hostname, not app code —
`curl https://admin.unimatrix-01.dev/` returns a 302 to
`unimatrix-01.cloudflareaccess.com`. That is what makes the scaffold's ungated
placeholder route safe; see `apps/admin/AGENTS.md`.

## Traefik expectations

Traefik is the public edge proxy in Dokploy, and Dokploy's Domains page is the
source of truth for routing — it configures Traefik itself once you point a
service at a hostname and container port there. The repo does not ship
Traefik labels or a Traefik stack, and the compose files intentionally leave
Traefik config out for this reason.

Production routing still needs to satisfy:

- the public site hostname routes to the web service
- the API hostname routes to the API service
- the `cflop.unimatrix-01.dev` hostname routes to the cflop service
- the `cube.unimatrix-01.dev` hostname 301s to `cflop.unimatrix-01.dev` via a
  Traefik middleware, and still terminates TLS so the redirect is reachable
- the `auth.unimatrix-01.dev` hostname routes to the auth service
- TLS terminates at Traefik
- standard proxy headers are forwarded so the API can run with
  `TRUST_PROXY=1`

Because separate-origin is the default deployment shape, Traefik does not need
to rewrite `/api` paths in the primary production setup.

## Web configuration

- `apps/web/.env.production.example` shows the checked-in separate-origin
  example: `https://api.unimatrix-01.dev`
- same-origin deployments can keep the default relative `/api` value, but that
  path is secondary to the separate-origin deployment described here

## Clerk setup

Clerk is a single shared application across every Unimatrix service, with
primary domain `unimatrix-01.dev`. Sessions are shared across all subdomains
(`auth.`, `api.`, `cflop.`, and the apex), so **no satellite domains are
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
- if `CORS_ALLOWED_ORIGINS` is unset, the API falls back to
  `DEFAULT_API_CORS_ALLOWED_ORIGINS` in `apps/api/src/config.ts`, which includes
  local development origins — set it explicitly in production

## Auto-updates from `main`

Enable automatic Dokploy redeploys from the repository `main` branch for every
service, using service-specific watch paths. This avoids rebuilding every
service for an unrelated monorepo change while still rebuilding when its image
inputs change.

Each live app owns the canonical list for its Dokploy service:

- `apps/web/README.md`
- `apps/api/README.md`
- `apps/cflop/README.md`
- `apps/auth/README.md`
- `apps/admin/README.md`

Copy each list exactly into that service's Dokploy watch-path configuration.
The lists include the app directory, directly imported workspace packages,
shared root pnpm manifests, and the service-specific Compose file. When an app
adds a workspace dependency, new bundled content, or another Docker build
input, update its README and Dokploy configuration in the same change.

## Pull request preview deployments

Previews are entirely Dokploy-side. **Nothing in this repository is required**
— no workflow, no secret, no token, no permission change. The Dokploy GitHub
App's installation token drives the webhook, the build, the PR comment, and
the teardown.

The setting defaults below were verified on 2026-07-27 against
`packages/server/src/db/schema/application.ts` on Dokploy `canary`, against
Dokploy issue #2028 for the Compose limitation (open, unassigned, no linked PR,
opened 2025-06-11), and then against the live instance: creating an application
over the API returns `previewPort: 3000`, `previewHttps: false`,
`previewCertificateType: "none"`, `previewLimit: 3`, and
`isPreviewDeploymentsActive: false` on the fresh record.

The `web-preview` and `cflop-preview` services live in the `Unimatrix-01`
project's `production` environment, configured as below. Their settings live in
Dokploy's database rather than in this repo, so this document describes intent —
read the instance, not this file, when the two disagree.

> **Previews do not currently work, and the cause is upstream.** The services
> are configured correctly but no preview has ever built. On Dokploy v0.29.13,
> a `pull_request` webhook for `synchronize`/`reopened` gets as far as
> `✅ SECURITY: Preview deployment authorized ... Permission: admin` and then
> dies with `TRPCError: Github Account not configured correctly`
> (`code: NOT_FOUND`) from `apps/dokploy/pages/api/deploy/github`, returning
> HTTP 500 to GitHub. `push`, `opened`, and `closed` deliveries return 200.
>
> The credentials are **not** actually missing: the same provider record clones
> fine for every production Compose service, and `authGithub` succeeds
> earlier in that very request — it is what emits the SECURITY line. A second
> provider lookup later in the preview path resolves to nothing. Ruled out by
> testing: webhook signature, `previewWildcard` format (the `*.` prefix is
> required, not wrong), `previewCertificateType`, `previewBuildArgs`, and
> git-provider ownership/sharing.
>
> Do **not** "fix" this by recreating the GitHub provider — that would re-point
> every production service for no reason. Next step is a Dokploy upgrade
> past v0.29.13 and, failing that, an upstream bug report.

### Previews need Application services, not the existing Compose apps

The `infra/docker/*-compose.yaml` files run as Dokploy **Compose** apps,
and Dokploy has no preview support for that service type: all thirteen
`preview*` columns live on `applications`, and `compose` has none of them.
This is not a configuration gap that can be filled in — the fields do not
exist on the record.

So a previewable app needs a **second** Dokploy service alongside its
production Compose app, of type Application, reusing the same Dockerfile
unchanged:

- Build type: `Dockerfile`
- Dockerfile path: `apps/web/Dockerfile` / `apps/cflop/Dockerfile`
- Docker context path: `.` — the repo root, matching the build rule in
  `infra/docker/README.md`
- Preview port: **8080**

### Settings whose defaults are wrong for this repo

Defaults quoted verbatim from the schema (see the verification note above).

| Setting | Dokploy default | Needs to be | Why |
| --- | --- | --- | --- |
| `previewPort` | `.default(3000)` | `8080` | Both previewable images serve on 8080 (`listen 8080` in every `apps/*/nginx.conf`). Leaving the default produces a domain that resolves and then dead-ends. |
| `previewHttps` | `.notNull().default(false)` | `true` | An `http://` preview origin is rejected by the API's CORS rule — every entry in `DEFAULT_API_CORS_ALLOWED_ORIGINS` (`apps/api/src/config.ts:5`) is scheme-qualified `https://` for the public domains. With HTTPS on, the existing `https://*.unimatrix-01.dev` entry already matches preview hosts, so no repo change is needed. |
| `previewCertificateType` | `.notNull().default("none")` | issue certs | TLS is not automatic. Needs either per-host Let's Encrypt or a wildcard cert covering the preview domain. |
| `isPreviewDeploymentsActive` | `.default(false)` | `true` | Off until switched on per application. |
| `previewRequireCollaboratorPermissions` | `.default(true)` | leave `true` | The public-repo guard. See "Fork PRs" below. |

`apps/auth/src/features/auth/safe-redirect.ts:28` also requires
`protocol === "https:"` for any `unimatrix-01.dev` host, but that is the auth
app, which is deliberately not previewed — it is not what forces `previewHttps`
here. The CORS rule is.

### The preview domain is a prerequisite, not polish

Dokploy's default preview domain is an auto-generated `*.traefik.me` host. For
`apps/web` that is not a cosmetic choice: a `.traefik.me` origin matches no
entry in `DEFAULT_API_CORS_ALLOWED_ORIGINS`, so the preview loads and then
fails every API call. A half-working preview is worse than a broken one.

Set `previewWildcard` to a wildcard under `unimatrix-01.dev` (e.g.
`*.preview.unimatrix-01.dev`) and point a wildcard `A`/`CNAME` record at the
Dokploy server before enabling previews. `apps/cflop` would survive the
default (no API dependency), but there is no reason to split them.

### Three behaviours that are invisible from the UI

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
- **Web previews run the new frontend against the *production* API.** Only web
  and cflop are previewed, and web's preview build arg points
  `VITE_API_BASE_URL` at the live API. A PR that changes both `apps/web` and
  `apps/api` therefore previews the new UI against the old backend: a contract
  change can look broken in preview when it is fine, and — the dangerous
  direction — can look fine when it is not.

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

- **`apps/cflop`** — the clean case. No build args, no backend, no env;
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
3. Repeat for `apps/cflop` with `apps/cflop/Dockerfile`.
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

### Doing it over the API instead of the UI

Every *Dokploy-side* step above is reachable through its REST API, so the
service creation and preview configuration can be scripted or handed to an
agent rather than clicked — that is how the current services were created. The
two prerequisites that live outside Dokploy are not scriptable with a key; see
below. Generate a key under Settings -> Profile (API/CLI section); it is sent
as an `x-api-key` header.

Two things that cost time when scripting it:

- **`/api/openapi.json` returns 404 on this instance.** Swagger is restricted to
  authenticated administrators by default, so the machine-readable field list is
  not available to a key alone. Discover shapes from validation errors instead —
  a `400` returns a `zodError.fieldErrors` map naming exactly what is missing.
- **`application.saveBuildType` requires `herokuVersion` and `railpackVersion`**
  even for a Dockerfile build. They are non-optional but nullable, so pass
  `null`. Omitting them fails with
  `"expected nonoptional, received undefined"`.

The relevant endpoints are `POST /api/application.create` (needs `name` and
`environmentId` — read the latter from `project.all`),
`POST /api/application.saveGithubProvider`, `POST /api/application.saveBuildType`,
`POST /api/application.update`, and `POST /api/application.deploy`. Every
preview column is writable through `application.update`:
`isPreviewDeploymentsActive`, `previewPort`, `previewHttps`, `previewWildcard`,
`previewLimit`, `previewCertificateType` (`"letsencrypt" | "none" | "custom"`),
`previewRequireCollaboratorPermissions`, `previewBuildArgs`, plus `previewEnv`,
`previewBuildSecrets`, `previewLabels`, `previewPath`, and
`previewCustomCertResolver`.

Two things this does not remove: installing the GitHub App is an OAuth consent
flow that cannot be done with the key, and the wildcard DNS record lives at the
registrar.

Treat the key accordingly. It is a bearer credential with no scoping and no
expiry, granting instance-wide administrative control: it can create, mutate,
and delete every application on the Dokploy instance — not only this project's
— and trigger builds. Since a build runs a Dockerfile of the holder's choosing
on the host, treat that reach as host-level in practice even though the key
itself is not an OS credential. Issue one for the task, keep it out of the repo
and out of CI, and revoke it when the setup is done.

## Verification after deploy

Verify these URLs after each production rollout:

- `https://site.example.com/`
- `https://site.example.com/about`
- `https://site.example.com/blog`
- `https://site.example.com/projects`
- `https://api.example.com/health`
- `https://cflop.unimatrix-01.dev/`
- `https://cflop.unimatrix-01.dev/learn`
- `https://cflop.unimatrix-01.dev/drill`
- `https://cube.unimatrix-01.dev/learn` — must 301 to
  `https://cflop.unimatrix-01.dev/learn`, preserving the path
- `https://auth.unimatrix-01.dev/`
- `https://auth.unimatrix-01.dev/sign-in`
- `https://auth.unimatrix-01.dev/account`

Also verify that refreshing a deep route on the public site, cflop, or
the auth app still renders the SPA instead of returning a proxy or
static-host 404.

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
