# Admin console

The administration console is a Vite SPA built from `apps/admin/Dockerfile`
and served by nginx on port 8080, matching the other three static apps.

It is scaffold-only today: one placeholder route on `@unimatrix/chrome`'s tool
shell. It is nonetheless deployed and reachable: `infra/docker/admin-compose.yaml`
is the Dokploy Compose file, and `admin.unimatrix-01.dev` sits behind Cloudflare
Access, which is what makes the ungated placeholder route safe.

## Build arguments

Vite inlines `import.meta.env.VITE_*` at build time, so these are build args
rather than runtime env — setting them on the running container does nothing.

| Build arg                     | Required | Default                          |
| ----------------------------- | -------- | -------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY`  | yes      | none — the app throws without it |
| `VITE_API_BASE_URL`           | no       | `/api`                           |
| `VITE_AUTH_APP_URL`           | no       | `https://auth.unimatrix-01.dev`  |

## Dokploy redeploy watch paths

Configure the admin Dokploy service to watch these repository paths. A change
to any of them can change the built browser bundle or its container:

```text
apps/admin/**
packages/app-config/**
packages/auth/**
packages/chrome/**
packages/config-typescript/**
packages/ui/**
infra/docker/admin-compose.yaml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.dockerignore
```

`apps/admin/**` includes its Dockerfile and nginx configuration. The app
imports source directly from the listed workspace packages, and the root
workspace files control the frozen pnpm install used by the Docker build.

When adding a workspace dependency or another build input, add its path here
and to the Dokploy service's watch-path configuration. See
[`infra/deployment/README.md`](../../infra/deployment/README.md) for the
repository-wide convention.

## Security headers

`nginx.conf` ships a deliberately tighter policy than `apps/web` — this app
renders no user-authored markdown, so it needs less room:

```text
Content-Security-Policy: frame-ancestors 'self'; base-uri 'none'; object-src 'none'; form-action 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

`default-src`, `script-src` and `connect-src` are absent on purpose. Clerk
loads `clerk.browser.js` from its frontend-API host and avatars from
`img.clerk.com`; that host is baked into the bundle at build time and a static
nginx conf cannot name it. Tightening further means templating the conf
(nginx's `envsubst` entrypoint) from the same build arg, not guessing.
