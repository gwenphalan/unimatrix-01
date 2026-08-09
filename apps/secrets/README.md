# Secrets service

The secrets service is a Fastify service deployed from `apps/secrets/Dockerfile`
through `infra/docker/secrets-compose.yaml`. It ships only `/health` — no
route in this workspace serves a secret value.

Every request except `GET /health` carries a bearer service token or is
answered 401, including a request to a URL matching no route. Reaching this
service over the network is not authorization.

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

## Issuing a service token

Tokens are minted by a host-local CLI rather than a route — a minting endpoint
would need a credential of its own to protect it. Issuance needs the database
but never `SECRETS_KEKS`.

Locally:

    pnpm --filter @unimatrix/secrets-app run token \
      issue --name api --scope github --capability read

In the container, against the live volume:

    docker exec <container> node dist/cli/service-token.js \
      issue --name api --scope github --capability read

`--capability` has no default: `read` may fetch values under its scope,
`manage` may create, rotate and delete but never read one back. The two are
mutually exclusive, so a consumer needing both takes two tokens.

The plaintext is printed once and only its SHA-256 digest is stored, so a lost
token is reissued rather than recovered. `list` shows every token with its
scope, capability and revocation state; `revoke --name <name>` retires one.
