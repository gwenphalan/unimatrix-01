# CFLOP service

CFLOP is a static Vite SPA deployed from `apps/cflop/Dockerfile`
through `infra/docker/cflop-compose.yaml`.

## Dokploy redeploy watch paths

Configure the CFLOP Dokploy service to watch these repository paths. A
change to any of them can change the built browser bundle or its container:

```text
apps/cflop/**
packages/chrome/**
packages/config-typescript/**
packages/ui/**
infra/docker/cflop-compose.yaml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.dockerignore
```

`apps/cflop/**` includes its Dockerfile and Nginx configuration, and its own
`package.json` and `tsconfig.json`. The trainer resolves `@unimatrix/ui` and
`@unimatrix/chrome` from workspace source, and the root workspace files control
the frozen pnpm install used by the Docker build.

`packages/chrome/**` is on the list because `app-shell.tsx` imports
`@unimatrix/chrome/tool`. Omitting it leaves a tool-shell change rebuilding
`apps/admin` and not this app, so the two serve different chrome with nothing to
indicate it. `@unimatrix/e2e-helpers` stays off the list deliberately: it is
imported only from `e2e/`, so it cannot change the built bundle.

When adding a workspace dependency or another build input, add its path here
and to the Dokploy service's watch-path configuration. See
[`docs/deployment.md`](../../docs/deployment.md) for the
repository-wide convention.

Watch paths apply to `push` events only. Dokploy's pull request handler does
not filter by them, so if preview deployments are enabled, every PR against
`main` rebuilds this app regardless of what it touched — including a
docs-only PR.
