# Secrets service

The secrets service is a Fastify service deployed from `apps/secrets/Dockerfile`
through `infra/docker/secrets-compose.yaml`.

Every request except `GET /health` carries a bearer service token or is
answered 401, including a request to a URL matching no route. Reaching this
service over the network is not authorization.

| Route | Capability | Returns |
| --- | --- | --- |
| `GET /secrets/value` | `read` | The decrypted value for one in-scope name — the only route anywhere in this service that returns one |
| `GET /secrets` | `manage` | Metadata (masked prefix, KEK version, timestamps) for every in-scope name |
| `POST /secrets` | `manage` | Metadata for a newly created secret |
| `POST /secrets/rotate` | `manage` | Metadata for a freshly sealed version of an existing secret |
| `DELETE /secrets` | `manage` | `{ affected: <count> }`; denies the whole request if any submitted name is out of scope or absent |

A caller's token scope also governs every route above: a name reaches a route only when the
token's `scopePrefix` covers it (`src/service-tokens/scope.ts`). Every denial — wrong capability,
out-of-scope name, absent name — comes back the same 404, so none of the three is distinguishable
from outside.

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
multiplying. Supply `SECRETS_KEKS` on the command line instead, generating the
key with `kek generate` (see "Managing the KEK ring" below):

    SECRETS_KEKS=1:$(pnpm --filter @unimatrix/secrets-app exec tsx src/cli/kek.ts generate | head -1 | cut -d: -f2) \
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

## Managing the KEK ring

Two more host-local CLIs sit beside `service-token`, both under `src/cli/`
and neither taking a `--kek` flag — `docker exec` already inherits
`SECRETS_KEKS`, and argv is world-readable on the host.

Locally:

    pnpm --filter @unimatrix/secrets-app exec tsx src/cli/kek.ts generate
    pnpm --filter @unimatrix/secrets-app exec tsx src/cli/kek.ts verify --expect-active <n>
    pnpm --filter @unimatrix/secrets-app exec tsx src/cli/kek.ts rotate --to-version <n>

In the container, against the live volume:

    docker exec <container> node dist/cli/kek.js generate
    docker exec <container> node dist/cli/kek.js verify --expect-active <n>
    docker exec <container> node dist/cli/kek.js rotate --to-version <n>

`generate [--version <n>]` prints one `<version>:<key>` entry — never the rest
of the ring — to prepend to `SECRETS_KEKS`, bounded to versions 1-9999 and
refusing one already in a loaded ring or not greater than its active version.
`verify --expect-active <n>` and `rotate --to-version <n>` both require the
flag and both refuse outright when `n` does not match `SECRETS_KEKS`'s actual
active version — the version a stale redeploy still carries is caught before
either command trusts it. `verify` censuses every `secret_versions` row from
the envelope's own KEK version field, proves each one opens under a key the
loaded ring carries, and exits non-zero if any row sits outside the active
version even when every row opens; it also records a `kek.verified` audit
row. `rotate` re-seals every row — live and superseded — under the active
version, refuses to run when the ring holds only one version or when any
row's version is missing from the ring, and is resumable: a row already
sealed under the active version is left alone. See
[`docs/deployment.md`](../../docs/deployment.md) for the full rotation
runbook, including how to capture the outgoing key before rotating.

## Reading a value

`secret read --name <name>` is the one host-local CLI permitted to print a
decrypted value — the audited escape hatch, not a bypass of the read-back
restriction in `AGENTS.md` §1: it needs host access in addition to
`SECRETS_KEKS`, and it writes the same `secret.read` audit row `GET
/secrets/value` does, before printing anything.

    pnpm --filter @unimatrix/secrets-app exec tsx src/cli/secret.ts read --name github/token
    docker exec <container> node dist/cli/secret.js read --name github/token
