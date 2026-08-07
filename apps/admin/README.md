# Admin console

The administration console is a Vite SPA built from `apps/admin/Dockerfile`
and served by nginx on port 8080, matching the other three static apps.

Content is the first built section — the blog/project CMS, moved here from
`apps/web` — on `@unimatrix/chrome`'s tool shell; the other six section routes
are still placeholders. It is deployed and reachable:
`infra/docker/admin-compose.yaml` is the Dokploy Compose file, and
`admin.unimatrix-01.dev` sits behind Cloudflare Access, which is what makes the
ungated placeholder routes safe.

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
packages/api-client/**
packages/app-config/**
packages/auth/**
packages/chrome/**
packages/config-typescript/**
packages/shared/**
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
[`docs/deployment.md`](../../docs/deployment.md) for the
repository-wide convention.

## Security headers

`nginx.conf` ships a deliberately tighter policy than `apps/web` — this app
renders no user-authored markdown, so it needs less room. Its `add_header`
lines are the policy the app actually sends.

`default-src`, `script-src` and `connect-src` are absent on purpose. Clerk
loads `clerk.browser.js` from its frontend-API host and avatars from
`img.clerk.com`; that host is baked into the bundle at build time and a static
nginx conf cannot name it. Tightening further means templating the conf
(nginx's `envsubst` entrypoint) from the same build arg, not guessing.
