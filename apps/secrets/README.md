# Secrets service

The secrets service is a Fastify service deployed from `apps/secrets/Dockerfile`
through `infra/docker/secrets-compose.yaml`. It ships only `/health` — no
route in this workspace serves a secret value.

## Dokploy redeploy watch paths

Configure the secrets Dokploy service to watch these repository paths. A
change to any of them can change the service image or its runtime behavior:

```text
apps/secrets/**
packages/secrets/**
packages/shared/**
packages/config-typescript/**
infra/docker/secrets-compose.yaml
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.dockerignore
```

`apps/secrets/**` includes its Dockerfile and Drizzle migrations. The shared
package paths are this service's workspace dependencies; note the absence of
`packages/db/**` — this service owns its own Drizzle schema and migration set
and never depends on that package. The root workspace files control the
frozen pnpm install used by the Docker build.

When adding a workspace dependency or another build input, add its path here
and to the Dokploy service's watch-path configuration. See
[`docs/deployment.md`](../../docs/deployment.md) for the
repository-wide convention.

## Local development

Requires a KEK — the service refuses to start without one. There is no `.env`
file support here (unlike `apps/api`): loading one would put a plaintext KEK
on a developer's disk, the exact artifact this service exists to avoid
multiplying. Supply `SECRETS_KEKS` on the command line instead:

    SECRETS_KEKS=1:$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))") \
      pnpm --filter @unimatrix/secrets-app dev

Migrations run out-of-band in dev, same as `packages/db`:

    pnpm --filter @unimatrix/secrets-app db:migrate

`DB_MIGRATE_ON_START=true` applies pending migrations at boot instead — the
production default (see `infra/docker/secrets-compose.yaml`).
