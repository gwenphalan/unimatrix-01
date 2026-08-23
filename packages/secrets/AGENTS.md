# AGENTS.md

## 1. Overview
`packages/secrets` ships two deliberately separate entry points. `.` is pure, I/O-free AES-256-GCM value sealing under a versioned key ring, plus redaction — Node-only, importing nothing outside `node:` builtins, no `@unimatrix/db`, no persistence, no network. `./client` is an HTTP client for `apps/secrets`' scoped read route: it depends on `@unimatrix/shared` for the contract and schema, on `undici` for certificate pinning, and on nothing else in this package's crypto internals beyond `SecretValue`. The package's two runtime dependencies both belong to `./client` alone — importing `.` pulls in neither. `apps/secrets` consumes `.` (it is the only consumer of the crypto); `apps/api` consumes `./client`.

## 2. Folder Structure
- `src/errors.ts`: `SecretsError` and every `SecretsErrorCode` this package can raise.
- `src/secret-value.ts`: `SecretValue`, the plaintext wrapper that refuses to serialize itself. Shared by both entry points.
- `src/keyring.ts`: `SecretsKeyring` and `loadSecretsKeyring`, the `SECRETS_KEKS` parser and validator.
- `src/envelope.ts`: the AES-256-GCM envelope format and its AAD.
- `src/index.ts`: barrel re-exporting every `.` module. Does **not** re-export `client.ts` — see §5.
- `src/client.ts`: the `./client` entry point's two factories — `createSecretsClient` for the scoped read route, and `createSecretsManagementClient` for create, rotate, list and bulk-delete. Also re-exports `SecretValue`, since `./client` is the only place a consumer of `getSecretValue`'s return type can reach it. `SecretsClientError` never carries a fragment of a response body in `message` or any other property, because the 200 body for the route `createSecretsClient` calls is a decrypted credential.

## 3. Core Behaviors & Patterns
- **Never reads `process.env`.** `loadSecretsKeyring` takes the encoded key string as an argument, same rule `packages/auth` follows. This package never boots anything and never calls `process.exit`; a caller decides what a thrown `SecretsError` means for its own startup.
- **AAD and plaintext-release**: see `envelope.ts`'s `buildAad` and `openSecretEnvelope` for what the AAD binds and why decryption has to happen as one expression — both are load-bearing comments on the lines that matter. The one thing worth repeating here: the AAD's granularity (binding `versionId`, not just `name`) is fixed the moment the first row is sealed under it; changing it means re-encrypting the whole store.
- **Redaction bounds logs and serialization, not memory.** A JS string cannot be zeroized. `SecretValue`'s `toString`/`toJSON`/inspect override stop a value from leaking into a log line or a `JSON.stringify`; they say nothing about a value already scraped from process memory. Do not describe this package as protecting against the stronger property.
- **A pinned client fetches through `undici`'s own `fetch`, never the global one.** An `Agent` from this package's undici handed to Node's built-in `fetch` throws `InvalidArgumentError: invalid onRequestStart method` at request time (measured, Node 24.18.0 + undici 8) — the built-in carries its own bundled undici and the dispatcher handler protocol differs across majors. `setGlobalDispatcher` is rejected for a different reason: it re-routes every outbound fetch in the process.
- **Contract shapes live in `@unimatrix/shared`**, not here — `secretMetadataSchema` and friends in `packages/shared/src/schemas/secrets.ts`. The `.` entry owns crypto and redaction only; `./client` is the one place in this package permitted to import them.

## 4. Scope
Platform credentials belong in the store this package's crypto backs, alongside integration ones — `SECRET_REGISTRY` in `@unimatrix/shared` is where each is declared, with the tier that decides what the admin console permits.

Exactly four can never live there, because nothing could bootstrap them: `SECRETS_KEKS` (the store cannot decrypt its own KEK), the store's bootstrap **read** token (needed to reach the store at all), the store's **TLS private key** (needed to answer the connection that would fetch it — the certificate is public and travels to `apps/api` in the clear, the key never leaves the store's own stack), and the **Dokploy API token** (held by the automation that writes deployment env — a separate trust level). The floor is one root, and it cannot be zero.

Nothing fetches a platform credential out of the store at runtime, and nothing should: `apps/api` verifies Clerk sessions with keys from its own environment, and having it fetch them at boot would make a bad key or an unreachable store lock the admin console out of the only tool that could fix either.

Deployment-env materialization (pushing a value into Dokploy) and Dokploy-token handling stay permanently out of scope for this package: a separate trust level and a separate spec. This package does not enforce that the KEK stays unreachable from any particular app — that is a property of the service and route design, not of the crypto here.

## 5. Conventions
- **Naming**: `load*` for the one env-shaped entry point (`loadSecretsKeyring`); `seal*`/`open*` for envelope functions; `create*` for the `./client` factories (`createSecretsClient`, `createSecretsManagementClient`).
- **Errors**: every `.` entry point throws `SecretsError` with a `SecretsErrorCode`, never a bare `Error`, and its messages never contain key material, plaintext, or ciphertext field contents. `./client` throws `SecretsClientError` instead — a different failure class (HTTP, not crypto) with its own rule: neither `message` nor any other property may contain a fragment of a response body, since the route it calls can return a decrypted credential.
